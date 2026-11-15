import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as openpgp from "openpgp";
import { toBinary, create } from "@bufbuild/protobuf";
import {
  DEFAULT_RESOURCES,
  normalizeResourcePayload,
  hashAdminPassword,
  verifyAdminPassword,
  encodeClassIslandCredential,
  AUDIT_EVENT_NAMES,
  CONFIG_TYPE_NAMES,
  decodeAuditPayload,
} from "./crypto.ts";
import {
  CommandTypes,
  SendNotificationSchema,
  GetClientConfigSchema,
} from "./proto.ts";
import { publishSteEvent, subscribeSteEnvelopes } from "./sse.ts";
import type {
  AccountOut,
  ClientDeviceOut,
  ClientProfileConfig,
  EditSessionCreateRequest,
  EditSessionInitialView,
  EditSessionMode,
  EditSessionSummary,
  PairingCodeOut,
  PreRegOut,
  PreRegCreate,
  ResourceType,
  ResourceHistoryItem,
  ResourceHistoryVersionOut,
  ConfigUploadItem,
  AuditLogItem,
  NotificationPayload,
  RegistrationMode,
} from "../types.ts";

export const SINGLE_ACCOUNT_ID = "default";

interface CommandQueueEntry {
  cmdType: number;
  payload: Uint8Array;
}

interface GlobalStore {
  db?: DatabaseSync;
  pgpInitPromise?: Promise<void>;
  activeStreams: Map<string, Set<(entry: CommandQueueEntry) => void>>;
  pendingQueues: Map<string, CommandQueueEntry[]>;
  pendingHandshakes: Map<
    string,
    {
      clientUid: string;
      clientMac: string;
      decryptedToken: string;
      createdAt: number;
    }
  >;
  grpcSessions: Map<
    string,
    {
      sessionId: string;
      clientUid: string;
      createdAt: number;
    }
  >;
  downloadTokens: Map<
    string,
    {
      resourceType: string;
      name: string;
      clientUid: string;
      clientIp: string;
      expiresAt: number;
    }
  >;
  extendEnabledClients: Map<
    string,
    {
      enabled: boolean;
      version: string;
      isAppLocked?: boolean;
      pluginSettings?: unknown;
      pluginComponents?: unknown;
      hardwareInfo?: Record<string, unknown> | null;
      updatedAt: number;
    }
  >;
  editSessions: Map<
    string,
    {
      session_id: string;
      token_sha256: string;
      mode: EditSessionMode;
      editor_client_uid: string;
      editor_display_name: string;
      target_client_uid: string | null;
      target_display_name: string;
      initial_view: EditSessionInitialView;
      allowed_scopes: string[];
      resource_targets: Record<string, string>;
      base_versions: Record<string, number>;
      relay_snapshot: Record<string, unknown> | null;
      target_plugin_components: unknown[];
      target_plugin_settings: unknown[];
      created_at: string;
      expires_at_ms: number;
      last_sequence: number;
    }
  >;
  screenshotUploads: Map<
    string,
    {
      tokenSha256: string;
      clientUid: string;
      expiresAtMs: number;
      chunks: Map<number, Buffer>;
      totalChunks?: number;
    }
  >;
  screenshotBlobs: Map<
    string,
    {
      bytes: Buffer;
      mimeType: string;
      sha256: string;
      capturedAt: string;
      expiresAtMs: number;
    }
  >;
}

const g = globalThis as unknown as { __miniclassisland_ste_store?: GlobalStore };
if (!g.__miniclassisland_ste_store) {
  g.__miniclassisland_ste_store = {
    activeStreams: new Map(),
    pendingQueues: new Map(),
    pendingHandshakes: new Map(),
    grpcSessions: new Map(),
    downloadTokens: new Map(),
    extendEnabledClients: new Map(),
    editSessions: new Map(),
    screenshotUploads: new Map(),
    screenshotBlobs: new Map(),
  };
}
if (!g.__miniclassisland_ste_store.extendEnabledClients) {
  g.__miniclassisland_ste_store.extendEnabledClients = new Map();
}
if (!g.__miniclassisland_ste_store.editSessions) {
  g.__miniclassisland_ste_store.editSessions = new Map();
}
if (!g.__miniclassisland_ste_store.screenshotUploads) {
  g.__miniclassisland_ste_store.screenshotUploads = new Map();
}
if (!g.__miniclassisland_ste_store.screenshotBlobs) {
  g.__miniclassisland_ste_store.screenshotBlobs = new Map();
}
const store = g.__miniclassisland_ste_store;

export function markClientExtendEnabled(
  clientUid: string,
  version = "",
  extra?: {
    isAppLocked?: boolean;
    pluginSettings?: unknown;
    pluginComponents?: unknown;
    hardwareInfo?: Record<string, unknown> | null;
  }
): void {
  const uid = (clientUid || "").trim();
  if (!uid) return;
  const prev = store.extendEnabledClients.get(uid);
  const nextEntry = {
    enabled: true,
    version: (version || prev?.version || "2.0.0.4").trim(),
    isAppLocked: extra?.isAppLocked !== undefined ? extra.isAppLocked : prev?.isAppLocked,
    pluginSettings: extra?.pluginSettings !== undefined ? extra.pluginSettings : prev?.pluginSettings,
    pluginComponents: extra?.pluginComponents !== undefined ? extra.pluginComponents : prev?.pluginComponents,
    hardwareInfo: extra?.hardwareInfo !== undefined ? extra.hardwareInfo : prev?.hardwareInfo,
    updatedAt: Date.now(),
  };
  store.extendEnabledClients.set(uid, nextEntry);
  publishSteEvent("client.status", {
    client_uid: uid,
    reason: "extend_status_updated",
    version: nextEntry.version,
    is_app_locked: Boolean(nextEntry.isAppLocked),
  });
}

export function getClientExtendStatus(clientUid: string): {
  enabled: boolean;
  version: string;
  isAppLocked: boolean;
  pluginSettings?: unknown;
  pluginComponents?: unknown;
  hardwareInfo?: Record<string, unknown> | null;
} {
  const uid = (clientUid || "").trim();
  const info = uid ? store.extendEnabledClients.get(uid) : undefined;
  return {
    enabled: Boolean(info?.enabled),
    version: info?.version || "",
    isAppLocked: Boolean(info?.isAppLocked),
    pluginSettings: info?.pluginSettings,
    pluginComponents: info?.pluginComponents,
    hardwareInfo: info?.hardwareInfo,
  };
}

export function getDb(): DatabaseSync {
  if (store.db) return store.db;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, "miniclassisland_ste.db");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT 'MINI ClassIsland 集控中心',
      slug TEXT NOT NULL DEFAULT 'default',
      api_key TEXT NOT NULL DEFAULT '',
      registration_mode TEXT NOT NULL DEFAULT 'pairing',
      server_url TEXT NOT NULL DEFAULT '',
      pgp_private_key TEXT NOT NULL DEFAULT '',
      pgp_public_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resource_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE(resource_type, name)
    );

    CREATE TABLE IF NOT EXISTS resource_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      mac TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      is_disabled INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS client_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      class_plan_name TEXT NOT NULL DEFAULT 'default',
      time_layout_name TEXT NOT NULL DEFAULT 'default',
      subjects_name TEXT NOT NULL DEFAULT 'default',
      default_settings_name TEXT NOT NULL DEFAULT 'default',
      policy_name TEXT NOT NULL DEFAULT 'default',
      components_name TEXT NOT NULL DEFAULT 'default',
      credentials_name TEXT NOT NULL DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      client_uid TEXT NOT NULL DEFAULT '',
      client_id TEXT NOT NULL DEFAULT '',
      client_mac TEXT NOT NULL DEFAULT '',
      client_ip TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      approved INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0,
      preset_profile TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pre_registered_clients (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      class_identity TEXT NOT NULL DEFAULT '',
      mac_address TEXT NOT NULL DEFAULT '',
      preset_profile TEXT NOT NULL DEFAULT '{}',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      bound_client_uid TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_guid TEXT NOT NULL UNIQUE,
      client_uid TEXT NOT NULL DEFAULT '',
      config_type INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      uploaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_uid TEXT NOT NULL DEFAULT '',
      event_type INTEGER NOT NULL DEFAULT 0,
      payload_b64 TEXT NOT NULL DEFAULT '',
      decoded_json TEXT NOT NULL DEFAULT '{}',
      timestamp_utc INTEGER NOT NULL DEFAULT 0,
      logged_at TEXT NOT NULL
    );
  `);

  // Seed system_config
  const existingCfg = db.prepare("SELECT id FROM system_config WHERE id = 1").get();
  const nowIso = new Date().toISOString();
  if (!existingCfg) {
    const apiKey = `ci_${crypto.randomBytes(24).toString("base64url")}`;
    // Default password can be set via env STE_PASSWORD, or left empty so first login sets it
    const envPwd = process.env.STE_PASSWORD || "";
    const pwdHash = envPwd ? hashAdminPassword(envPwd) : "";
    db.prepare(`
      INSERT INTO system_config (
        id, password_hash, name, slug, api_key, registration_mode, server_url,
        pgp_private_key, pgp_public_key, created_at, updated_at
      ) VALUES (1, ?, 'MINI ClassIsland 集控中心', 'default', ?, 'pairing', '', '', '', ?, ?)
    `).run(pwdHash, apiKey, nowIso, nowIso);
  }

  // Seed default 7 resources
  for (const [rType, defaultContent] of Object.entries(DEFAULT_RESOURCES)) {
    const existingRes = db
      .prepare("SELECT id FROM resource_files WHERE resource_type = ? AND name = 'default'")
      .get(rType);
    if (!existingRes) {
      db.prepare(`
        INSERT INTO resource_files (resource_type, name, content, version, updated_at)
        VALUES (?, 'default', ?, 1, ?)
      `).run(rType, JSON.stringify(defaultContent), nowIso);
    }
  }

  // Seed __default__ client_profile
  const existingDefaultProfile = db
    .prepare("SELECT id FROM client_profiles WHERE client_id = '__default__'")
    .get();
  if (!existingDefaultProfile) {
    db.prepare(`
      INSERT INTO client_profiles (
        client_id, class_plan_name, time_layout_name, subjects_name,
        default_settings_name, policy_name, components_name, credentials_name
      ) VALUES ('__default__', 'default', 'default', 'default', 'default', 'default', 'default', 'default')
    `).run();
  }

  store.db = db;
  // Trigger PGP key initialization asynchronously in background
  ensurePgpKeys().catch((err) => console.error("PGP Key generation error:", err));
  return db;
}

export function decorateStePublicKeyArmor(armor: string): string {
  if (!armor) return "";
  if (armor.includes("MINI ClassIsland STE") || armor.includes("miniclassisland-ste")) {
    return armor;
  }
  return armor.replace(
    /-----BEGIN PGP PUBLIC KEY BLOCK-----(\r?\n)/,
    "-----BEGIN PGP PUBLIC KEY BLOCK-----$1Comment: MINI ClassIsland STE (miniclassisland-ste)$1"
  );
}

export async function ensurePgpKeys(): Promise<{ privateKeyArmor: string; publicKeyArmor: string }> {
  const db = getDb();
    const row = db
      .prepare("SELECT pgp_private_key, pgp_public_key FROM system_config WHERE id = 1")
      .get() as { pgp_private_key: string; pgp_public_key: string } | undefined;

    if (row && row.pgp_private_key && row.pgp_public_key) {
      return {
        privateKeyArmor: row.pgp_private_key,
        publicKeyArmor: decorateStePublicKeyArmor(row.pgp_public_key),
      };
    }

    if (!store.pgpInitPromise) {
      store.pgpInitPromise = (async () => {
        const { privateKey, publicKey } = await openpgp.generateKey({
          type: "rsa",
          rsaBits: 2048,
          userIDs: [{ name: "MINI ClassIsland STE Server", comment: "miniclassisland-ste", email: "ste@miniclassisland.local" }],
          format: "armored",
        });
        const decoratedPub = decorateStePublicKeyArmor(publicKey);
        db.prepare(`
          UPDATE system_config
          SET pgp_private_key = ?, pgp_public_key = ?, updated_at = ?
          WHERE id = 1
        `).run(privateKey, decoratedPub, new Date().toISOString());
      })();
    }

    await store.pgpInitPromise;
    const updated = db
      .prepare("SELECT pgp_private_key, pgp_public_key FROM system_config WHERE id = 1")
      .get() as { pgp_private_key: string; pgp_public_key: string };
    return {
      privateKeyArmor: updated.pgp_private_key,
      publicKeyArmor: decorateStePublicKeyArmor(updated.pgp_public_key),
    };
  }

  export async function signDetachedText(text: string): Promise<string> {
    const { privateKeyArmor } = await ensurePgpKeys();
    const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmor });
    const message = await openpgp.createMessage({ text });
    const signature = await openpgp.sign({
      message,
      signingKeys: privateKey,
      detached: true,
      format: "armored",
    });
    return String(signature).trim();
  }

  export async function buildSignedCommandEnvelope(
    requestGuid: string,
    clientUid: string,
    action: string,
    payload?: Record<string, unknown> | null,
    ttlSeconds = 300
  ): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const clampedTtl = Math.max(30, Math.min(Number(ttlSeconds || 300), 3600));
    const expiresSec = nowSec + clampedTtl;
    const payloadJson = JSON.stringify(payload || {});
    const payloadHash = crypto
      .createHash("sha256")
      .update(payloadJson, "utf-8")
      .digest("hex")
      .toLowerCase();
    const canonical =
      `MCI-EXTCMD-V1|1|${requestGuid.trim()}|${clientUid.trim()}|` +
      `${nowSec}|${expiresSec}|${action.trim().toLowerCase()}|${payloadHash}`;
    const signature = await signDetachedText(canonical);
    const envelopeObj = {
      version: 1,
      requestGuid: requestGuid.trim(),
      clientUid: clientUid.trim(),
      issuedAtUtc: nowSec,
      expiresAtUtc: expiresSec,
      action: action.trim().toLowerCase(),
      payloadJson,
      signature,
    };
    return JSON.stringify(envelopeObj);
  }

export async function decryptChallengeToken(armoredMessage: string): Promise<string> {
  const { privateKeyArmor } = await ensurePgpKeys();
  const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmor });
  const message = await openpgp.readMessage({ armoredMessage: armoredMessage.trim() });
  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    format: "utf8",
  });
  return String(data).trim();
}

// ============================================================================
// Single-Password Authentication & Web Sessions
// ============================================================================

export function isPasswordInitialized(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT password_hash FROM system_config WHERE id = 1").get() as
    | { password_hash: string }
    | undefined;
  return Boolean(row && row.password_hash);
}

export function loginWithPassword(password: string): { token: string; access_token: string; is_initial_setup?: boolean } {
  const db = getDb();
  const row = db.prepare("SELECT password_hash FROM system_config WHERE id = 1").get() as {
    password_hash: string;
  };
  if (!password || password.length < 4) {
    throw new Error("密码长度不能少于 4 位");
  }

  let isInitialSetup = false;
  if (!row.password_hash) {
    // First login sets the single password
    const newHash = hashAdminPassword(password);
    db.prepare("UPDATE system_config SET password_hash = ?, updated_at = ? WHERE id = 1").run(
      newHash,
      new Date().toISOString()
    );
    isInitialSetup = true;
  } else {
    if (!verifyAdminPassword(password, row.password_hash)) {
      throw new Error("密码错误");
    }
  }

  const token = `ste_${crypto.randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 3600 * 1000; // 30 days
  db.prepare("INSERT INTO web_sessions (token, created_at, expires_at) VALUES (?, ?, ?)").run(
    token,
    now,
    expiresAt
  );
  return { token, access_token: token, is_initial_setup: isInitialSetup };
}

