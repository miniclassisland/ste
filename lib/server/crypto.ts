import crypto from "node:crypto";
import { fromBinary } from "@bufbuild/protobuf";
import {
  AuditEvents,
  AuthorizeEventSchema,
  AppSettingsUpdatedSchema,
  ClassChangeCompletedSchema,
  ProfileItemUpdatedSchema,
  AppCrashedSchema,
  PluginInstalledSchema,
  PluginUninstalledSchema,
} from "./proto.ts";

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ensureGuidStr(val: unknown, fallbackEmpty = false): string {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) {
      if (fallbackEmpty) return EMPTY_GUID;
      return generateDeterministicGuid(trimmed);
    }
    if (trimmed === EMPTY_GUID) return EMPTY_GUID;
    if (UUID_REGEX.test(trimmed)) return trimmed.toLowerCase();
    return generateDeterministicGuid(trimmed);
  }
  if (fallbackEmpty) return EMPTY_GUID;
  return generateDeterministicGuid(String(val ?? ""));
}

function generateDeterministicGuid(name: string): string {
  // Deterministic UUIDv5-like hash in DNS namespace
  const hash = crypto.createHash("sha1").update(`miniclassisland:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * ClassIsland upstream compatible credential generator:
 * SHA256(UTF8(password) + salt_16_bytes) -> Base64 JSON CredentialItem
 */
export function encodeClassIslandCredential(plainPassword: string): string {
  const trimmed = plainPassword.trim();
  if (!trimmed) return "";
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
    const obj = JSON.parse(decoded);
    if (obj && typeof obj === "object" && "PasswordHash" in obj && "PasswordSalt" in obj) {
      return trimmed;
    }
  } catch {
    // Plaintext password; encode below
  }
  const salt = crypto.randomBytes(16);
  const pwdBytes = Buffer.from(plainPassword, "utf-8");
  const digest = crypto.createHash("sha256").update(Buffer.concat([pwdBytes, salt])).digest();
  const payload = {
    PasswordHash: digest.toString("base64"),
    PasswordSalt: salt.toString("base64"),
  };
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

/**
 * Password hashing for STE single-password authentication
 */
export function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyAdminPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, key] = storedHash.split(":");
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

/**
 * Normalize resource payload for upstream ClassIsland compatibility
 */
export function normalizeResourcePayload(resourceType: string, data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const rawObj = data as Record<string, unknown>;

  if (resourceType === "Credentials") {
    const out = { ...rawObj };
    for (const key of ["UserCredential", "AdminCredential"]) {
      const val = out[key];
      if (typeof val === "string" && val.trim()) {
        out[key] = encodeClassIslandCredential(val);
      }
    }
    return out;
  }

  if (resourceType === "Subjects") {
    const rawMap =
      rawObj.Subjects && typeof rawObj.Subjects === "object" && !Array.isArray(rawObj.Subjects)
        ? (rawObj.Subjects as Record<string, unknown>)
        : rawObj;
    const normMap: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawMap)) {
      if (k === "Subjects" && typeof v !== "object") continue;
      normMap[ensureGuidStr(k)] = v;
    }
    return { ...rawObj, Subjects: normMap };
  }

  if (resourceType === "TimeLayout") {
    const rawMap =
      rawObj.TimeLayouts && typeof rawObj.TimeLayouts === "object" && !Array.isArray(rawObj.TimeLayouts)
        ? (rawObj.TimeLayouts as Record<string, unknown>)
        : rawObj;
    const normMap: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawMap)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const tlCopy = { ...(v as Record<string, unknown>) };
      if (Array.isArray(tlCopy.Layouts)) {
        tlCopy.Layouts = tlCopy.Layouts.map((item) => {
          if (!item || typeof item !== "object") return item;
          const itemCopy = { ...(item as Record<string, unknown>) };
          if ("DefaultClassId" in itemCopy) {
            itemCopy.DefaultClassId = ensureGuidStr(itemCopy.DefaultClassId, true);
          }
          if (itemCopy.TimeType === 3) {
            const rawAs =
              itemCopy.ActionSet && typeof itemCopy.ActionSet === "object"
                ? (itemCopy.ActionSet as Record<string, unknown>)
                : {};
            const actions = Array.isArray(rawAs.Actions)
              ? rawAs.Actions
              : Array.isArray(rawAs.ActionItems)
              ? rawAs.ActionItems
              : [];
            itemCopy.ActionSet = {
              Name: typeof rawAs.Name === "string" ? rawAs.Name : "行动时间点",
              IsEnabled: rawAs.IsEnabled !== false,
              IsRevertEnabled: Boolean(rawAs.IsRevertEnabled),
              Guid: ensureGuidStr(rawAs.Guid || crypto.randomUUID()),
              Actions: actions,
            };
          }
          return itemCopy;
        });
      }
      normMap[ensureGuidStr(k)] = tlCopy;
    }
    return { ...rawObj, TimeLayouts: normMap };
  }

  if (resourceType === "ClassPlan") {
    const rawMap =
      rawObj.ClassPlans && typeof rawObj.ClassPlans === "object" && !Array.isArray(rawObj.ClassPlans)
        ? (rawObj.ClassPlans as Record<string, unknown>)
        : rawObj;
    const normPlans: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawMap)) {
      if (k === "ClassPlanGroups" || !v || typeof v !== "object" || Array.isArray(v)) continue;
      const cpCopy = { ...(v as Record<string, unknown>) };
      cpCopy.TimeLayoutId = ensureGuidStr(cpCopy.TimeLayoutId, true);
      cpCopy.AssociatedGroup = ensureGuidStr(cpCopy.AssociatedGroup, true);
      if (Array.isArray(cpCopy.Classes)) {
        cpCopy.Classes = cpCopy.Classes.map((ci) => {
          if (!ci || typeof ci !== "object") return ci;
          const ciCopy = { ...(ci as Record<string, unknown>) };
          ciCopy.SubjectId = ensureGuidStr(ciCopy.SubjectId, true);
          return ciCopy;
        });
      }
      normPlans[ensureGuidStr(k)] = cpCopy;
    }

    const rawGroups =
      rawObj.ClassPlanGroups && typeof rawObj.ClassPlanGroups === "object" && !Array.isArray(rawObj.ClassPlanGroups)
        ? (rawObj.ClassPlanGroups as Record<string, unknown>)
        : {};
    const normGroups: Record<string, unknown> = {};
    for (const [gk, gv] of Object.entries(rawGroups)) {
      if (gv && typeof gv === "object") {
        normGroups[ensureGuidStr(gk, true)] = gv;
      }
    }
    if (!(EMPTY_GUID in normGroups)) {
      normGroups[EMPTY_GUID] = { Name: "默认", IsGlobal: false };
    }
    return {
      ...rawObj,
      ClassPlans: normPlans,
      ClassPlanGroups: normGroups,
    };
  }

  return data;
}

/**
 * Decode Protobuf Audit Event payload bytes
 */
export function decodeAuditPayload(eventType: number, payloadBytes: Uint8Array): Record<string, unknown> {
  if (!payloadBytes || payloadBytes.byteLength === 0) {
    return {};
  }
  try {
    if (eventType === AuditEvents.AuthorizeSuccess || eventType === AuditEvents.AuthorizeFailed) {
      const msg = fromBinary(AuthorizeEventSchema, payloadBytes);
      return { Level: msg.Level };
    }
    if (eventType === AuditEvents.AppSettingsUpdated) {
      const msg = fromBinary(AppSettingsUpdatedSchema, payloadBytes);
      return { PropertyName: msg.PropertyName };
    }
    if (eventType === AuditEvents.ClassChangeCompleted) {
      const msg = fromBinary(ClassChangeCompletedSchema, payloadBytes);
      return {
        ClassPlanId: msg.ClassPlanId,
        ChangeMode: msg.ChangeMode,
        SourceClassIndex: msg.SourceClassIndex,
        SourceClassSubjectId: msg.SourceClassSubjectId,
        TargetClassIndex: msg.TargetClassIndex,
        TargetClassSubjectId: msg.TargetClassSubjectId,
        WriteToSourceClassPlan: msg.WriteToSourceClassPlan,
      };
    }
    if (
      eventType === AuditEvents.ClassPlanUpdated ||
      eventType === AuditEvents.TimeLayoutUpdated ||
      eventType === AuditEvents.SubjectUpdated
    ) {
      const msg = fromBinary(ProfileItemUpdatedSchema, payloadBytes);
      return { ItemId: msg.ItemId, Operation: msg.Operation };
    }
    if (eventType === AuditEvents.AppCrashed) {
      const msg = fromBinary(AppCrashedSchema, payloadBytes);
      return { Stacktrace: msg.Stacktrace };
    }
    if (eventType === AuditEvents.PluginInstalled) {
      const msg = fromBinary(PluginInstalledSchema, payloadBytes);
      return { PluginId: msg.PluginId, Version: msg.Version };
    }
    if (eventType === AuditEvents.PluginUninstalled) {
      const msg = fromBinary(PluginUninstalledSchema, payloadBytes);
      return { PluginId: msg.PluginId, Version: msg.Version };
    }
  } catch (e) {
    return { raw_b64: Buffer.from(payloadBytes).toString("base64"), decode_error: String(e) };
  }
  return { raw_b64: Buffer.from(payloadBytes).toString("base64") };
}

export const AUDIT_EVENT_NAMES: Record<number, string> = {
  0: "DefaultEvent",
  1: "AuthorizeSuccess",
  2: "AuthorizeFailed",
  4: "AppSettingsUpdated",
  5: "ClassChangeCompleted",
  6: "ClassPlanUpdated",
  7: "TimeLayoutUpdated",
  8: "SubjectUpdated",
  9: "AppCrashed",
  10: "AppStarted",
  11: "AppExited",
  12: "PluginInstalled",
  13: "PluginUninstalled",
};

export const CONFIG_TYPE_NAMES: Record<number, string> = {
  0: "UnspecifiedConfig",
  1: "AppSettings",
  2: "Profile",
  3: "CurrentComponent",
  4: "CurrentAutomation",
  5: "Logs",
  6: "PluginList",
};

export const DEFAULT_RESOURCES: Record<string, unknown> = {
  Subjects: {
    Name: "默认科目",
    Subjects: {
      "10000000-0000-0000-0000-000000000001": {
        Name: "语文",
        Initial: "语",
        TeacherName: "",
        IsOutDoor: false,
      },
      "10000000-0000-0000-0000-000000000002": {
        Name: "数学",
        Initial: "数",
        TeacherName: "",
        IsOutDoor: false,
      },
      "10000000-0000-0000-0000-000000000003": {
        Name: "英语",
        Initial: "英",
        TeacherName: "",
        IsOutDoor: false,
      },
    },
  },
  TimeLayout: {
    Name: "默认时间表",
    TimeLayouts: {
      "20000000-0000-0000-0000-000000000001": {
        Name: "标准日间作息",
        Layouts: [
          {
            StartSecond: "1970-01-01T08:00:00",
            EndSecond: "1970-01-01T08:45:00",
            StartTime: "08:00:00",
            EndTime: "08:45:00",
            TimeType: 0,
            IsHideDefault: false,
            DefaultClassId: EMPTY_GUID,
            BreakName: "",
          },
          {
            StartSecond: "1970-01-01T08:45:00",
            EndSecond: "1970-01-01T08:55:00",
            StartTime: "08:45:00",
            EndTime: "08:55:00",
            TimeType: 1,
            IsHideDefault: false,
            DefaultClassId: EMPTY_GUID,
            BreakName: "课间休息",
          },
          {
            StartSecond: "1970-01-01T08:55:00",
            EndSecond: "1970-01-01T09:40:00",
            StartTime: "08:55:00",
            EndTime: "09:40:00",
            TimeType: 0,
            IsHideDefault: false,
            DefaultClassId: EMPTY_GUID,
            BreakName: "",
          },
        ],
      },
    },
  },
  ClassPlan: {
    Name: "默认课表",
    ClassPlans: {
      "30000000-0000-0000-0000-000000000001": {
        Name: "周一默认课表",
        TimeLayoutId: "20000000-0000-0000-0000-000000000001",
        TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 },
        Classes: [
          { SubjectId: "10000000-0000-0000-0000-000000000001", IsEnabled: true },
          { SubjectId: "10000000-0000-0000-0000-000000000002", IsEnabled: true },
        ],
        IsEnabled: true,
        IsOverlay: false,
        AssociatedGroup: EMPTY_GUID,
      },
    },
    ClassPlanGroups: {
      [EMPTY_GUID]: { Name: "默认", IsGlobal: false },
    },
  },
  Policy: {
    DisableProfileClassPlanEditing: false,
    DisableProfileTimeLayoutEditing: false,
    DisableProfileSubjectsEditing: false,
    DisableProfileEditing: false,
    DisableSettingsEditing: false,
    DisableSplashCustomize: false,
    DisableDebugMenu: false,
    AllowExitManagement: true,
    DisableEasterEggs: false,
  },
  DefaultSettings: {},
  Components: {
    Lines: [
      {
        Components: [
          {
            Id: "df308295-21F6-482e-bada-fa0e5f14bb66",
            NameCache: "日期",
            HideOnRule: false,
          },
          {
            Id: "1db2017d-e374-4bc6-9d57-0b4ffdbef9f1",
            NameCache: "时钟",
            HideOnRule: false,
          },
          {
            Id: "7789b694-619f-4779-89a9-c5a81c45618b",
            NameCache: "课程表",
            HideOnRule: false,
          },
        ],
        IsMainLine: true,
        IsNotificationEnabled: true,
        HorizontalAlignment: 1,
      },
    ],
  },
  Credentials: {
    UserCredential: "",
    AdminCredential: "",
    EditAuthorizeSettingsAuthorizeLevel: 0,
    EditPolicyAuthorizeLevel: 0,
    ExitManagementAuthorizeLevel: 0,
    EditProfileAuthorizeLevel: 0,
    EditSettingsAuthorizeLevel: 0,
    ExitApplicationAuthorizeLevel: 0,
    EditComponentsAuthorizeLevel: 0,
    PluginManagementAuthorizeLevel: 0,
    ChangeLessonsAuthorizeLevel: 0,
  },
};
