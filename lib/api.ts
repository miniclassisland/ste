/**
 * MINI ClassIsland STE — Next.js Hydration & ConnectES Action Bridge
 * Uses Next.js Server Actions + ConnectES SteSecurityGateway instead of exposed REST APIs.
 */

import { invokeConnectAction } from "./actions";
import type {
  TokenResponse,
  AccountOut,
  PairingCodeOut,
  PreRegCreate,
  PreRegOut,
  NotificationPayload,
  ClientProfileConfig,
  ClientDeviceOut,
  ConfigUploadItem,
  AuditLogItem,
  RegistrationMode,
  ResourceHistoryItem,
  ResourceHistoryVersionOut,
  SiteAnnouncement,
  UserOut,
} from "./types";

const TOKEN_KEY = "miniclassisland_auth_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

async function callAction<T>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const token = getToken() || "";
  try {
    return await invokeConnectAction<T>(action, token, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("未登录") || message.includes("过期")) {
      clearToken();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("miniclassisland:unauthorized"));
      }
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

/* ===== 单密码认证 ===== */

export const auth = {
  status: () =>
    callAction<{ authenticated: boolean; password_initialized: boolean }>("auth.status"),

  loginWithPassword: async (password: string): Promise<TokenResponse> => {
    const res = await callAction<TokenResponse>("auth.login", { password });
    const tok = res.access_token || res.token;
    if (tok) {
      setToken(tok);
    }
    return res;
  },

  logout: async (): Promise<void> => {
    try {
      await callAction("auth.logout");
    } finally {
      clearToken();
    }
  },

  changePassword: (data: { old_password: string; new_password: string }) =>
    callAction<{ status: string; message: string }>("auth.changePassword", data),
};

/* ===== 用户信息兼容层 (单租户无独立账号) ===== */

export const userInfo = {
  me: async (): Promise<UserOut> => {
    const acct = await callAction<AccountOut>("accounts.get");
    return {
      id: "default",
      username: "admin",
      email: "",
      display_name: acct.name || "管理员",
      role_code: "admin",
      is_active: true,
      totp_enabled: false,
      created_at: acct.created_at,
    };
  },
  changePassword: (data: { old_password: string; new_password: string }) =>
    auth.changePassword(data),
};

/* ===== 系统公告与版本配置 ===== */

export const system = {
  announcements: () => callAction<SiteAnnouncement[]>("system.announcements"),
  getVersion: async () => ({ version: "1.0.0" }),
};

export const site = {
  getAnnouncement: async () => ({ title: "", subtitle: "" }),
};

/* ===== 单租户集控配置 ===== */

export const accounts = {
  list: () => callAction<Array<AccountOut & { server_url?: string }>>("accounts.list"),

  get: (_accountId?: string) =>
    callAction<AccountOut & { server_url?: string }>("accounts.get"),

  update: (
    _accountId: string,
    data: {
      name?: string;
      slug?: string;
      registration_mode?: RegistrationMode;
      server_url?: string;
    }
  ) => callAction<AccountOut & { server_url?: string }>("accounts.update", data),

  regenerateKey: (_accountId?: string) =>
    callAction<{ api_key: string }>("accounts.regenerateKey"),

  downloadPreset: (_accountId?: string, classIdentity?: string) =>
    callAction<Record<string, unknown>>("accounts.downloadPreset", {
      class_identity: classIdentity,
    }),

  presetUrl: (_slug?: string, classIdentity?: string) => {
    const base = "/preset/ManagementPreset.json";
    return classIdentity
      ? `${base}?class_identity=${encodeURIComponent(classIdentity)}`
      : base;
  },
};

/* ===== 配对码与接入策略 ===== */

export const pairing = {
  getStatus: (_accountId?: string) =>
    callAction<{ registration_mode: RegistrationMode }>("pairing.getStatus"),

  setMode: (_accountId: string, registrationMode: RegistrationMode) =>
    callAction<{ registration_mode: RegistrationMode }>("pairing.setMode", {
      registration_mode: registrationMode,
    }),

  listCodes: (_accountId?: string) =>
    callAction<PairingCodeOut[]>("pairing.listCodes"),

  approve: (_accountId: string, pairingId: string, presetProfile?: ClientProfileConfig) =>
    callAction<{ status: string }>("pairing.approve", {
      pairing_id: pairingId,
      preset_profile: presetProfile,
    }),

  reject: (_accountId: string, pairingId: string) =>
    callAction<{ status: string }>("pairing.reject", {
      pairing_id: pairingId,
    }),
};