export function verifyWebSession(token?: string | null): boolean {
  if (!token) return false;
  const db = getDb();
  const row = db
    .prepare("SELECT token, expires_at FROM web_sessions WHERE token = ?")
    .get(token) as { token: string; expires_at: number } | undefined;
  if (!row) return false;
  if (Date.now() > row.expires_at) {
    db.prepare("DELETE FROM web_sessions WHERE token = ?").run(token);
    return false;
  }
  return true;
}

export function verifySteRequestAuth(request: Request): boolean {
  const authHeader = request.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i);
  if (bearerMatch && verifyWebSession(bearerMatch[1].trim())) {
    return true;
  }

  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === "miniclassisland_ste_token") {
      const val = decodeURIComponent(part.slice(eqIdx + 1).trim());
      if (verifyWebSession(val)) {
        return true;
      }
    }
  }

  try {
    const url = new URL(request.url);
    const queryTok = (url.searchParams.get("token") || "").trim();
    if (queryTok && verifyWebSession(queryTok)) {
      return true;
    }
  } catch {
    // Ignore malformed URL
  }
  return false;
}

export function logoutWebSession(token?: string | null): void {
  if (!token) return;
  const db = getDb();
  db.prepare("DELETE FROM web_sessions WHERE token = ?").run(token);
}

export function changeAdminPassword(oldPassword: string, newPassword: string): void {
  const db = getDb();
  const row = db.prepare("SELECT password_hash FROM system_config WHERE id = 1").get() as {
    password_hash: string;
  };
  if (row.password_hash && !verifyAdminPassword(oldPassword, row.password_hash)) {
    throw new Error("当前密码错误");
  }
  if (!newPassword || newPassword.length < 4) {
    throw new Error("新密码长度不能少于 4 位");
  }
  const newHash = hashAdminPassword(newPassword);
  db.prepare("UPDATE system_config SET password_hash = ?, updated_at = ? WHERE id = 1").run(
    newHash,
    new Date().toISOString()
  );
}

// ============================================================================
// Single-Tenant Account & System Info
// ============================================================================

function normalizeManagementServerUrl(url: string): string {
  return url.trim()
    .replace(/\/api\/v1\/client\/[^/?#]+\/manifest\/?(?:[?#].*)?$/i, "")
    .replace(/\/+$/, "");
}

export function getTenantAccount(
  originFallback = "http://localhost:21196"
): AccountOut & Required<Pick<AccountOut, "server_url" | "urls">> {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT name, slug, api_key, registration_mode, server_url, created_at FROM system_config WHERE id = 1"
    )
    .get() as {
    name: string;
    slug: string;
    api_key: string;
    registration_mode: RegistrationMode;
    server_url: string;
    created_at: string;
  };
  const serverUrl = normalizeManagementServerUrl(row.server_url);
  const baseUrl = serverUrl || normalizeManagementServerUrl(originFallback);
  return {
    id: SINGLE_ACCOUNT_ID,
    name: row.name,
    slug: row.slug || "default",
    api_key: row.api_key,
    registration_mode: row.registration_mode || "pairing",
    is_active: true,
    created_at: row.created_at,
    server_url: serverUrl,
    urls: {
      grpc: baseUrl,
      manifest_template: `${baseUrl}/api/v1/client/{client_uid}/manifest`,
      preset_download: `${baseUrl}/preset/ManagementPreset.json`,
    },
  };
}

export function updateTenantAccount(
  data: {
    name?: string;
    slug?: string;
    registration_mode?: RegistrationMode;
    server_url?: string;
  },
  originFallback = "http://localhost:21196"
): AccountOut & { server_url?: string } {
  const db = getDb();
  const current = db
    .prepare("SELECT name, slug, registration_mode, server_url FROM system_config WHERE id = 1")
    .get() as {
    name: string;
    slug: string;
    registration_mode: RegistrationMode;
    server_url: string;
  };

  const nextName = data.name !== undefined ? data.name.trim() || current.name : current.name;
  const nextSlug = data.slug !== undefined ? data.slug.trim() || current.slug : current.slug;
  const nextMode = data.registration_mode !== undefined ? data.registration_mode : current.registration_mode;
  const nextUrl = normalizeManagementServerUrl(data.server_url ?? current.server_url);

  db.prepare(`
    UPDATE system_config
    SET name = ?, slug = ?, registration_mode = ?, server_url = ?, updated_at = ?
    WHERE id = 1
  `).run(nextName, nextSlug, nextMode, nextUrl, new Date().toISOString());

  return getTenantAccount(originFallback);
}

export function regenerateApiKey(): { api_key: string } {
  const db = getDb();
  const apiKey = `ci_${crypto.randomBytes(24).toString("base64url")}`;
  db.prepare("UPDATE system_config SET api_key = ?, updated_at = ? WHERE id = 1").run(
    apiKey,
    new Date().toISOString()
  );
  return { api_key: apiKey };
}

export function buildManagementPreset(
  classIdentity?: string,
  originFallback = "http://localhost:21196"
): Record<string, unknown> {
  const { urls } = getTenantAccount(originFallback);
  const baseUrl = urls.grpc;
  return {
    IsManagementEnabled: true,
    ManagementServerKind: 1,
    ManagementServer: baseUrl,
    ManagementServerGrpc: baseUrl,
    ManifestUrlTemplate: `${baseUrl}/api/v1/client/{id}/manifest`,
    ClassIdentity: classIdentity ?? "",
    ServerFlavor: "miniclassisland-ste",
    ServerSoftware: "MINI ClassIsland STE",
    MiniClassIsland: true,
  };
}

// ============================================================================
// Live Client Command Queue & Streaming Helpers
// ============================================================================

export function isClientOnline(clientUid: string): boolean {
  const listeners = store.activeStreams.get(clientUid);
  return Boolean(listeners && listeners.size > 0);
}

export function registerClientStreamListener(
  clientUid: string,
  listener: (entry: CommandQueueEntry) => void
): () => void {
  let set = store.activeStreams.get(clientUid);
  if (!set) {
    set = new Set();
    store.activeStreams.set(clientUid, set);
  }
  const wasOffline = set.size === 0;
  set.add(listener);
  if (wasOffline) {
    publishSteEvent("client.status", {
      client_uid: clientUid,
      is_online: true,
      reason: "stream_connected",
    });
  }

  // Flush any queued commands immediately
  const pending = store.pendingQueues.get(clientUid);
  if (pending && pending.length > 0) {
    store.pendingQueues.delete(clientUid);
    for (const item of pending) {
      try {
        listener(item);
      } catch {
        // Ignore stream write failure
      }
    }
  }

  return () => {
    const currentSet = store.activeStreams.get(clientUid);
    if (currentSet) {
      currentSet.delete(listener);
      if (currentSet.size === 0) {
        store.activeStreams.delete(clientUid);
        publishSteEvent("client.status", {
          client_uid: clientUid,
          is_online: false,
          reason: "stream_disconnected",
        });
      }
    }
  };
}

export function pushClientCommand(clientUid: string, cmdType: number, payload: Uint8Array = new Uint8Array()): void {
  const listeners = store.activeStreams.get(clientUid);
  const entry: CommandQueueEntry = { cmdType, payload };
  if (listeners && listeners.size > 0) {
    for (const fn of listeners) {
      try {
        fn(entry);
      } catch {
        // Ignore
      }
    }
  } else {
    const q = store.pendingQueues.get(clientUid) || [];
    if (q.length < 100) {
      q.push(entry);
      store.pendingQueues.set(clientUid, q);
    }
  }
}

export function disconnectClientSession(clientUid: string): void {
  store.activeStreams.delete(clientUid);
  store.pendingQueues.delete(clientUid);
  for (const [sid, sess] of store.grpcSessions.entries()) {
    if (sess.clientUid === clientUid) {
      store.grpcSessions.delete(sid);
    }
  }
}

export function touchClientLastSeen(clientUid: string, clientIp = ""): void {
  const db = getDb();
  const nowIso = new Date().toISOString();
  if (clientIp) {
    db.prepare("UPDATE clients SET last_seen_at = ?, ip = ? WHERE uid = ?").run(
      nowIso,
      clientIp,
      clientUid
    );
  } else {
    db.prepare("UPDATE clients SET last_seen_at = ? WHERE uid = ?").run(nowIso, clientUid);
  }
}

// ============================================================================
// Handshake & gRPC Session Helpers
// ============================================================================

export function savePendingHandshake(
  clientUid: string,
  clientMac: string,
  decryptedToken: string
): void {
  store.pendingHandshakes.set(clientUid, {
    clientUid,
    clientMac,
    decryptedToken,
    createdAt: Date.now(),
  });
}

export function completePendingHandshake(clientUid: string): string | null {
  const pending = store.pendingHandshakes.get(clientUid);
  if (!pending) return null;
  store.pendingHandshakes.delete(clientUid);
  if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
    return null;
  }
  const sessionId = crypto.randomBytes(24).toString("base64url");
  store.grpcSessions.set(sessionId, {
    sessionId,
    clientUid,
    createdAt: Date.now(),
  });
  return sessionId;
}

export function verifyGrpcSession(clientUid: string, sessionToken: string): boolean {
  if (!clientUid || !sessionToken) return false;
  const sess = store.grpcSessions.get(sessionToken);
  if (!sess || sess.clientUid !== clientUid) return false;
  return true;
}

// ============================================================================
// Resource Files & History Operations
// ============================================================================

function getOnlineClientUids(): string[] {
  return Array.from(store.activeStreams.keys());
}

function broadcastDataUpdatedToAllOnline(): void {
  for (const uid of getOnlineClientUids()) {
    pushClientCommand(uid, CommandTypes.DataUpdated, new Uint8Array());
  }
}

export function listResources(resourceType: string): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT name FROM resource_files WHERE resource_type = ? ORDER BY id ASC")
    .all(resourceType) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function createResource(resourceType: string, name: string): { status: string; name: string } {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("资源名称不能为空");
  const existing = db
    .prepare("SELECT id FROM resource_files WHERE resource_type = ? AND name = ?")
    .get(resourceType, trimmed);
  if (existing) {
    throw new Error("同名资源已存在");
  }
  const defaultContent = DEFAULT_RESOURCES[resourceType] ?? {};
  db.prepare(`
    INSERT INTO resource_files (resource_type, name, content, version, updated_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(resourceType, trimmed, JSON.stringify(defaultContent), new Date().toISOString());
  return { status: "created", name: trimmed };
}

export function readResource(resourceType: string, name: string): unknown {
  const db = getDb();
  const row = db
    .prepare("SELECT content FROM resource_files WHERE resource_type = ? AND name = ?")
    .get(resourceType, name) as { content: string } | undefined;
  if (!row) {
    throw new Error(`资源 ${resourceType}/${name} 不存在`);
  }
  try {
    return JSON.parse(row.content);
  } catch {
    return {};
  }
}

export class SteHttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const RESOURCE_TO_PROFILE_KEY: Record<string, keyof ClientProfileConfig> = {
  ClassPlan: "ClassPlan",
  TimeLayout: "TimeLayout",
  Subjects: "Subjects",
  DefaultSettings: "DefaultSettings",
  Policy: "Policy",
  Components: "Components",
  Credentials: "Credentials",
};

export function notifyClientsForResourceUpdate(
  resourceType: string,
  resourceName: string
): { matched_clients: number; notified_clients: number } {
  const profKey = RESOURCE_TO_PROFILE_KEY[resourceType];
  if (!profKey) {
    return { matched_clients: 0, notified_clients: 0 };
  }
  const db = getDb();
  const activeClients = db
    .prepare("SELECT uid, client_id FROM clients WHERE is_disabled = 0")
    .all() as Array<{ uid: string; client_id: string }>;

  const profiles = db.prepare("SELECT * FROM client_profiles").all() as RawProfileRow[];
  const profileMap = new Map<string, RawProfileRow>();
  for (const p of profiles) {
    profileMap.set(p.client_id, p);
  }
  const defaultProfile = profileMap.get("__default__");

  let matched = 0;
  let notified = 0;
  for (const c of activeClients) {
    const custom =
      profileMap.get(c.uid) || (c.client_id ? profileMap.get(c.client_id) : undefined);
    const effectiveName = profileRowToDict(custom || defaultProfile)[profKey] || "default";
    if (effectiveName !== resourceName) {
      continue;
    }
    matched += 1;
    if (isClientOnline(c.uid)) {
      pushClientCommand(c.uid, CommandTypes.DataUpdated, new Uint8Array());
      notified += 1;
    }
  }
  return { matched_clients: matched, notified_clients: notified };
}

export function writeResource(
  resourceType: string,
  name: string,
  body: unknown,
  options?: { sync?: boolean; expectedVersion?: number; force?: boolean }
): {
  status: string;
  version: number;
  name: string;
  sync?: { matched_clients: number; notified_clients: number };
} {
  const db = getDb();
  const normalized = normalizeResourcePayload(resourceType, body);
  validateStePayload(normalized);
  const contentStr = JSON.stringify(normalized);
  const nowIso = new Date().toISOString();

  const existing = db
    .prepare("SELECT id, content, version FROM resource_files WHERE resource_type = ? AND name = ?")
    .get(resourceType, name) as { id: number; content: string; version: number } | undefined;

  if (
    !options?.force &&
    existing &&
    options?.expectedVersion !== undefined &&
    options.expectedVersion !== 0 &&
    existing.version !== options.expectedVersion
  ) {
    throw new SteHttpError(
      409,
      `Version conflict on ${resourceType}/${name}: server=${existing.version}, base=${options.expectedVersion}`
    );
  }

  let nextVer = 1;
  if (!existing) {
    db.prepare(`
      INSERT INTO resource_files (resource_type, name, content, version, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(resourceType, name, contentStr, nowIso);
  } else {
    // Save snapshot into resource_history
    db.prepare(`
      INSERT INTO resource_history (resource_type, name, version, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(resourceType, name, existing.version, existing.content, nowIso);
    nextVer = existing.version + 1;
    db.prepare(`
      UPDATE resource_files
      SET content = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).run(contentStr, nextVer, nowIso, existing.id);
  }

  publishSteEvent("resource.updated", {
    resource_type: resourceType,
    name,
    version: nextVer,
    action: "write",
  });

  if (options?.sync) {
    const sync = notifyClientsForResourceUpdate(resourceType, name);
    return { status: "saved", version: nextVer, name, sync };
  }
  return { status: "saved", version: nextVer, name };
}

export function deleteResource(resourceType: string, name: string): { status: string } {
  const db = getDb();
  db.prepare("DELETE FROM resource_files WHERE resource_type = ? AND name = ?").run(
    resourceType,
    name
  );
  publishSteEvent("resource.updated", {
    resource_type: resourceType,
    name,
    action: "delete",
  });
  return { status: "deleted" };
}

export function listResourceHistory(
  resourceType: string,
  name: string
): ResourceHistoryItem[] {
  const db = getDb();
  const currentRow = db
    .prepare("SELECT version, content, updated_at FROM resource_files WHERE resource_type = ? AND name = ?")
    .get(resourceType, name) as { version: number; content: string; updated_at: string } | undefined;

  const rows = db
    .prepare(`
      SELECT id, version, content, created_at
      FROM resource_history
      WHERE resource_type = ? AND name = ?
      ORDER BY version DESC
      LIMIT 50
    `)
    .all(resourceType, name) as Array<{ id: number; version: number; content: string; created_at: string }>;

  const result: ResourceHistoryItem[] = [];
  if (currentRow) {
    result.push({
      version: currentRow.version,
      name,
      resource_type: resourceType,
      updated_at: currentRow.updated_at,
      size_bytes: Buffer.byteLength(currentRow.content || "{}", "utf-8"),
      is_current: true,
    });
  }
  for (const r of rows) {
    result.push({
      version: r.version,
      name,
      resource_type: resourceType,
      updated_at: r.created_at,
      size_bytes: Buffer.byteLength(r.content || "{}", "utf-8"),
      is_current: false,
    });
  }
  return result;
}

export function getResourceHistoryDetail(
  resourceType: string,
  name: string,
  version: number
): ResourceHistoryVersionOut {
  const db = getDb();
  const currentRow = db
    .prepare("SELECT version, content, updated_at FROM resource_files WHERE resource_type = ? AND name = ? AND version = ?")
    .get(resourceType, name, version) as { version: number; content: string; updated_at: string } | undefined;

  if (currentRow) {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(currentRow.content);
    } catch {
      parsed = {};
    }
    return {
      version: currentRow.version,
      name,
      resource_type: resourceType,
      updated_at: currentRow.updated_at,
      content: parsed,
    };
  }

  const row = db
    .prepare(`
      SELECT version, content, created_at
      FROM resource_history
      WHERE resource_type = ? AND name = ? AND version = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(resourceType, name, version) as
    | { version: number; content: string; created_at: string }
    | undefined;
  if (!row) {
    throw new Error("历史快照不存在");
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.content);
  } catch {
    parsed = {};
  }
  return {
    version: row.version,
    name,
    resource_type: resourceType,
    updated_at: row.created_at,
    content: parsed,
  };
}

export function rollbackResourceHistory(
  resourceType: string,
  name: string,
  version: number
): { status: string; version: number; restored_from_version: number } {
  const detail = getResourceHistoryDetail(resourceType, name, version);
  const res = writeResource(resourceType, name, detail.content);
  return {
    status: "rolled_back",
    version: res.version,
    restored_from_version: detail.version,
  };
}

// ============================================================================
// Client Profile Mapping & Management
// ============================================================================

interface RawProfileRow {
  client_id: string;
  class_plan_name: string;
  time_layout_name: string;
  subjects_name: string;
  default_settings_name: string;
  policy_name: string;
  components_name: string;
  credentials_name: string;
}

function profileRowToDict(row?: RawProfileRow | null): ClientProfileConfig {
  if (!row) {
    return {
      ClassPlan: "default",
      TimeLayout: "default",
      Subjects: "default",
      DefaultSettings: "default",
      Policy: "default",
      Components: "default",
      Credentials: "default",
    };
  }
  return {
    ClassPlan: row.class_plan_name,
    TimeLayout: row.time_layout_name,
    Subjects: row.subjects_name,
    DefaultSettings: row.default_settings_name,
    Policy: row.policy_name,
    Components: row.components_name,
    Credentials: row.credentials_name,
  };
}

function getProfileRow(clientId: string): RawProfileRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM client_profiles WHERE client_id = ?")
    .get(clientId) as RawProfileRow | undefined;
}

function upsertClientProfile(clientId: string, config: ClientProfileConfig): RawProfileRow {
  const db = getDb();
  const existing = getProfileRow(clientId);
  const fallback = getProfileRow("__default__");

  const cp = config.ClassPlan !== undefined ? config.ClassPlan : existing?.class_plan_name ?? fallback?.class_plan_name ?? "default";
  const tl = config.TimeLayout !== undefined ? config.TimeLayout : existing?.time_layout_name ?? fallback?.time_layout_name ?? "default";
  const sb = config.Subjects !== undefined ? config.Subjects : existing?.subjects_name ?? fallback?.subjects_name ?? "default";
  const ds = config.DefaultSettings !== undefined ? config.DefaultSettings : existing?.default_settings_name ?? fallback?.default_settings_name ?? "default";
  const po = config.Policy !== undefined ? config.Policy : existing?.policy_name ?? fallback?.policy_name ?? "default";
  const cm = config.Components !== undefined ? config.Components : existing?.components_name ?? fallback?.components_name ?? "default";
  const cr = config.Credentials !== undefined ? config.Credentials : existing?.credentials_name ?? fallback?.credentials_name ?? "default";

  if (!existing) {
    db.prepare(`
      INSERT INTO client_profiles (
        client_id, class_plan_name, time_layout_name, subjects_name,
        default_settings_name, policy_name, components_name, credentials_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientId, cp, tl, sb, ds, po, cm, cr);
  } else {
    db.prepare(`
      UPDATE client_profiles
      SET class_plan_name = ?, time_layout_name = ?, subjects_name = ?,
          default_settings_name = ?, policy_name = ?, components_name = ?, credentials_name = ?
      WHERE client_id = ?
    `).run(cp, tl, sb, ds, po, cm, cr, clientId);
  }
  return getProfileRow(clientId)!;
}

export function listClients(): ClientDeviceOut[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM clients ORDER BY id DESC")
    .all() as Array<{
    uid: string;
    client_id: string;
    display_name: string;
    mac: string;
    ip: string;
    is_disabled: number;
    registered_at: string;
    last_seen_at: string | null;
  }>;

  const profiles = db.prepare("SELECT * FROM client_profiles").all() as RawProfileRow[];
  const profileMap = new Map<string, RawProfileRow>();
  for (const p of profiles) {
    profileMap.set(p.client_id, p);
  }
  const defaultProfile = profileMap.get("__default__");

  return rows.map((c) => {
    const customProfile =
      profileMap.get(c.uid) || (c.client_id ? profileMap.get(c.client_id) : undefined);
    const effective = customProfile || defaultProfile;
    const online = isClientOnline(c.uid);
    const ext = getClientExtendStatus(c.uid);
    return {
      uid: c.uid,
      client_id: c.client_id || "",
      display_name: c.display_name || c.client_id || c.uid,
      mac: c.mac || "",
      ip: c.ip || "",
      is_disabled: Boolean(c.is_disabled),
      is_app_locked: ext.isAppLocked,
      status: online ? "online" : "offline",
      extend_management_enabled: ext.enabled,
      extend_management_version: ext.version,
      plugin_settings: ext.pluginSettings,
      plugin_components: ext.pluginComponents,
      hardware_info: ext.hardwareInfo,
      registered_at: c.registered_at,
      last_seen_at: c.last_seen_at,
      profile_config: profileRowToDict(effective),
      has_custom_profile: Boolean(customProfile),
    };
  });
}

export function getClientDetails(clientUid: string): ClientDeviceOut {
  const all = listClients();
  const found = all.find((c) => c.uid === clientUid);
  if (!found) {
    throw new Error("客户端不存在");
  }
  return found;
}

export function getClientProfileConfig(clientUid: string): {
  client_uid: string;
  has_custom_profile: boolean;
  profile_config: ClientProfileConfig;
} {
  const db = getDb();
  if (clientUid === "__default__") {
    const defProf = getProfileRow("__default__");
    return {
      client_uid: "__default__",
      has_custom_profile: true,
      profile_config: profileRowToDict(defProf),
    };
  }
  const clientRow = db
    .prepare("SELECT uid, client_id FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; client_id: string } | undefined;

  const customProf =
    getProfileRow(clientUid) ||
    (clientRow?.client_id ? getProfileRow(clientRow.client_id) : undefined);
  const defProf = getProfileRow("__default__");
  return {
    client_uid: clientUid,
    has_custom_profile: Boolean(customProf),
    profile_config: profileRowToDict(customProf || defProf),
  };
}

export function setClientProfileConfig(
  clientUid: string,
  config: ClientProfileConfig
): { status: string; profile_config: ClientProfileConfig } {
  const db = getDb();
  // Check if user cleared all fields to revert to __default__
  const allEmpty =
    clientUid !== "__default__" &&
    Object.values(config).every((v) => v === "");

  if (allEmpty) {
    db.prepare("DELETE FROM client_profiles WHERE client_id = ?").run(clientUid);
    const clientRow = db
      .prepare("SELECT client_id FROM clients WHERE uid = ?")
      .get(clientUid) as { client_id: string } | undefined;
    if (clientRow?.client_id) {
      db.prepare("DELETE FROM client_profiles WHERE client_id = ?").run(clientRow.client_id);
    }
    pushClientCommand(clientUid, CommandTypes.DataUpdated, new Uint8Array());
    return {
      status: "updated",
      profile_config: profileRowToDict(getProfileRow("__default__")),
    };
  }

  const saved = upsertClientProfile(clientUid, config);
  if (clientUid === "__default__") {
    broadcastDataUpdatedToAllOnline();
  } else {
    pushClientCommand(clientUid, CommandTypes.DataUpdated, new Uint8Array());
  }
  return {
    status: "updated",
    profile_config: profileRowToDict(saved),
  };
}

export function renameClientDevice(
  clientUid: string,
  data: { display_name?: string; client_id?: string }
): { status: string; display_name: string; client_id: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT uid, display_name, client_id FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; display_name: string; client_id: string } | undefined;
  if (!row) throw new Error("客户端不存在");

  const nextName = data.display_name !== undefined ? data.display_name.trim() : row.display_name;
  const nextId = data.client_id !== undefined ? data.client_id.trim() : row.client_id;
  db.prepare("UPDATE clients SET display_name = ?, client_id = ? WHERE uid = ?").run(
    nextName,
    nextId,
    clientUid
  );
  pushClientCommand(clientUid, CommandTypes.DataUpdated, new Uint8Array());
  publishSteEvent("client.status", {
    client_uid: clientUid,
    reason: "renamed",
    display_name: nextName,
    client_id: nextId,
  });
  return { status: "updated", display_name: nextName, client_id: nextId };
}

export function disableClientDevice(clientUid: string): { status: string } {
  const db = getDb();
  db.prepare("UPDATE clients SET is_disabled = 1 WHERE uid = ?").run(clientUid);
  disconnectClientSession(clientUid);
  publishSteEvent("client.status", {
    client_uid: clientUid,
    is_disabled: true,
    is_online: false,
    reason: "disabled",
  });
  return { status: "disabled" };
}

export function enableClientDevice(clientUid: string): { status: string } {
  const db = getDb();
  db.prepare("UPDATE clients SET is_disabled = 0 WHERE uid = ?").run(clientUid);
  publishSteEvent("client.status", {
    client_uid: clientUid,
    is_disabled: false,
    reason: "enabled",
  });
  return { status: "enabled" };
}

export async function deleteClientDevice(
  clientUid: string,
  notifyExit = true
): Promise<{ status: string }> {
  const db = getDb();
  const row = db
    .prepare("SELECT uid, client_id FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; client_id: string } | undefined;
  if (!row) throw new Error("客户端不存在");

  if (notifyExit && isClientOnline(clientUid)) {
    try {
      await sendExtendCommandToClient(
        clientUid,
        "management.exit",
        { reason: "removed_by_server" },
        120
      );
      await new Promise((r) => setTimeout(r, 120));
    } catch {
      // Ignore stream push error
    }
  }

  db.prepare("UPDATE pre_registered_clients SET bound_client_uid = '' WHERE bound_client_uid = ?").run(
    clientUid
  );
  db.prepare("DELETE FROM client_profiles WHERE client_id = ?").run(clientUid);
  if (row.client_id) {
    db.prepare("DELETE FROM client_profiles WHERE client_id = ?").run(row.client_id);
  }
  db.prepare("DELETE FROM clients WHERE uid = ?").run(clientUid);
  store.extendEnabledClients.delete(clientUid);
  disconnectClientSession(clientUid);
  publishSteEvent("client.status", {
    client_uid: clientUid,
    deleted: true,
    reason: "deleted",
  });
  return { status: "deleted" };
}

export function restartClientDevice(clientUid: string): { status: string } {
  pushClientCommand(clientUid, CommandTypes.RestartApp, new Uint8Array());
  return { status: "command_queued" };
}

export function forceSyncClientDevice(clientUid: string): { status: string } {
  pushClientCommand(clientUid, CommandTypes.DataUpdated, new Uint8Array());
  return { status: "command_queued" };
}

export function sendNotificationToClient(
  clientUid: string,
  payload: NotificationPayload
): { status: string } {
  const msg = create(SendNotificationSchema, {
    MessageMask: payload.MessageMask || "",
    MessageContent: payload.MessageContent || "",
    OverlayIconLeft: payload.OverlayIconLeft || 0,
    OverlayIconRight: payload.OverlayIconRight || 0,
    IsEmergency: Boolean(payload.IsEmergency),
    IsSpeechEnabled: payload.IsSpeechEnabled !== false,
    IsEffectEnabled: payload.IsEffectEnabled !== false,
    IsSoundEnabled: payload.IsSoundEnabled !== false,
    IsTopmost: payload.IsTopmost !== false,
    DurationSeconds: payload.DurationSeconds ?? 5.0,
    RepeatCounts: payload.RepeatCounts ?? 1,
  });
  const bytes = toBinary(SendNotificationSchema, msg);
  pushClientCommand(clientUid, CommandTypes.SendNotification, bytes);
  return { status: "notification_queued" };
}

export function broadcastNotificationToClients(
  payload: NotificationPayload,
  targetClientUids?: string[]
): { status: string; sent_count: number; total_targets: number } {
  const targets =
    targetClientUids && targetClientUids.length > 0
      ? targetClientUids
      : getOnlineClientUids();
  for (const uid of targets) {
    sendNotificationToClient(uid, payload);
  }
  return {
    status: "broadcast_queued",
    sent_count: targets.length,
    total_targets: targets.length,
  };
}

export async function setClientAppLock(
  clientUid: string,
  locked: boolean
): Promise<{ status: string; delivered: boolean; is_app_locked: boolean; message: string }> {
  markClientExtendEnabled(clientUid, "", { isAppLocked: locked });
  let delivered = false;
  if (isClientOnline(clientUid)) {
    try {
      await sendExtendCommandToClient(
        clientUid,
        "security.set_app_lock",
        { isLocked: locked },
        120
      );
      delivered = true;
    } catch {
      delivered = false;
    }
  }
  return {
    status: "ok",
    delivered,
    is_app_locked: locked,
    message: locked ? "客户端已锁定" : "客户端已解锁",
  };
}

export function getAggregatedPluginComponents(): {
  totalCount: number;
  components: Array<Record<string, unknown>>;
} {
  const seen = new Set<string>();
  const items: Array<Record<string, unknown>> = [];
  for (const client of listClients()) {
    const raw = client.plugin_components;
    let list: unknown[] = [];
    if (Array.isArray(raw)) {
      list = raw;
    } else if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).components)) {
      list = (raw as Record<string, unknown>).components as unknown[];
    }
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const id = String(obj.id || obj.Id || "").trim();
      if (!id || seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());
      items.push({
        id,
        name: String(obj.name || obj.Name || id),
        description: obj.description ?? obj.Description ?? null,
        iconGlyph: obj.iconGlyph ?? obj.IconGlyph ?? null,
        isComponentContainer: Boolean(obj.isComponentContainer ?? obj.IsComponentContainer),
        hasSettingsControl: Boolean(obj.hasSettingsControl ?? obj.HasSettingsControl),
        componentTypeName: obj.componentTypeName ?? obj.ComponentTypeName ?? null,
        settingsTypeName: obj.settingsTypeName ?? obj.SettingsTypeName ?? null,
        assemblyName: obj.assemblyName ?? obj.AssemblyName ?? null,
        isBuiltIn: Boolean(obj.isBuiltIn ?? obj.IsBuiltIn),
        sourceClientUid: client.uid,
        sourceClientName: client.display_name || client.client_id || client.uid,
      });
    }
  }
  return { totalCount: items.length, components: items };
}