/* ===== 预注册客户端 ===== */

export const preRegistration = {
  list: (_accountId?: string) =>
    callAction<PreRegOut[]>("preRegistration.list"),

  create: (_accountId: string, data: PreRegCreate) =>
    callAction<PreRegOut>("preRegistration.create", { data }),

  batchCreate: (_accountId: string, items: PreRegCreate[]) =>
    callAction<PreRegOut[]>("preRegistration.batchCreate", { items }),

  rename: (
    _accountId: string,
    preRegId: string,
    data: { label?: string; class_identity?: string; mac_address?: string }
  ) =>
    callAction<{ status: string }>("preRegistration.rename", {
      pre_reg_id: preRegId,
      data,
    }),

  enable: (_accountId: string, preRegId: string) =>
    callAction<{ status: string }>("preRegistration.enable", {
      pre_reg_id: preRegId,
    }),

  disable: (_accountId: string, preRegId: string) =>
    callAction<{ status: string }>("preRegistration.disable", {
      pre_reg_id: preRegId,
    }),

  config: (_accountId: string, preRegId: string, profile: ClientProfileConfig) =>
    callAction<{ status: string }>("preRegistration.config", {
      pre_reg_id: preRegId,
      profile,
    }),

  delete: (_accountId: string, preRegId: string) =>
    callAction<{ status: string }>("preRegistration.delete", {
      pre_reg_id: preRegId,
    }),

  downloadPreset: (_accountId: string, preRegId: string) =>
    callAction<Record<string, unknown>>("preRegistration.downloadPreset", {
      pre_reg_id: preRegId,
    }),
};

/* ===== 7 大集控资源 CRUD 与历史版本 ===== */

export const data = {
  list: (_accountId: string, resourceType: string) =>
    callAction<string[]>("data.list", { resource_type: resourceType }),

  create: (_accountId: string, resourceType: string, name: string) =>
    callAction<{ status: string; name: string }>("data.create", {
      resource_type: resourceType,
      name,
    }),

  read: (_accountId: string, resourceType: string, name: string) =>
    callAction<unknown>("data.read", {
      resource_type: resourceType,
      name,
    }),

  write: (_accountId: string, resourceType: string, name: string, body: unknown) =>
    callAction<{ status: string; version: number }>("data.write", {
      resource_type: resourceType,
      name,
      body,
    }),

  delete: (_accountId: string, resourceType: string, name: string) =>
    callAction<{ status: string }>("data.delete", {
      resource_type: resourceType,
      name,
    }),

  deleteData: (_accountId: string, resourceType: string, name: string) =>
    callAction<{ status: string }>("data.delete", {
      resource_type: resourceType,
      name,
    }),

  listHistory: (_accountId: string, resourceType: string, name: string) =>
    callAction<ResourceHistoryItem[]>("data.listHistory", {
      resource_type: resourceType,
      name,
    }),

  readHistoryVersion: (
    _accountId: string,
    resourceType: string,
    name: string,
    version: number
  ) =>
    callAction<ResourceHistoryVersionOut>("data.getHistoryDetail", {
      resource_type: resourceType,
      name,
      history_id: version,
    }),

  getHistoryDetail: (
    _accountId: string,
    resourceType: string,
    name: string,
    historyId: number
  ) =>
    callAction<ResourceHistoryVersionOut>("data.getHistoryDetail", {
      resource_type: resourceType,
      name,
      history_id: historyId,
    }),

  rollbackHistory: (
    _accountId: string,
    resourceType: string,
    name: string,
    historyId: number
  ) =>
    callAction<{ status: string; version: number; restored_from_version: number }>(
      "data.rollbackHistory",
      {
        resource_type: resourceType,
        name,
        history_id: historyId,
      }
    ),
};

/* ===== 凭据哈希编码 ===== */

export const credentials = {
  encode: (_accountId: string, password: string) =>
    callAction<{ credential: string }>("credentials.encode", { password }),
};