export async function batchClientsAction(body: {
  client_uids: string[];
  action:
    | "force_sync"
    | "restart"
    | "disconnect"
    | "enable"
    | "disable"
    | "delete"
    | "remove"
    | "lock"
    | "unlock"
    | "send_notification"
    | "assign_profile";
  profile_config?: ClientProfileConfig;
  notification?: NotificationPayload | null;
}): Promise<{ status: string; affected: number }> {
  let affected = 0;
  for (const uid of body.client_uids) {
    if (body.action === "force_sync") {
      forceSyncClientDevice(uid);
      affected++;
    } else if (body.action === "restart") {
      restartClientDevice(uid);
      affected++;
    } else if (body.action === "disconnect") {
      disconnectClientSession(uid);
      affected++;
    } else if (body.action === "enable") {
      enableClientDevice(uid);
      affected++;
    } else if (body.action === "disable") {
      disableClientDevice(uid);
      affected++;
    } else if (body.action === "delete" || body.action === "remove") {
      try {
        await deleteClientDevice(uid);
        affected++;
      } catch {
        // Ignore missing
      }
    } else if (body.action === "lock") {
      await setClientAppLock(uid, true);
      affected++;
    } else if (body.action === "unlock") {
      await setClientAppLock(uid, false);
      affected++;
    } else if (body.action === "send_notification" && body.notification) {
      sendNotificationToClient(uid, body.notification);
      affected++;
    } else if (body.action === "assign_profile" && body.profile_config) {
      setClientProfileConfig(uid, body.profile_config);
      affected++;
    }
  }
  return { status: "ok", affected };
}

// ============================================================================
// Remote Config Snapshots (GetClientConfig / ConfigUpload)
// ============================================================================

export function requestClientConfigSnapshot(
  clientUid: string,
  configType: number
): { status: string; request_guid: string; config_type: number; config_type_name: string } {
  const db = getDb();
  const reqGuid = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO config_uploads (request_guid, client_uid, config_type, payload, status, created_at)
    VALUES (?, ?, ?, '', 'pending', ?)
  `).run(reqGuid, clientUid, configType, nowIso);

  const msg = create(GetClientConfigSchema, {
    RequestGuid: reqGuid,
    ConfigType: configType,
  });
  pushClientCommand(clientUid, CommandTypes.GetClientConfig, toBinary(GetClientConfigSchema, msg));

  return {
    status: "command_queued",
    request_guid: reqGuid,
    config_type: configType,
    config_type_name: CONFIG_TYPE_NAMES[configType] || `Unknown(${configType})`,
  };
}

export const STE_SCREENSHOT_CHUNK_SIZE_BYTES = 1024 * 1024;
export const STE_MAX_SCREENSHOT_CHUNKS = 32;
export const STE_SCREENSHOT_TOKEN_TTL_MS = 300_000;
export const STE_SCREENSHOT_BLOB_TTL_MS = 900_000;

function pruneExpiredScreenshotState(): void {
  const now = Date.now();
  for (const [guid, entry] of store.screenshotUploads.entries()) {
    if (entry.expiresAtMs <= now) {
      store.screenshotUploads.delete(guid);
    }
  }
  for (const [guid, blob] of store.screenshotBlobs.entries()) {
    if (blob.expiresAtMs <= now) {
      store.screenshotBlobs.delete(guid);
    }
  }
}

function constantTimeHexEquals(expectedHex: string, actualHex: string): boolean {
  const a = Buffer.from(expectedHex.trim().toLowerCase(), "utf8");
  const b = Buffer.from(actualHex.trim().toLowerCase(), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function extractSteUploadToken(headers: Headers, url: URL): string {
  const auth = headers.get("authorization") || "";
  const m = auth.match(/^bearer\s+(.+)$/i);
  if (m && m[1].trim()) return m[1].trim();
  const h1 = (headers.get("x-screenshot-upload-token") || "").trim();
  if (h1) return h1;
  const h2 = (headers.get("x-upload-token") || "").trim();
  if (h2) return h2;
  return (url.searchParams.get("token") || "").trim();
}

export function issueSteScreenshotUploadToken(
  clientUid: string,
  requestGuid: string,
  ttlSeconds = 300
): string {
  pruneExpiredScreenshotState();
  const cleanGuid = (requestGuid || "").trim();
  const cleanClient = (clientUid || "").trim();
  if (!cleanGuid || !cleanClient) {
    throw new SteHttpError(400, "Invalid clientUid or requestGuid for screenshot token");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  store.screenshotUploads.set(cleanGuid, {
    tokenSha256: sha256Hex(token),
    clientUid: cleanClient,
    expiresAtMs: Date.now() + Math.max(ttlSeconds * 1000, STE_SCREENSHOT_TOKEN_TTL_MS),
    chunks: new Map(),
  });
  return token;
}

function verifySteScreenshotToken(
  requestGuid: string,
  clientUid: string,
  token: string
) {
  pruneExpiredScreenshotState();
  const cleanToken = (token || "").trim();
  if (!cleanToken) {
    throw new SteHttpError(401, "Missing screenshot upload token");
  }
  const cleanGuid = (requestGuid || "").trim();
  const record = store.screenshotUploads.get(cleanGuid);
  if (!record || record.expiresAtMs <= Date.now()) {
    if (record) store.screenshotUploads.delete(cleanGuid);
    throw new SteHttpError(401, "Invalid or expired screenshot upload token");
  }
  if (!constantTimeHexEquals(record.tokenSha256, sha256Hex(cleanToken))) {
    throw new SteHttpError(401, "Invalid screenshot upload token");
  }
  if (record.clientUid !== (clientUid || "").trim()) {
    throw new SteHttpError(403, "Screenshot upload token does not match client");
  }
  return record;
}

function detectSteImageMimeAndMagic(blob: Buffer, claimedMime: string): string {
  if (
    blob.byteLength >= 8 &&
    blob[0] === 0x89 &&
    blob[1] === 0x50 &&
    blob[2] === 0x4e &&
    blob[3] === 0x47 &&
    blob[4] === 0x0d &&
    blob[5] === 0x0a &&
    blob[6] === 0x1a &&
    blob[7] === 0x0a
  ) {
    return "image/png";
  }
  if (blob.byteLength >= 3 && blob[0] === 0xff && blob[1] === 0xd8 && blob[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    blob.byteLength >= 12 &&
    blob.subarray(0, 4).toString("ascii") === "RIFF" &&
    blob.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  void claimedMime;
  throw new SteHttpError(400, "Invalid image binary payload");
}

export function storeSteScreenshotChunk(args: {
  clientUid: string;
  requestGuid: string;
  chunkIndex: number;
  totalChunks: number;
  chunkBytes: Buffer;
  token: string;
  chunkSha256?: string;
}): {
  status: string;
  requestGuid: string;
  chunkIndex: number;
  totalChunks: number;
  bytesReceived: number;
} {
  const { clientUid, requestGuid, chunkIndex, totalChunks, chunkBytes, token, chunkSha256 } = args;
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > STE_MAX_SCREENSHOT_CHUNKS) {
    throw new SteHttpError(400, `totalChunks must be between 1 and ${STE_MAX_SCREENSHOT_CHUNKS}`);
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
    throw new SteHttpError(400, "chunkIndex out of bounds");
  }
  if (!chunkBytes || chunkBytes.byteLength === 0 || chunkBytes.byteLength > STE_SCREENSHOT_CHUNK_SIZE_BYTES) {
    throw new SteHttpError(
      413,
      `Chunk size must be between 1 and ${STE_SCREENSHOT_CHUNK_SIZE_BYTES} bytes`
    );
  }

  const record = verifySteScreenshotToken(requestGuid, clientUid, token);
  if (record.totalChunks !== undefined && record.totalChunks !== totalChunks) {
    throw new SteHttpError(400, "totalChunks does not match earlier chunks");
  }
  if (chunkSha256 && chunkSha256.trim()) {
    const actualChunkSha = crypto.createHash("sha256").update(chunkBytes).digest("hex");
    if (!constantTimeHexEquals(chunkSha256, actualChunkSha)) {
      throw new SteHttpError(400, "Chunk SHA-256 verification failed");
    }
  }

  record.totalChunks = totalChunks;
  record.chunks.set(chunkIndex, Buffer.from(chunkBytes));

  return {
    status: "ok",
    requestGuid,
    chunkIndex,
    totalChunks,
    bytesReceived: chunkBytes.byteLength,
  };
}

export function finalizeSteScreenshotUpload(args: {
  clientUid: string;
  requestGuid: string;
  totalChunks: number;
  totalBytes: number;
  sha256Hex?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  boundsX?: number;
  boundsY?: number;
  displayIndex?: number;
  capturedAt?: string;
  token: string;
}): {
  status: string;
  requestGuid: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
} {
  const {
    clientUid,
    requestGuid,
    totalChunks,
    totalBytes,
    sha256Hex: expectedSha = "",
    mimeType = "image/png",
    width = 0,
    height = 0,
    originalWidth = 0,
    originalHeight = 0,
    boundsX = 0,
    boundsY = 0,
    displayIndex = 0,
    capturedAt = "",
    token,
  } = args;

  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > STE_MAX_SCREENSHOT_CHUNKS) {
    throw new SteHttpError(400, `totalChunks must be between 1 and ${STE_MAX_SCREENSHOT_CHUNKS}`);
  }

  const cleanGuid = (requestGuid || "").trim();
  const record = verifySteScreenshotToken(cleanGuid, clientUid, token);
  if (record.totalChunks !== undefined && record.totalChunks !== totalChunks) {
    throw new SteHttpError(400, "totalChunks mismatch at finalization");
  }

  const parts: Buffer[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const part = record.chunks.get(i);
    if (!part) {
      throw new SteHttpError(400, `Missing screenshot chunk ${i}`);
    }
    if (part.byteLength > STE_SCREENSHOT_CHUNK_SIZE_BYTES) {
      throw new SteHttpError(413, `Chunk ${i} exceeds max chunk size`);
    }
    parts.push(part);
  }

  const blob = Buffer.concat(parts);
  const maxTotalBytes = STE_MAX_SCREENSHOT_CHUNKS * STE_SCREENSHOT_CHUNK_SIZE_BYTES;
  if (blob.byteLength === 0 || blob.byteLength > maxTotalBytes) {
    throw new SteHttpError(413, "Screenshot size exceeds allowed limit");
  }
  if (totalBytes > 0 && blob.byteLength !== totalBytes) {
    throw new SteHttpError(400, "Reassembled screenshot size mismatch");
  }

  const actualSha = crypto.createHash("sha256").update(blob).digest("hex");
  if (expectedSha.trim() && !constantTimeHexEquals(expectedSha, actualSha)) {
    throw new SteHttpError(400, "Screenshot SHA-256 verification failed");
  }

  const normalizedMime = detectSteImageMimeAndMagic(blob, mimeType);
  const nowIso = new Date().toISOString();
  const finalCapturedAt = (capturedAt || "").trim() || nowIso;

  // Burn one-time upload token & temporary chunks immediately after validation
  store.screenshotUploads.delete(cleanGuid);

  store.screenshotBlobs.set(cleanGuid, {
    bytes: blob,
    mimeType: normalizedMime,
    sha256: actualSha,
    capturedAt: finalCapturedAt,
    expiresAtMs: Date.now() + STE_SCREENSHOT_BLOB_TTL_MS,
  });

  const envelopePayload = JSON.stringify({
    requestGuid: cleanGuid,
    clientUid,
    action: "remote.screenshot",
    success: true,
    code: "OK",
    message: "Success",
    data: {
      screenshotReady: true,
      requestGuid: cleanGuid,
      mimeType: normalizedMime,
      sizeBytes: blob.byteLength,
      width: Math.trunc(width || 0),
      height: Math.trunc(height || 0),
      originalWidth: Math.trunc(originalWidth || 0),
      originalHeight: Math.trunc(originalHeight || 0),
      boundsX: Math.trunc(boundsX || 0),
      boundsY: Math.trunc(boundsY || 0),
      displayIndex: Math.trunc(displayIndex || 0),
      sha256: actualSha,
      capturedAt: finalCapturedAt,
    },
  });

  const db = getDb();
  const existingRow = db
    .prepare("SELECT id, config_type FROM config_uploads WHERE request_guid = ?")
    .get(cleanGuid) as { id: number; config_type: number } | undefined;
  const cfgType = existingRow?.config_type ?? 100;
  if (existingRow) {
    db.prepare(`
      UPDATE config_uploads
      SET payload = ?, status = 'completed', uploaded_at = ?
      WHERE id = ?
    `).run(envelopePayload, nowIso, existingRow.id);
  } else {
    db.prepare(`
      INSERT INTO config_uploads (request_guid, client_uid, config_type, payload, status, created_at, uploaded_at)
      VALUES (?, ?, ?, ?, 'completed', ?, ?)
    `).run(cleanGuid, clientUid, cfgType, envelopePayload, nowIso, nowIso);
  }

  publishSteEvent("command.completed", {
    request_guid: cleanGuid,
    client_uid: clientUid,
    action: "remote.screenshot",
    config_type: cfgType,
    status: "completed",
    payload: envelopePayload,
    uploaded_at: nowIso,
  });

  return {
    status: "ok",
    requestGuid: cleanGuid,
    sizeBytes: blob.byteLength,
    mimeType: normalizedMime,
    sha256: actualSha,
  };
}

export function getSteScreenshotBlob(requestGuid: string): {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
  capturedAt: string;
} | null {
  pruneExpiredScreenshotState();
  const entry = store.screenshotBlobs.get((requestGuid || "").trim());
  if (!entry) return null;
  return {
    bytes: entry.bytes,
    mimeType: entry.mimeType,
    sha256: entry.sha256,
    capturedAt: entry.capturedAt,
  };
}

export async function sendExtendCommandToClient(
  clientUid: string,
  action: string,
  payload?: Record<string, unknown> | null,
  ttlSeconds = 300
): Promise<{
  status: string;
  request_guid: string;
  client_uid: string;
  action: string;
  config_type: number;
  config_type_name: string;
}> {
  const db = getDb();
  const cleanAction = (action || "").trim();
  if (!cleanAction) {
    throw new Error("action 不能为空");
  }
  const reqGuid = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO config_uploads (request_guid, client_uid, config_type, payload, status, created_at)
    VALUES (?, ?, 100, '', 'pending', ?)
  `).run(reqGuid, clientUid, nowIso);

  const effectivePayload: Record<string, unknown> = payload ? { ...payload } : {};
  if (cleanAction === "remote.screenshot") {
    effectivePayload.uploadToken = issueSteScreenshotUploadToken(
      clientUid,
      reqGuid,
      Math.max(ttlSeconds, 300)
    );
    effectivePayload.requestGuid = reqGuid;
    effectivePayload.chunkSizeBytes = STE_SCREENSHOT_CHUNK_SIZE_BYTES;
  }

  const signedEnvelopeGuid = await buildSignedCommandEnvelope(
    reqGuid,
    clientUid,
    cleanAction,
    effectivePayload,
    ttlSeconds
  );

  const msg = create(GetClientConfigSchema, {
    RequestGuid: signedEnvelopeGuid,
    ConfigType: 100,
  });
  pushClientCommand(clientUid, CommandTypes.GetClientConfig, toBinary(GetClientConfigSchema, msg));

  return {
    status: "command_queued",
    request_guid: reqGuid,
    client_uid: clientUid,
    action: cleanAction,
    config_type: 100,
    config_type_name: CONFIG_TYPE_NAMES[100] || "ExtendCommand",
  };
}

export async function broadcastExtendCommandToClients(
  action: string,
  payload?: Record<string, unknown> | null,
  targetClientUids?: string[],
  ttlSeconds = 300
): Promise<{
  status: string;
  action: string;
  sent_count: number;
  dispatched_count: number;
  total_targets: number;
  requests: Array<{ client_uid: string; request_guid: string; delivered: boolean }>;
  items: Array<{ client_uid: string; request_guid: string }>;
}> {
  const cleanAction = (action || "").trim();
  if (!cleanAction) {
    throw new Error("action 不能为空");
  }
  const rawTargets =
    targetClientUids && targetClientUids.length > 0
      ? targetClientUids
      : getOnlineClientUids();

  const targets = rawTargets.filter((uid) => getClientExtendStatus(uid).enabled);
  const items: Array<{ client_uid: string; request_guid: string }> = [];
  for (const uid of targets) {
    const res = await sendExtendCommandToClient(uid, cleanAction, payload, ttlSeconds);
    items.push({ client_uid: uid, request_guid: res.request_guid });
  }
  return {
    status: "broadcast_queued",
    action: cleanAction,
    sent_count: items.length,
    dispatched_count: items.length,
    total_targets: rawTargets.length,
    requests: items.map((item) => ({ ...item, delivered: true })),
    items,
  };
}

export function saveClientConfigUpload(requestGuid: string, payload: string): boolean {
  const db = getDb();
  const cleanGuid = requestGuid.trim();
  const row = db
    .prepare("SELECT id, client_uid, config_type, status, payload FROM config_uploads WHERE request_guid = ?")
    .get(cleanGuid) as
    | { id: number; client_uid: string; config_type: number; status: string; payload: string }
    | undefined;
  if (!row) return false;
  if (row.status === "completed" && row.payload && row.payload.includes('"screenshotReady"')) {
    return true;
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE config_uploads
    SET payload = ?, status = 'completed', uploaded_at = ?
    WHERE id = ?
  `).run(payload || "", nowIso, row.id);

  let parsedAction = "";
  if (row.client_uid && payload) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      parsedAction = String(parsed.action || parsed.Action || "").trim();
      const action = parsedAction.toLowerCase();
      const data = parsed.data as Record<string, unknown> | undefined;
      if (action === "plugin.list_settings" && data) {
        markClientExtendEnabled(row.client_uid, "", { pluginSettings: data });
      } else if (action === "plugin.list_components" && data) {
        markClientExtendEnabled(row.client_uid, "", { pluginComponents: data });
      } else if ((action === "system.device_info" || action === "system.status") && data) {
        markClientExtendEnabled(row.client_uid, "", { hardwareInfo: data });
      } else if (action === "security.set_app_lock" && data && typeof data.isLocked === "boolean") {
        markClientExtendEnabled(row.client_uid, "", { isAppLocked: data.isLocked });
      }
    } catch {
      // Ignore parse error
    }
  }

  const truncated = Boolean(payload && payload.length > 512 * 1024);
  publishSteEvent("command.completed", {
    request_guid: cleanGuid,
    client_uid: row.client_uid || "",
    action: parsedAction,
    config_type: row.config_type ?? 0,
    status: "completed",
    payload: truncated ? "" : (payload || ""),
    payload_truncated: truncated,
    uploaded_at: nowIso,
  });
  return true;
}

export function listClientConfigUploads(clientUid: string): ConfigUploadItem[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT id, request_guid, client_uid, config_type, payload, status, created_at, uploaded_at
      FROM config_uploads
      WHERE client_uid = ?
      ORDER BY id DESC
      LIMIT 50
    `)
    .all(clientUid) as Array<{
    id: number;
    request_guid: string;
    client_uid: string;
    config_type: number;
    payload: string;
    status: string;
    created_at: string;
    uploaded_at: string | null;
  }>;

  return rows.map((r) => ({
    request_guid: r.request_guid,
    client_uid: r.client_uid,
    config_type: r.config_type,
    config_type_name: CONFIG_TYPE_NAMES[r.config_type] || `Unknown(${r.config_type})`,
    status: (r.status === "completed" ? "completed" : "pending") as "pending" | "completed",
    payload_preview: (r.payload || "").slice(0, 120),
    uploaded_at: r.uploaded_at,
  }));
}

export function getClientConfigUploadDetail(requestGuid: string): ConfigUploadItem {
  const db = getDb();
  const r = db
    .prepare("SELECT * FROM config_uploads WHERE request_guid = ?")
    .get(requestGuid) as
    | {
        id: number;
        request_guid: string;
        client_uid: string;
        config_type: number;
        payload: string;
        status: string;
        created_at: string;
        uploaded_at: string | null;
      }
    | undefined;
  if (!r) throw new Error("配置抓取记录不存在");

  let parsedJson: unknown = null;
  if (r.payload) {
    try {
      parsedJson = JSON.parse(r.payload);
    } catch {
      parsedJson = null;
    }
  }
  return {
    request_guid: r.request_guid,
    client_uid: r.client_uid,
    config_type: r.config_type,
    config_type_name: CONFIG_TYPE_NAMES[r.config_type] || `Unknown(${r.config_type})`,
    status: (r.status === "completed" ? "completed" : "pending") as "pending" | "completed",
    payload: r.payload,
    parsed_payload: parsedJson,
    uploaded_at: r.uploaded_at,
  };
}

// ============================================================================
// Pairing & Pre-Registration
// ============================================================================

export function getPairingStatus(): { registration_mode: RegistrationMode } {
  const db = getDb();
  const row = db
    .prepare("SELECT registration_mode FROM system_config WHERE id = 1")
    .get() as { registration_mode: RegistrationMode };
  return { registration_mode: row.registration_mode || "pairing" };
}

export function setPairingMode(mode: RegistrationMode): { registration_mode: RegistrationMode } {
  const db = getDb();
  db.prepare("UPDATE system_config SET registration_mode = ?, updated_at = ? WHERE id = 1").run(
    mode,
    new Date().toISOString()
  );
  return { registration_mode: mode };
}

export function listPairingCodes(): PairingCodeOut[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM pairing_codes ORDER BY created_at DESC LIMIT 100")
    .all() as Array<{
    id: string;
    code: string;
    client_uid: string;
    client_id: string;
    client_mac: string;
    client_ip: string;
    status: string;
    approved: number;
    used: number;
    preset_profile: string;
    created_at: string;
  }>;

  return rows.map((r) => {
    let preset: ClientProfileConfig = {};
    try {
      preset = JSON.parse(r.preset_profile || "{}");
    } catch {
      preset = {};
    }
    return {
      id: r.id,
      code: r.code,
      client_uid: r.client_uid,
      client_id: r.client_id,
      client_mac: r.client_mac,
      client_ip: r.client_ip,
      status: (r.status === "approved" || r.status === "rejected" ? r.status : "pending") as "pending" | "approved" | "rejected",
      approved: Boolean(r.approved),
      used: Boolean(r.used),
      preset_profile: preset,
      created_at: r.created_at,
    };
  });
}

export function approvePairingCode(
  pairingId: string,
  presetProfile?: ClientProfileConfig
): { status: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT id, client_uid, client_id FROM pairing_codes WHERE id = ?")
    .get(pairingId) as { id: string; client_uid: string; client_id: string } | undefined;
  if (!row) throw new Error("配对码记录不存在");

  const presetJson = presetProfile ? JSON.stringify(presetProfile) : "{}";
  db.prepare(`
    UPDATE pairing_codes
    SET approved = 1, status = 'approved', preset_profile = ?
    WHERE id = ?
  `).run(presetJson, pairingId);

  if (presetProfile && Object.keys(presetProfile).length > 0 && row.client_uid) {
    upsertClientProfile(row.client_uid, presetProfile);
  }
  publishSteEvent("pairing.updated", {
    id: pairingId,
    client_uid: row.client_uid || "",
    status: "approved",
  });
  return { status: "approved" };
}

export function rejectPairingCode(pairingId: string): { status: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT client_uid, code FROM pairing_codes WHERE id = ?")
    .get(pairingId) as { client_uid?: string; code?: string } | undefined;
  db.prepare("UPDATE pairing_codes SET approved = 0, status = 'rejected' WHERE id = ?").run(
    pairingId
  );
  publishSteEvent("pairing.updated", {
    id: pairingId,
    client_uid: row?.client_uid || "",
    code: row?.code || "",
    status: "rejected",
  });
  return { status: "rejected" };
}

export function listPreRegistrations(): PreRegOut[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM pre_registered_clients ORDER BY created_at DESC")
    .all() as Array<{
    id: string;
    label: string;
    class_identity: string;
    mac_address: string;
    preset_profile: string;
    is_enabled: number;
    bound_client_uid: string;
    created_at: string;
  }>;

  return rows.map((r) => {
    let preset: ClientProfileConfig = {};
    try {
      preset = JSON.parse(r.preset_profile || "{}");
    } catch {
      preset = {};
    }
    return {
      id: r.id,
      account_id: SINGLE_ACCOUNT_ID,
      label: r.label,
      class_identity: r.class_identity,
      mac_address: r.mac_address,
      preset_profile: preset,
      is_enabled: Boolean(r.is_enabled),
      bound_client_uid: r.bound_client_uid || null,
      created_at: r.created_at,
    };
  });
}

export function createPreRegistration(data: PreRegCreate): PreRegOut {
  const db = getDb();
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const presetJson = data.preset_profile ? JSON.stringify(data.preset_profile) : "{}";
  db.prepare(`
    INSERT INTO pre_registered_clients (
      id, label, class_identity, mac_address, preset_profile, is_enabled, bound_client_uid, created_at
    ) VALUES (?, ?, ?, ?, ?, 1, '', ?)
  `).run(
    id,
    data.label.trim(),
    data.class_identity.trim(),
    (data.mac_address || "").trim(),
    presetJson,
    nowIso
  );
  return {
    id,
    account_id: SINGLE_ACCOUNT_ID,
    label: data.label.trim(),
    class_identity: data.class_identity.trim(),
    mac_address: (data.mac_address || "").trim(),
    preset_profile: data.preset_profile || {},
    is_enabled: true,
    bound_client_uid: null,
    created_at: nowIso,
  };
}

export function batchCreatePreRegistrations(items: PreRegCreate[]): PreRegOut[] {
  return items.map((item) => createPreRegistration(item));
}

export function updatePreRegistrationInfo(
  preRegId: string,
  data: { label?: string; class_identity?: string; mac_address?: string }
): { status: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT label, class_identity, mac_address FROM pre_registered_clients WHERE id = ?")
    .get(preRegId) as
    | { label: string; class_identity: string; mac_address: string }
    | undefined;
  if (!row) throw new Error("预注册记录不存在");

  db.prepare(`
    UPDATE pre_registered_clients
    SET label = ?, class_identity = ?, mac_address = ?
    WHERE id = ?
  `).run(
    data.label !== undefined ? data.label.trim() : row.label,
    data.class_identity !== undefined ? data.class_identity.trim() : row.class_identity,
    data.mac_address !== undefined ? data.mac_address.trim() : row.mac_address,
    preRegId
  );
  return { status: "updated" };
}

export function setPreRegistrationEnabled(preRegId: string, enabled: boolean): { status: string } {
  const db = getDb();
  db.prepare("UPDATE pre_registered_clients SET is_enabled = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    preRegId
  );
  return { status: enabled ? "enabled" : "disabled" };
}

export function setPreRegistrationConfig(
  preRegId: string,
  profile: ClientProfileConfig
): { status: string } {
  const db = getDb();
  db.prepare("UPDATE pre_registered_clients SET preset_profile = ? WHERE id = ?").run(
    JSON.stringify(profile || {}),
    preRegId
  );
  return { status: "updated" };
}

export function deletePreRegistration(preRegId: string): { status: string } {
  const db = getDb();
  db.prepare("DELETE FROM pre_registered_clients WHERE id = ?").run(preRegId);
  return { status: "deleted" };
}

export function downloadPreRegistrationPreset(
  preRegId: string,
  originFallback = "http://localhost:21196"
): Record<string, unknown> {
  const db = getDb();
  const row = db
    .prepare("SELECT class_identity FROM pre_registered_clients WHERE id = ?")
    .get(preRegId) as { class_identity: string } | undefined;
  if (!row) throw new Error("预注册记录不存在");
  return buildManagementPreset(row.class_identity, originFallback);
}