/* ===== 客户端管理与远程控制 ===== */

export const clients = {
  list: (_accountId?: string) => callAction<ClientDeviceOut[]>("clients.list"),

  details: (_accountId: string, clientUid: string) =>
    callAction<ClientDeviceOut>("clients.details", { client_uid: clientUid }),

  getProfileConfig: (_accountId: string, clientUid: string) =>
    callAction<{
      client_uid: string;
      has_custom_profile: boolean;
      profile_config: ClientProfileConfig;
    }>("clients.getProfileConfig", { client_uid: clientUid }),

  config: (_accountId: string, clientUid: string, config: ClientProfileConfig) =>
    callAction<{ status: string; profile_config: ClientProfileConfig }>("clients.config", {
      client_uid: clientUid,
      config,
    }),

  rename: (
    _accountId: string,
    clientUid: string,
    data: { display_name?: string; client_id?: string }
  ) =>
    callAction<{ status: string; display_name: string; client_id: string }>(
      "clients.rename",
      {
        client_uid: clientUid,
        data,
      }
    ),

  disable: (_accountId: string, clientUid: string) =>
    callAction<{ status: string }>("clients.disable", { client_uid: clientUid }),

  enable: (_accountId: string, clientUid: string) =>
    callAction<{ status: string }>("clients.enable", { client_uid: clientUid }),

  delete: (_accountId: string, clientUid: string) =>
    callAction<{ status: string }>("clients.delete", { client_uid: clientUid }),

  restart: (_accountId: string, clientUid: string) =>
    callAction<{ status: string }>("clients.restart", { client_uid: clientUid }),

  forceSync: (_accountId: string, clientUid: string) =>
    callAction<{ status: string }>("clients.forceSync", { client_uid: clientUid }),

  disconnect: (_accountId: string, clientUid: string) =>
    callAction<{ status: string }>("clients.disconnect", { client_uid: clientUid }),

  sendNotification: (
    _accountId: string,
    clientUid: string,
    payload: NotificationPayload
  ) =>
    callAction<{ status: string }>("clients.sendNotification", {
      client_uid: clientUid,
      payload,
    }),

  broadcastNotification: (
    _accountId: string,
    payload: NotificationPayload,
    targetClientUids?: string[]
  ) =>
    callAction<{ status: string; sent_count: number; total_targets: number }>(
      "clients.broadcastNotification",
      {
        payload,
        target_client_uids: targetClientUids,
      }
    ),

  batch: (
    _accountId: string,
    body: {
      client_uids: string[];
      action:
        | "force_sync"
        | "restart"
        | "disconnect"
        | "enable"
        | "disable"
        | "delete"
        | "assign_profile";
      profile_config?: ClientProfileConfig;
    }
  ) =>
    callAction<{ status: string; affected: number }>("clients.batch", { body }),

  getConfig: (_accountId: string, clientUid: string, configType: number) =>
    callAction<{
      status: string;
      request_guid: string;
      config_type: number;
      config_type_name: string;
    }>("clients.getConfig", {
      client_uid: clientUid,
      config_type: configType,
    }),

  listConfigUploads: (_accountId: string, clientUid: string) =>
    callAction<ConfigUploadItem[]>("clients.listConfigUploads", {
      client_uid: clientUid,
    }),

  getConfigUploadDetail: (_accountId: string, requestGuid: string) =>
    callAction<ConfigUploadItem>("clients.getConfigUploadDetail", {
      request_guid: requestGuid,
    }),
};

/* ===== 审计日志 ===== */

export const audit = {
  list: (
    _accountId: string,
    params?: { client_uid?: string; event_type?: number; limit?: number }
  ) => callAction<AuditLogItem[]>("audit.list", { params }),

  clear: (_accountId: string, clientUid?: string) =>
    callAction<{ status: string }>("audit.clear", { client_uid: clientUid }),
};

/* ===== 批量导入与导出 ===== */

export const bulk = {
  exportData: (_accountId?: string) =>
    callAction<Record<string, unknown>>("bulk.exportData"),

  importData: (_accountId: string, data: Record<string, unknown>) =>
    callAction<{ status: string }>("bulk.importData", { data }),
};