// ============================================================================
// Audit Logs
// ============================================================================

export function recordAuditEvent(
  clientUid: string,
  eventType: number,
  payloadBytes: Uint8Array,
  timestampUtc: number
): void {
  const db = getDb();
  const payloadB64 =
    payloadBytes && payloadBytes.byteLength > 0
      ? Buffer.from(payloadBytes).toString("base64")
      : "";
  const decoded = decodeAuditPayload(eventType, payloadBytes);
  const loggedAtIso = new Date().toISOString();
  const insertRes = db.prepare(`
    INSERT INTO audit_logs (client_uid, event_type, payload_b64, decoded_json, timestamp_utc, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    clientUid,
    eventType,
    payloadB64,
    JSON.stringify(decoded),
    timestampUtc,
    loggedAtIso
  );
  publishSteEvent("audit.created", {
    id: Number(insertRes.lastInsertRowid || 0),
    client_uid: clientUid,
    event_type: eventType,
    event_name: AUDIT_EVENT_NAMES[eventType] || `Event(${eventType})`,
    timestamp_utc: timestampUtc,
    payload_b64: payloadB64,
    decoded,
    logged_at: loggedAtIso,
  });
}

export function listAuditLogs(params?: {
  client_uid?: string;
  event_type?: number;
  limit?: number;
}): AuditLogItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(params?.limit || 100, 1), 500);
  let sql = "SELECT * FROM audit_logs WHERE 1 = 1";
  const args: Array<string | number> = [];

  if (params?.client_uid) {
    sql += " AND client_uid = ?";
    args.push(params.client_uid);
  }
  if (params?.event_type !== undefined) {
    sql += " AND event_type = ?";
    args.push(params.event_type);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  args.push(limit);

  const rows = db.prepare(sql).all(...args) as Array<{
    id: number;
    client_uid: string;
    event_type: number;
    payload_b64: string;
    decoded_json: string;
    timestamp_utc: number;
    logged_at: string;
  }>;

  return rows.map((r) => {
    let decoded: Record<string, unknown> = {};
    try {
      decoded = JSON.parse(r.decoded_json || "{}");
    } catch {
      decoded = {};
    }
    return {
      id: r.id,
      client_uid: r.client_uid,
      event_type: r.event_type,
      event_name: AUDIT_EVENT_NAMES[r.event_type] || `Event(${r.event_type})`,
      timestamp_utc: r.timestamp_utc,
      payload_b64: r.payload_b64,
      decoded,
      logged_at: r.logged_at,
    };
  });
}

export function clearAuditLogs(clientUid?: string): { status: string } {
  const db = getDb();
  if (clientUid) {
    db.prepare("DELETE FROM audit_logs WHERE client_uid = ?").run(clientUid);
  } else {
    db.prepare("DELETE FROM audit_logs").run();
  }
  return { status: "cleared" };
}

// ============================================================================
// Client Manifest & /get Token Delivery
// ============================================================================

export function buildClientManifest(
  clientUid: string,
  clientIp: string,
  originUrl: string
): Record<string, unknown> {
  const db = getDb();
  const acct = getTenantAccount(originUrl);

  const clientRow = db
    .prepare("SELECT * FROM clients WHERE uid = ?")
    .get(clientUid) as
    | {
        uid: string;
        client_id: string;
        display_name: string;
        is_disabled: number;
      }
    | undefined;

  if (clientRow?.is_disabled) {
    throw new Error("Client device is disabled by administrator");
  }

  let profileRow = getProfileRow(clientUid);
  if (!profileRow && clientRow?.client_id) {
    profileRow = getProfileRow(clientRow.client_id);
  }
  if (!profileRow) {
    profileRow = getProfileRow("__default__");
  }

  const mapping: Record<ResourceType, string> = {
    ClassPlan: profileRow?.class_plan_name ?? "default",
    TimeLayout: profileRow?.time_layout_name ?? "default",
    Subjects: profileRow?.subjects_name ?? "default",
    DefaultSettings: profileRow?.default_settings_name ?? "default",
    Policy: profileRow?.policy_name ?? "default",
    Components: profileRow?.components_name ?? "default",
    Credentials: profileRow?.credentials_name ?? "default",
  };

  const manifestFieldMap: Record<ResourceType, string> = {
    ClassPlan: "ClassPlanSource",
    TimeLayout: "TimeLayoutSource",
    Subjects: "SubjectsSource",
    DefaultSettings: "DefaultSettingsSource",
    Policy: "PolicySource",
    Components: "ComponentsSource",
    Credentials: "CredentialSource",
  };

  const baseUrl = originUrl.replace(/\/+$/, "");
  const now = Date.now();
  // Clean expired tokens
  for (const [tk, info] of store.downloadTokens.entries()) {
    if (now > info.expiresAt) {
      store.downloadTokens.delete(tk);
    }
  }

  const rawDisplayName = (clientRow?.display_name || "").trim();
  const rawClientId = (clientRow?.client_id || "").trim();
  const effectiveDisplayName =
    rawDisplayName && rawDisplayName !== clientUid
      ? rawDisplayName
      : rawClientId || "未命名设备";

  const response: Record<string, unknown> = {
    ServerKind: 1,
    CoreVersion: "2.0.0.0",
    ServerFlavor: "miniclassisland-ste",
    ServerSoftware: "MINI ClassIsland STE",
    MiniClassIsland: true,
    OrganizationName: acct.name,
    ClientDisplayName: effectiveDisplayName,
    ClientIdentity: rawClientId,
  };

  for (const [rType, fieldName] of Object.entries(manifestFieldMap) as Array<
    [ResourceType, string]
  >) {
    const rName = mapping[rType];
    if (!rName) {
      response[fieldName] = { Value: "", Version: 0 };
      continue;
    }

    const rFile = db
      .prepare("SELECT version FROM resource_files WHERE resource_type = ? AND name = ?")
      .get(rType, rName) as { version: number } | undefined;
    const version = rFile ? rFile.version : 1;
    const token = crypto.randomBytes(24).toString("base64url");
    store.downloadTokens.set(token, {
      resourceType: rType,
      name: rName,
      clientUid,
      clientIp,
      expiresAt: now + 300 * 1000, // 5 minutes
    });

    response[fieldName] = {
      Value: `${baseUrl}/get?token=${token}`,
      Version: version,
    };
  }

  return response;
}

export function consumeDownloadToken(token: string): unknown {
  const info = store.downloadTokens.get(token);
  if (!info) {
    throw new Error("Invalid or expired download token");
  }
  if (Date.now() > info.expiresAt) {
    store.downloadTokens.delete(token);
    throw new Error("Download token expired");
  }
  store.downloadTokens.delete(token);

  const db = getDb();
  const rFile = db
    .prepare("SELECT content FROM resource_files WHERE resource_type = ? AND name = ?")
    .get(info.resourceType, info.name) as { content: string } | undefined;

  if (!rFile) {
    return DEFAULT_RESOURCES[info.resourceType] ?? {};
  }
  try {
    const rawData = JSON.parse(rFile.content);
    return normalizeResourcePayload(info.resourceType, rawData);
  } catch {
    return DEFAULT_RESOURCES[info.resourceType] ?? {};
  }
}

// ============================================================================
// Client Registration Handler (for Cyrene_MSP ClientRegister gRPC)
// ============================================================================

function normalizeMac(mac: string): string {
  return (mac || "").trim().toUpperCase().replace(/:/g, "-");
}

function createPendingPairingCode(
  db: DatabaseSync,
  clientUid: string,
  clientId: string,
  mac: string,
  ip: string,
  createdAt: string
): string {
  const alreadyIssued = db.prepare("SELECT 1 FROM pairing_codes WHERE client_uid = ? AND code = ?");
  let code = String(crypto.randomInt(100000, 1000000));
  while (alreadyIssued.get(clientUid, code)) {
    code = String(crypto.randomInt(100000, 1000000));
  }
  db.prepare(`
    INSERT INTO pairing_codes (
      id, code, client_uid, client_id, client_mac, client_ip,
      status, approved, used, preset_profile, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, '{}', ?)
  `).run(crypto.randomUUID(), code, clientUid, clientId, mac, ip, createdAt);
  publishSteEvent("pairing.updated", { client_uid: clientUid, code, status: "pending" });
  return code;
}

export async function handleGrpcClientRegister(
  clientUid: string,
  clientId: string,
  clientMac: string,
  clientIp: string
): Promise<{ retcode: number; message: string; serverPublicKey: string }> {
  const db = getDb();
  const { publicKeyArmor } = await ensurePgpKeys();
  const nowIso = new Date().toISOString();

  // Check if client already registered
  const existing = db
    .prepare("SELECT * FROM clients WHERE uid = ?")
    .get(clientUid) as
    | {
        id: number;
        uid: string;
        client_id: string;
        display_name: string;
        mac: string;
        is_disabled: number;
      }
    | undefined;

  if (existing) {
    if (existing.is_disabled) {
      return {
        retcode: 1001, // HandshakeClientRejected
        message: "该客户端设备已被管理员禁用",
        serverPublicKey: "",
      };
    }
    db.prepare(`
      UPDATE clients
      SET client_id = ?, mac = ?, ip = ?, last_seen_at = ?
      WHERE uid = ?
    `).run(
      clientId || existing.client_id,
      clientMac || existing.mac,
      clientIp,
      nowIso,
      clientUid
    );
    return {
      retcode: 10001, // Registered
      message: "Already registered",
      serverPublicKey: publicKeyArmor,
    };
  }

  // Check pre-registered whitelist
  const preRegs = db
    .prepare("SELECT * FROM pre_registered_clients WHERE is_enabled = 1")
    .all() as Array<{
    id: string;
    label: string;
    class_identity: string;
    mac_address: string;
    preset_profile: string;
  }>;

  const normMac = normalizeMac(clientMac);
  let matchedPre: (typeof preRegs)[0] | undefined;

  for (const p of preRegs) {
    const pMac = normalizeMac(p.mac_address);
    const pId = (p.class_identity || "").trim();
    if (pMac && normMac && pMac === normMac) {
      if (!pId || pId === clientId) {
        matchedPre = p;
        break;
      }
    }
    if (pId && pId === clientId && !pMac) {
      matchedPre = p;
      break;
    }
  }

  if (matchedPre) {
    db.prepare(`
      INSERT INTO clients (uid, client_id, display_name, mac, ip, is_disabled, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      clientUid,
      clientId || matchedPre.class_identity,
      matchedPre.label || clientId || clientUid,
      clientMac,
      clientIp,
      nowIso,
      nowIso
    );
    db.prepare("UPDATE pre_registered_clients SET bound_client_uid = ? WHERE id = ?").run(
      clientUid,
      matchedPre.id
    );
    try {
      const preset = JSON.parse(matchedPre.preset_profile || "{}") as ClientProfileConfig;
      if (preset && Object.keys(preset).length > 0) {
        upsertClientProfile(clientUid, preset);
      }
    } catch {
      // Ignore
    }
    publishSteEvent("client.status", {
      client_uid: clientUid,
      reason: "registered_pre_reg",
      is_online: isClientOnline(clientUid),
    });
    return {
      retcode: 10001, // Registered
      message: "Registered via pre-registration",
      serverPublicKey: publicKeyArmor,
    };
  }

  const mode = getPairingStatus().registration_mode;

  if (mode === "open") {
    db.prepare(`
      INSERT INTO clients (uid, client_id, display_name, mac, ip, is_disabled, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      clientUid,
      clientId,
      clientId || "未命名设备",
      clientMac,
      clientIp,
      nowIso,
      nowIso
    );
    publishSteEvent("client.status", {
      client_uid: clientUid,
      reason: "registered_open",
      is_online: isClientOnline(clientUid),
    });
    return {
      retcode: 10001, // Registered
      message: "Registered (open mode)",
      serverPublicKey: publicKeyArmor,
    };
  }

  if (mode === "pre_reg") {
    return {
      retcode: 404, // InvalidRequest
      message: "注册失败：当前仅允许预注册设备接入，请先在预注册客户端中添加设备白名单。",
      serverPublicKey: "",
    };
  }

  // Pairing mode
  const existingCode = db
    .prepare("SELECT * FROM pairing_codes WHERE client_uid = ? AND used = 0 AND status != 'rejected' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(clientUid) as
    | {
        id: string;
        code: string;
        client_id: string;
        client_mac: string;
        approved: number;
        preset_profile: string;
      }
    | undefined;

  if (existingCode && existingCode.approved) {
    db.prepare("UPDATE pairing_codes SET used = 1, status = 'used' WHERE id = ?").run(
      existingCode.id
    );
    db.prepare(`
      INSERT INTO clients (uid, client_id, display_name, mac, ip, is_disabled, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      clientUid,
      clientId || existingCode.client_id,
      clientId || existingCode.client_id || "未命名设备",
      clientMac || existingCode.client_mac,
      clientIp,
      nowIso,
      nowIso
    );
    try {
      const preset = JSON.parse(existingCode.preset_profile || "{}") as ClientProfileConfig;
      if (preset && Object.keys(preset).length > 0) {
        upsertClientProfile(clientUid, preset);
      }
    } catch {
      // Ignore
    }
    publishSteEvent("pairing.updated", {
      id: existingCode.id,
      client_uid: clientUid,
      status: "used",
    });
    publishSteEvent("client.status", {
      client_uid: clientUid,
      reason: "registered_pairing",
      is_online: isClientOnline(clientUid),
    });
    return {
      retcode: 10001, // Registered
      message: "Registered via pairing code",
      serverPublicKey: publicKeyArmor,
    };
  }

  const code = existingCode?.code ?? createPendingPairingCode(db, clientUid, clientId, clientMac, clientIp, nowIso);
  if (existingCode) {
    db.prepare(`
      UPDATE pairing_codes
      SET client_id = ?, client_mac = ?, client_ip = ?
      WHERE id = ?
    `).run(clientId || existingCode.client_id, clientMac || existingCode.client_mac, clientIp, existingCode.id);
  }
  return {
    retcode: 10003, // PairingRequired
    message: `Device requires pairing code to join. Pairing Code: ${code}. Please contact admin for approval.`,
    serverPublicKey: "",
  };
}

export function isClientRegisteredInDb(clientUid: string): "registered" | "unregistered" | "disabled" {
  const db = getDb();
  const row = db
    .prepare("SELECT uid, is_disabled FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; is_disabled: number } | undefined;
  if (!row) return "unregistered";
  if (row.is_disabled) return "disabled";
  return "registered";
}

export function authorizeClientUnregister(
  clientUid: string,
  options: {
    sessionToken?: string;
    clientIp?: string;
    mac?: string;
  }
): { exists: boolean } {
  const db = getDb();
  const existing = db
    .prepare("SELECT uid, ip, mac FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; ip: string; mac: string } | undefined;

  if (!existing) {
    return { exists: false };
  }

  const sessionToken = (options.sessionToken || "").trim();
  if (sessionToken) {
    const sessionRow = db
      .prepare("SELECT client_uid FROM client_sessions WHERE session_token = ?")
      .get(sessionToken) as { client_uid: string } | undefined;
    if (sessionRow && sessionRow.client_uid === clientUid) {
      return { exists: true };
    }
  }

  const reqIp = (options.clientIp || "").trim();
  const recIp = (existing.ip || "").trim();
  if (reqIp && recIp && reqIp === recIp) {
    return { exists: true };
  }

  const reqMac = normalizeMac(options.mac || "");
  const recMac = normalizeMac(existing.mac || "");
  if (reqMac && recMac && reqMac === recMac) {
    return { exists: true };
  }

  throw new SteHttpError(403, "Unauthorized client unregistration request");
}

export async function handleGrpcClientUnRegister(
  clientUid: string,
  clientMac = ""
): Promise<{
  retcode: number;
  message: string;
}> {
  const db = getDb();
  let existing = db
    .prepare("SELECT uid FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string } | undefined;
  if (!existing && clientMac) {
    const normMac = normalizeMac(clientMac);
    const all = db
      .prepare("SELECT uid, mac FROM clients")
      .all() as Array<{ uid: string; mac: string }>;
    existing = all.find((c) => normalizeMac(c.mac) === normMac);
  }
  if (!existing) {
    return { retcode: 10002, message: "Client not found" };
  }
  await deleteClientDevice(existing.uid, false);
  return { retcode: 200, message: "Unregistered" };
}

export async function pollClientPairingStatus(
  clientUid: string,
  code = "",
  classId = "",
  mac = "",
  clientIp = "127.0.0.1"
): Promise<{
  status: "approved" | "registered" | "rejected" | "pending";
  approved: boolean;
  registered: boolean;
  code: string;
  client_uid: string;
  client_id: string;
  serverPublicKey: string;
  ServerFlavor: string;
  server_flavor: string;
}> {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const { publicKeyArmor } = await ensurePgpKeys();

  const existingClient = db
    .prepare("SELECT uid, client_id, is_disabled FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; client_id: string; is_disabled: number } | undefined;

  if (existingClient) {
    if (existingClient.is_disabled) {
      return {
        status: "rejected",
        approved: false,
        registered: false,
        code: "",
        client_uid: clientUid,
        client_id: existingClient.client_id || classId,
        serverPublicKey: "",
        ServerFlavor: "miniclassisland-ste",
        server_flavor: "miniclassisland-ste",
      };
    }
    return {
      status: "registered",
      approved: true,
      registered: true,
      code: "",
      client_uid: clientUid,
      client_id: existingClient.client_id || classId,
      serverPublicKey: publicKeyArmor,
      ServerFlavor: "miniclassisland-ste",
      server_flavor: "miniclassisland-ste",
    };
  }

  const requestedCode = code.trim();
  const pairingRow = requestedCode
    ? db.prepare("SELECT * FROM pairing_codes WHERE client_uid = ? AND code = ? AND used = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(clientUid, requestedCode)
    : db.prepare("SELECT * FROM pairing_codes WHERE client_uid = ? AND used = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(clientUid);
  const pcRow = pairingRow as {
    id: string;
    code: string;
    client_id: string;
    client_mac: string;
    client_ip: string;
    status: string;
    approved: number;
    preset_profile: string;
  } | undefined;

  if (pcRow) {
    if (pcRow.status === "rejected") {
      return {
        status: "rejected",
        approved: false,
        registered: false,
        code: pcRow.code,
        client_uid: clientUid,
        client_id: pcRow.client_id || classId,
        serverPublicKey: "",
        ServerFlavor: "miniclassisland-ste",
        server_flavor: "miniclassisland-ste",
      };
    }
    if (pcRow.approved || pcRow.status === "approved") {
      const effectiveClassId = classId.trim() || pcRow.client_id || "";
      const effectiveMac = mac.trim() || pcRow.client_mac || "";
      const effectiveIp = clientIp || pcRow.client_ip || "127.0.0.1";
      db.prepare("UPDATE pairing_codes SET used = 1, status = 'used' WHERE id = ?").run(pcRow.id);
      db.prepare(`
        INSERT OR REPLACE INTO clients (uid, client_id, display_name, mac, ip, is_disabled, registered_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        clientUid,
        effectiveClassId,
        effectiveClassId || "未命名设备",
        effectiveMac,
        effectiveIp,
        nowIso,
        nowIso
      );
      try {
        const preset = JSON.parse(pcRow.preset_profile || "{}") as ClientProfileConfig;
        if (preset && Object.keys(preset).length > 0) {
          upsertClientProfile(clientUid, preset);
        }
      } catch {
        // Ignore
      }
      publishSteEvent("pairing.updated", {
        id: pcRow.id,
        client_uid: clientUid,
        status: "used",
      });
      publishSteEvent("client.status", {
        client_uid: clientUid,
        reason: "registered_pairing_poll",
        is_online: isClientOnline(clientUid),
      });
      return {
        status: "approved",
        approved: true,
        registered: true,
        code: pcRow.code,
        client_uid: clientUid,
        client_id: effectiveClassId,
        serverPublicKey: publicKeyArmor,
        ServerFlavor: "miniclassisland-ste",
        server_flavor: "miniclassisland-ste",
      };
    }
    return {
      status: "pending",
      approved: false,
      registered: false,
      code: pcRow.code,
      client_uid: clientUid,
      client_id: pcRow.client_id || classId,
      serverPublicKey: "",
      ServerFlavor: "miniclassisland-ste",
      server_flavor: "miniclassisland-ste",
    };
  }

  const mode = getPairingStatus().registration_mode;
  if (mode === "pairing" && !requestedCode) {
    const newCode = createPendingPairingCode(db, clientUid, classId, mac, clientIp, nowIso);
    return {
      status: "pending",
      approved: false,
      registered: false,
      code: newCode,
      client_uid: clientUid,
      client_id: classId,
      serverPublicKey: "",
      ServerFlavor: "miniclassisland-ste",
      server_flavor: "miniclassisland-ste",
    };
  }

  return {
    status: "pending",
    approved: false,
    registered: false,
    code: code.trim(),
    client_uid: clientUid,
    client_id: classId,
    serverPublicKey: "",
    ServerFlavor: "miniclassisland-ste",
    server_flavor: "miniclassisland-ste",
  };
}

export { encodeClassIslandCredential };

// ============================================================================
// Ephemeral RemoteEdit & AssistAnother Coordination
// ============================================================================

const EDIT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_EDIT_PAYLOAD_BYTES = 512 * 1024;
const MAX_EDIT_PAYLOAD_DEPTH = 64;

type SteEditSessionRecord = NonNullable<
  ReturnType<NonNullable<typeof g.__miniclassisland_ste_store>["editSessions"]["get"]>
>;

function sha256Hex(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function sanitizeEditSessionSummary(s: SteEditSessionRecord): EditSessionSummary {
  return {
    session_id: s.session_id,
    mode: s.mode,
    account_id: SINGLE_ACCOUNT_ID,
    role: "owner",
    editor_client_uid: s.editor_client_uid,
    editor_display_name: s.editor_display_name,
    target_client_uid: s.target_client_uid,
    target_display_name: s.target_display_name,
    initial_view: s.initial_view,
    allowed_scopes: [...s.allowed_scopes],
    resource_targets: { ...s.resource_targets },
    base_versions: { ...s.base_versions },
    created_at: s.created_at,
    expires_at: new Date(s.expires_at_ms).toISOString(),
    last_sequence: s.last_sequence,
  };
}

function validateSteResourceName(name: string): string {
  const cleaned = (name || "").trim();
  if (
    !cleaned ||
    cleaned.length > 128 ||
    cleaned.includes("/") ||
    cleaned.includes("\\") ||
    cleaned.includes("..")
  ) {
    throw new SteHttpError(400, "Invalid resource file name");
  }
  return cleaned;
}

function validateStePayload(obj: unknown, depth = 0): void {
  if (depth > MAX_EDIT_PAYLOAD_DEPTH) {
    throw new SteHttpError(400, "Payload nesting depth exceeded limit");
  }
  if (depth === 0) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      throw new SteHttpError(400, "Payload must be a JSON object");
    }
    const bytes = Buffer.byteLength(JSON.stringify(obj), "utf-8");
    if (bytes > MAX_EDIT_PAYLOAD_BYTES) {
      throw new SteHttpError(400, "Payload size exceeds 512KB limit");
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) validateStePayload(item, depth + 1);
  } else if (obj && typeof obj === "object") {
    for (const val of Object.values(obj)) validateStePayload(val, depth + 1);
  }
}

async function pollCompletedConfigUpload(
  requestGuid: string,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  const db = getDb();
  let wakeResolve: (() => void) | null = null;
  const unsub = subscribeSteEnvelopes((env) => {
    if (
      env.event === "command.completed" &&
      String(env.data?.request_guid || "") === requestGuid &&
      wakeResolve
    ) {
      const fn = wakeResolve;
      wakeResolve = null;
      fn();
    }
  });

  try {
    while (true) {
      const row = db
        .prepare("SELECT status, payload FROM config_uploads WHERE request_guid = ?")
        .get(requestGuid) as { status: string; payload: string } | undefined;
      if (row && row.status === "completed") {
        const raw = (row.payload || "").trim();
        if (!raw) return {};
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new SteHttpError(502, "Target client returned invalid JSON snapshot");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { value: parsed };
        }
        const rec = parsed as Record<string, unknown>;
        if ("requestGuid" in rec && "success" in rec) {
          if (!rec.success) {
            throw new SteHttpError(
              502,
              String(rec.message || "Target client failed to capture snapshot")
            );
          }
          return rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
            ? (rec.data as Record<string, unknown>)
            : {};
        }
        return rec;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SteHttpError(504, "Timed out waiting for target client live snapshot");
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wakeResolve = null;
          resolve();
        }, Math.min(remaining, 1000));
        wakeResolve = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  } finally {
    unsub();
  }
}

function getValidatedSteClientSession(
  clientUid: string,
  sessionId: string,
  token: string
): SteEditSessionRecord {
  const cleanToken = (token || "").trim();
  if (!cleanToken) {
    throw new SteHttpError(401, "Missing X-Edit-Session-Token");
  }
  const session = store.editSessions.get(sessionId);
  if (!session || Date.now() > session.expires_at_ms) {
    store.editSessions.delete(sessionId);
    throw new SteHttpError(404, "Edit session not found or expired");
  }
  const expectedBuf = Buffer.from(session.token_sha256, "hex");
  const actualBuf = Buffer.from(sha256Hex(cleanToken), "hex");
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new SteHttpError(403, "Invalid edit session token");
  }
  if (session.editor_client_uid !== clientUid) {
    throw new SteHttpError(403, "Client UID does not match editor session");
  }
  return session;
}

const STE_VIEW_SCOPES: Record<EditSessionInitialView, string[]> = {
  classplan: ["ClassPlan"],
  timelayout: ["TimeLayout"],
  subjects: ["Subjects"],
  settings: ["DefaultSettings"],
  components: ["Components"],
  policy: ["Policy"],
  credentials: ["Credentials"],
  profile: ["ClassPlan", "TimeLayout", "Subjects"],
};

function resolveSteViewScopes(initialView: EditSessionInitialView): {
  allowedScopes: string[];
  lookupScopes: string[];
} {
  const allowedScopes = [...(STE_VIEW_SCOPES[initialView] || ["ClassPlan", "TimeLayout", "Subjects"])];
  const lookupScopes = [...allowedScopes];
  if (allowedScopes.includes("ClassPlan")) {
    for (const dep of ["TimeLayout", "Subjects"]) {
      if (!lookupScopes.includes(dep)) lookupScopes.push(dep);
    }
  } else if (allowedScopes.includes("TimeLayout")) {
    if (!lookupScopes.includes("Subjects")) lookupScopes.push("Subjects");
  }
  return { allowedScopes, lookupScopes };
}

export async function createEditSessionFromConsole(
  req: EditSessionCreateRequest
): Promise<{ status: string; command_request_guid: string; session: EditSessionSummary }> {
  const db = getDb();
  const editorUid = (req.editor_client_uid || "").trim();
  if (!editorUid) {
    throw new SteHttpError(400, "editor_client_uid is required");
  }
  const editorRow = db
    .prepare("SELECT uid, client_id, display_name, is_disabled FROM clients WHERE uid = ?")
    .get(editorUid) as
    | { uid: string; client_id: string; display_name: string; is_disabled: number }
    | undefined;
  if (!editorRow) throw new SteHttpError(404, "Editor client not found");
  if (editorRow.is_disabled) throw new SteHttpError(403, "Editor client is disabled");

  const editorExt = getClientExtendStatus(editorUid);
  if (!editorExt.enabled) {
    throw new SteHttpError(400, "Editor client does not have Extend Management Engine installed");
  }
  if (editorExt.isAppLocked) {
    throw new SteHttpError(409, "Editor client is currently locked");
  }
  if (!isClientOnline(editorUid)) {
    throw new SteHttpError(409, "Editor client is offline");
  }

  const initialView: EditSessionInitialView = req.initial_view || "profile";
  const { allowedScopes, lookupScopes } = resolveSteViewScopes(initialView);
  const requestedTargets = req.resource_targets || {};
  for (const [rt, rn] of Object.entries(requestedTargets)) {
    if (!(rt in RESOURCE_TO_PROFILE_KEY)) {
      throw new SteHttpError(400, `Invalid resource type: ${rt}`);
    }
    validateSteResourceName(rn);
    if (!lookupScopes.includes(rt)) {
      throw new SteHttpError(403, `Scope '${rt}' is not allowed for view '${initialView}'`);
    }
  }

  const targetUid = (req.target_client_uid || "").trim() || null;
  let targetDisplayName = "";
  const resourceTargets: Record<string, string> = {};
  const baseVersions: Record<string, number> = {};
  let relaySnapshot: Record<string, unknown> | null = null;
  let targetPluginComponents: unknown[] = [];
  let targetPluginSettings: unknown[] = [];

  if (req.mode === "RemoteEdit") {
    let refProfile: ClientProfileConfig | null = null;
    if (targetUid) {
      const tRow = db
        .prepare("SELECT uid, client_id, display_name FROM clients WHERE uid = ?")
        .get(targetUid) as { uid: string; client_id: string; display_name: string } | undefined;
      if (!tRow) throw new SteHttpError(404, "Target client not found");
      targetDisplayName = tRow.display_name || tRow.client_id || tRow.uid;
      refProfile = getClientProfileConfig(targetUid).profile_config;
    } else {
      refProfile = getClientProfileConfig("__default__").profile_config;
    }

    for (const rt of lookupScopes) {
      const explicitName = requestedTargets[rt];
      const profKey = RESOURCE_TO_PROFILE_KEY[rt];
      const resolvedName = explicitName
        ? validateSteResourceName(explicitName)
        : (refProfile?.[profKey] || "default");
      resourceTargets[rt] = resolvedName;

      const row = db
        .prepare("SELECT version FROM resource_files WHERE resource_type = ? AND name = ?")
        .get(rt, resolvedName) as { version: number } | undefined;
      if (!row && explicitName) {
        throw new SteHttpError(404, `Resource ${rt}/${resolvedName} not found`);
      }
      if (allowedScopes.includes(rt)) {
        baseVersions[rt] = row ? row.version : 0;
      }
    }
  } else {
    if (!targetUid) {
      throw new SteHttpError(400, "target_client_uid is required for AssistAnother");
    }
    if (targetUid === editorUid) {
      throw new SteHttpError(400, "Editor client and target client cannot be the same device");
    }
    const targetRow = db
      .prepare("SELECT uid, client_id, display_name, is_disabled FROM clients WHERE uid = ?")
      .get(targetUid) as
      | { uid: string; client_id: string; display_name: string; is_disabled: number }
      | undefined;
    if (!targetRow) throw new SteHttpError(404, "Target client not found");
    if (targetRow.is_disabled) throw new SteHttpError(403, "Target client is disabled");

    const targetExt = getClientExtendStatus(targetUid);
    if (!targetExt.enabled) {
      throw new SteHttpError(400, "Target client does not have Extend Management Engine installed");
    }
    if (!isClientOnline(targetUid)) {
      throw new SteHttpError(409, "Target client is offline");
    }

    targetDisplayName = targetRow.display_name || targetRow.client_id || targetRow.uid;
    const rawComps = targetExt.pluginComponents;
    targetPluginComponents = Array.isArray(rawComps)
      ? rawComps
      : rawComps && typeof rawComps === "object" && Array.isArray((rawComps as Record<string, unknown>).components)
        ? ((rawComps as Record<string, unknown>).components as unknown[])
        : [];
    const rawSets = targetExt.pluginSettings;
    targetPluginSettings = Array.isArray(rawSets)
      ? rawSets
      : rawSets && typeof rawSets === "object" && Array.isArray((rawSets as Record<string, unknown>).settings)
        ? ((rawSets as Record<string, unknown>).settings as unknown[])
        : [];

    const captureRes = await sendExtendCommandToClient(
      targetUid,
      "assist.capture_snapshot",
      { scopes: lookupScopes, initial_view: initialView },
      30
    );
    relaySnapshot = await pollCompletedConfigUpload(captureRes.request_guid, 5000);
  }

  const sessionId = crypto.randomBytes(16).toString("hex");
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const nowIso = new Date().toISOString();
  const expiresAtMs = Date.now() + EDIT_SESSION_TTL_MS;

  const session: SteEditSessionRecord = {
    session_id: sessionId,
    token_sha256: sha256Hex(rawToken),
    mode: req.mode,
    editor_client_uid: editorUid,
    editor_display_name: editorRow.display_name || editorRow.client_id || editorUid,
    target_client_uid: targetUid,
    target_display_name: targetDisplayName,
    initial_view: initialView,
    allowed_scopes: allowedScopes,
    resource_targets: resourceTargets,
    base_versions: baseVersions,
    relay_snapshot: relaySnapshot,
    target_plugin_components: targetPluginComponents,
    target_plugin_settings: targetPluginSettings,
    created_at: nowIso,
    expires_at_ms: expiresAtMs,
    last_sequence: 0,
  };
  store.editSessions.set(sessionId, session);

  let openRes: { request_guid: string };
  try {
    openRes = await sendExtendCommandToClient(
      editorUid,
      "edit_session.open",
      {
        session_id: sessionId,
        token: rawToken,
        mode: req.mode,
        account_id: SINGLE_ACCOUNT_ID,
        editor_client_uid: editorUid,
        target_client_uid: targetUid,
        target_display_name: targetDisplayName,
        initial_view: initialView,
        allowed_scopes: allowedScopes,
        resource_targets: resourceTargets,
        base_versions: baseVersions,
        expires_in_seconds: Math.floor(EDIT_SESSION_TTL_MS / 1000),
      },
      60
    );
  } catch (err) {
    store.editSessions.delete(sessionId);
    throw err;
  }

  publishSteEvent("edit_session.updated", {
    session_id: sessionId,
    status: "opened",
    action: "created",
    mode: req.mode,
    initial_view: initialView,
    allowed_scopes: allowedScopes,
    resource_targets: resourceTargets,
    editor_client_uid: editorUid,
    target_client_uid: targetUid,
  });

  return {
    status: "success",
    command_request_guid: openRes.request_guid,
    session: sanitizeEditSessionSummary(session),
  };
}

export function listEditSessions(): { sessions: EditSessionSummary[] } {
  const now = Date.now();
  const out: EditSessionSummary[] = [];
  for (const [id, session] of store.editSessions.entries()) {
    if (session.expires_at_ms <= now) {
      store.editSessions.delete(id);
      continue;
    }
    out.push(sanitizeEditSessionSummary(session));
  }
  out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { sessions: out };
}

export async function closeEditSessionFromConsole(
  sessionId: string
): Promise<{ status: string; session_id: string }> {
  const existing = store.editSessions.get(sessionId);
  if (!existing) {
    throw new SteHttpError(404, "Edit session not found");
  }
  store.editSessions.delete(sessionId);
  try {
    if (isClientOnline(existing.editor_client_uid)) {
      await sendExtendCommandToClient(
        existing.editor_client_uid,
        "edit_session.close",
        { session_id: sessionId, reason: "closed_by_console" },
        60
      );
    }
  } catch {
    // Best-effort notify
  }
  publishSteEvent("edit_session.updated", {
    session_id: sessionId,
    status: "closed",
    action: "closed",
    mode: existing.mode,
    initial_view: existing.initial_view,
    allowed_scopes: existing.allowed_scopes,
    resource_targets: existing.resource_targets,
    editor_client_uid: existing.editor_client_uid,
    target_client_uid: existing.target_client_uid,
  });
  return { status: "success", session_id: sessionId };
}

export function bootstrapClientEditSession(
  clientUid: string,
  sessionId: string,
  token: string
): Record<string, unknown> {
  const session = getValidatedSteClientSession(clientUid, sessionId, token);
  const db = getDb();
  const editorRow = db
    .prepare("SELECT is_disabled FROM clients WHERE uid = ?")
    .get(clientUid) as { is_disabled: number } | undefined;
  if (!editorRow) throw new SteHttpError(404, "Editor client not found");
  if (editorRow.is_disabled) throw new SteHttpError(403, "Editor client is disabled");
  if (getClientExtendStatus(clientUid).isAppLocked) {
    throw new SteHttpError(409, "Editor client is currently locked");
  }

  session.expires_at_ms = Date.now() + EDIT_SESSION_TTL_MS;

  if (session.mode === "AssistAnother") {
    return {
      status: "ok",
      mode: "AssistAnother",
      session_id: sessionId,
      target_client_uid: session.target_client_uid,
      target_display_name: session.target_display_name,
      initial_view: session.initial_view,
      allowed_scopes: session.allowed_scopes,
      snapshot: session.relay_snapshot || {},
      plugin_components: session.target_plugin_components || [],
      plugin_settings: session.target_plugin_settings || [],
    };
  }

  const readableScopes = new Set(session.allowed_scopes);
  if (readableScopes.has("ClassPlan")) {
    readableScopes.add("TimeLayout");
    readableScopes.add("Subjects");
  } else if (readableScopes.has("TimeLayout")) {
    readableScopes.add("Subjects");
  }

  const resources: Record<string, unknown> = {};
  const versions: Record<string, number> = {};
  for (const [rt, name] of Object.entries(session.resource_targets)) {
    if (!readableScopes.has(rt)) continue;
    const row = db
      .prepare("SELECT content, version FROM resource_files WHERE resource_type = ? AND name = ?")
      .get(rt, name) as { content: string; version: number } | undefined;
    let parsed: unknown = DEFAULT_RESOURCES[rt] ?? {};
    if (row) {
      try {
        parsed = JSON.parse(row.content || "{}");
      } catch {
        parsed = {};
      }
      if (session.allowed_scopes.includes(rt)) {
        versions[rt] = row.version || 1;
      }
    } else if (session.allowed_scopes.includes(rt)) {
      versions[rt] = 0;
    }
    resources[rt] = normalizeResourcePayload(rt, parsed);
  }
  session.base_versions = { ...versions };

  const allComponents = getAggregatedPluginComponents().components;
  const pluginSettings: unknown[] = [];
  const seenSettings = new Set<string>();
  for (const client of listClients()) {
    const rawSet = client.plugin_settings;
    const arr = Array.isArray(rawSet)
      ? rawSet
      : rawSet && typeof rawSet === "object" && Array.isArray((rawSet as Record<string, unknown>).settings)
        ? ((rawSet as Record<string, unknown>).settings as unknown[])
        : [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const sid = String(obj.id || obj.Id || "");
      if (sid && seenSettings.has(sid)) continue;
      if (sid) seenSettings.add(sid);
      pluginSettings.push(obj);
    }
  }

  return {
    status: "ok",
    mode: "RemoteEdit",
    session_id: sessionId,
    target_client_uid: session.target_client_uid,
    target_display_name: session.target_display_name,
    initial_view: session.initial_view,
    allowed_scopes: session.allowed_scopes,
    resource_targets: session.resource_targets,
    versions,
    resources,
    plugin_components: allComponents,
    plugin_settings: pluginSettings,
  };
}

export async function syncClientEditSession(
  clientUid: string,
  sessionId: string,
  token: string,
  body: {
    changes?: Record<string, unknown>;
    base_versions?: Record<string, number>;
    force?: boolean;
    notify_clients?: boolean;
    sequence?: number;
  }
): Promise<Record<string, unknown>> {
  const session = getValidatedSteClientSession(clientUid, sessionId, token);
  const db = getDb();
  const editorRow = db
    .prepare("SELECT is_disabled FROM clients WHERE uid = ?")
    .get(clientUid) as { is_disabled: number } | undefined;
  if (!editorRow) throw new SteHttpError(404, "Editor client not found");
  if (editorRow.is_disabled) throw new SteHttpError(403, "Editor client is disabled");
  if (getClientExtendStatus(clientUid).isAppLocked) {
    throw new SteHttpError(409, "Editor client is currently locked");
  }

  if (body.sequence !== undefined && body.sequence <= session.last_sequence) {
    return { status: "ignored_stale", last_sequence: session.last_sequence };
  }
  const nextSeq = body.sequence !== undefined ? body.sequence : session.last_sequence + 1;
  const changes = body.changes || {};
  for (const [scope, scopePayload] of Object.entries(changes)) {
    if (!session.allowed_scopes.includes(scope)) {
      throw new SteHttpError(403, `Scope '${scope}' is not permitted in this edit session`);
    }
    validateStePayload(scopePayload);
  }

  session.expires_at_ms = Date.now() + EDIT_SESSION_TTL_MS;

  if (session.mode === "AssistAnother") {
    const targetUid = (session.target_client_uid || "").trim();
    if (!targetUid || !isClientOnline(targetUid)) {
      throw new SteHttpError(409, "Target client is offline");
    }
    let reqGuid = "";
    if (Object.keys(changes).length > 0) {
      const relayRes = await sendExtendCommandToClient(
        targetUid,
        "assist.apply_snapshot",
        {
          session_id: sessionId,
          editor_client_uid: clientUid,
          changes,
          sequence: nextSeq,
        },
        60
      );
      reqGuid = relayRes.request_guid;
    }
    const nextSnapshot = { ...(session.relay_snapshot || {}) };
    for (const [k, v] of Object.entries(changes)) {
      nextSnapshot[k] = v;
    }
    session.relay_snapshot = nextSnapshot;
    session.last_sequence = nextSeq;
    publishSteEvent("edit_session.updated", {
      session_id: sessionId,
      status: "synced",
      mode: "AssistAnother",
      editor_client_uid: clientUid,
      target_client_uid: targetUid,
      sequence: nextSeq,
    });
    return {
      status: "ok",
      mode: "AssistAnother",
      relayed_scopes: Object.keys(changes),
      last_sequence: nextSeq,
      command_request_guid: reqGuid,
    };
  }

  const updatedTargets: Array<[string, string]> = [];
  const nextVersions = { ...session.base_versions };
  const reqVersions = body.base_versions || {};

  for (const [rt, rawPayload] of Object.entries(changes)) {
    const resName = validateSteResourceName(session.resource_targets[rt] || "default");
    const expectedVer = reqVersions[rt] ?? nextVersions[rt];
    const writeRes = writeResource(rt, resName, rawPayload, {
      sync: false,
      expectedVersion: expectedVer,
      force: Boolean(body.force),
    });
    nextVersions[rt] = writeRes.version;
    updatedTargets.push([rt, resName]);
  }

  const syncResults: Record<string, { matched_clients: number; notified_clients: number }> = {};
  if (body.notify_clients) {
    const targetsToNotify: Array<[string, string]> =
      updatedTargets.length > 0
        ? updatedTargets
        : Object.entries(session.resource_targets).filter(([rt]) =>
            session.allowed_scopes.includes(rt)
          );
    for (const [rt, rn] of targetsToNotify) {
      syncResults[rt] = notifyClientsForResourceUpdate(rt, rn);
    }
  }

  session.base_versions = nextVersions;
  session.last_sequence = nextSeq;
  const scopedTargets: Record<string, string> = {};
  for (const rt of session.allowed_scopes) {
    scopedTargets[rt] = session.resource_targets[rt] || "default";
  }
  const updatedResources = updatedTargets.map(([rt, rn]) => ({
    resource_type: rt,
    name: rn,
    version: nextVersions[rt],
  }));
  publishSteEvent("edit_session.updated", {
    session_id: sessionId,
    status: "synced",
    action: "synced",
    mode: "RemoteEdit",
    initial_view: session.initial_view,
    allowed_scopes: session.allowed_scopes,
    resource_targets: scopedTargets,
    updated_resources: updatedResources,
    editor_client_uid: clientUid,
    target_client_uid: session.target_client_uid,
    sequence: nextSeq,
  });
  return {
    status: "ok",
    mode: "RemoteEdit",
    versions: nextVersions,
    last_sequence: nextSeq,
    ...(body.notify_clients ? { sync: syncResults } : {}),
  };
}

export function closeClientEditSession(
  clientUid: string,
  sessionId: string,
  token: string
): { status: string; session_id: string } {
  const session = getValidatedSteClientSession(clientUid, sessionId, token);
  store.editSessions.delete(sessionId);
  publishSteEvent("edit_session.updated", {
    session_id: sessionId,
    status: "closed",
    action: "closed",
    mode: session.mode,
    initial_view: session.initial_view,
    allowed_scopes: session.allowed_scopes,
    resource_targets: session.resource_targets,
    editor_client_uid: session.editor_client_uid,
    target_client_uid: session.target_client_uid,
  });
  return { status: "closed", session_id: sessionId };
}
