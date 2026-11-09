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
import type {
  AccountOut,
  ClientDeviceOut,
  ClientProfileConfig,
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
}

const g = globalThis as unknown as { __miniclassisland_ste_store?: GlobalStore };
if (!g.__miniclassisland_ste_store) {
  g.__miniclassisland_ste_store = {
    activeStreams: new Map(),
    pendingQueues: new Map(),
    pendingHandshakes: new Map(),
    grpcSessions: new Map(),
    downloadTokens: new Map(),
  };
}
const store = g.__miniclassisland_ste_store;

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

export async function ensurePgpKeys(): Promise<{ privateKeyArmor: string; publicKeyArmor: string }> {
  const db = getDb();
    const row = db
      .prepare("SELECT pgp_private_key, pgp_public_key FROM system_config WHERE id = 1")
      .get() as { pgp_private_key: string; pgp_public_key: string } | undefined;

    if (row && row.pgp_private_key && row.pgp_public_key) {
      return {
        privateKeyArmor: row.pgp_private_key,
        publicKeyArmor: row.pgp_public_key,
      };
    }

    if (!store.pgpInitPromise) {
      store.pgpInitPromise = (async () => {
        const { privateKey, publicKey } = await openpgp.generateKey({
          type: "rsa",
          rsaBits: 2048,
          userIDs: [{ name: "MINI ClassIsland Server", email: "msp@miniclassisland.local" }],
          format: "armored",
        });
        db.prepare(`
          UPDATE system_config
          SET pgp_private_key = ?, pgp_public_key = ?, updated_at = ?
          WHERE id = 1
        `).run(privateKey, publicKey, new Date().toISOString());
      })();
    }

    await store.pgpInitPromise;
    const updated = db
      .prepare("SELECT pgp_private_key, pgp_public_key FROM system_config WHERE id = 1")
      .get() as { pgp_private_key: string; pgp_public_key: string };
    return {
      privateKeyArmor: updated.pgp_private_key,
      publicKeyArmor: updated.pgp_public_key,
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

export function getTenantAccount(originFallback = "http://localhost:21196"): AccountOut & { server_url?: string } {
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
  const baseUrl = (row.server_url || originFallback).replace(/\/+$/, "");
  return {
    id: SINGLE_ACCOUNT_ID,
    name: row.name,
    slug: row.slug || "default",
    api_key: row.api_key,
    registration_mode: row.registration_mode || "pairing",
    is_active: true,
    created_at: row.created_at,
    server_url: row.server_url || "",
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
  const nextUrl = data.server_url !== undefined ? data.server_url.trim() : current.server_url;

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
  const acct = getTenantAccount(originFallback);
  const baseUrl = (acct.server_url || originFallback).replace(/\/+$/, "");
  return {
    IsManagementEnabled: true,
    ManagementServerKind: 1,
    ManagementServer: `${baseUrl}/api/v1/client/{id}/manifest`,
    ManagementServerGrpc: baseUrl,
    ManifestUrlTemplate: `${baseUrl}/api/v1/client/{id}/manifest`,
    ClassIdentity: classIdentity ?? "",
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
  set.add(listener);

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

export function writeResource(
  resourceType: string,
  name: string,
  body: unknown
): { status: string; version: number } {
  const db = getDb();
  const normalized = normalizeResourcePayload(resourceType, body);
  const contentStr = JSON.stringify(normalized);
  const nowIso = new Date().toISOString();

  const existing = db
    .prepare("SELECT id, content, version FROM resource_files WHERE resource_type = ? AND name = ?")
    .get(resourceType, name) as { id: number; content: string; version: number } | undefined;

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

  broadcastDataUpdatedToAllOnline();
  return { status: "saved", version: nextVer };
}

export function deleteResource(resourceType: string, name: string): { status: string } {
  const db = getDb();
  db.prepare("DELETE FROM resource_files WHERE resource_type = ? AND name = ?").run(
    resourceType,
    name
  );
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
    return {
      uid: c.uid,
      client_id: c.client_id || "",
      display_name: c.display_name || c.client_id || c.uid,
      mac: c.mac || "",
      ip: c.ip || "",
      is_disabled: Boolean(c.is_disabled),
      status: online ? "online" : "offline",
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
  return { status: "updated", display_name: nextName, client_id: nextId };
}

export function disableClientDevice(clientUid: string): { status: string } {
  const db = getDb();
  db.prepare("UPDATE clients SET is_disabled = 1 WHERE uid = ?").run(clientUid);
  disconnectClientSession(clientUid);
  return { status: "disabled" };
}

export function enableClientDevice(clientUid: string): { status: string } {
  const db = getDb();
  db.prepare("UPDATE clients SET is_disabled = 0 WHERE uid = ?").run(clientUid);
  return { status: "enabled" };
}

export function deleteClientDevice(clientUid: string): { status: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT uid, client_id FROM clients WHERE uid = ?")
    .get(clientUid) as { uid: string; client_id: string } | undefined;
  if (!row) throw new Error("客户端不存在");

  db.prepare("DELETE FROM client_profiles WHERE client_id = ?").run(clientUid);
  if (row.client_id) {
    db.prepare("DELETE FROM client_profiles WHERE client_id = ?").run(row.client_id);
  }
  db.prepare("DELETE FROM clients WHERE uid = ?").run(clientUid);
  disconnectClientSession(clientUid);
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

export function batchClientsAction(body: {
  client_uids: string[];
  action: "force_sync" | "restart" | "disconnect" | "enable" | "disable" | "delete" | "assign_profile";
  profile_config?: ClientProfileConfig;
}): { status: string; affected: number } {
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
    } else if (body.action === "delete") {
      try {
        deleteClientDevice(uid);
        affected++;
      } catch {
        // Ignore missing
      }
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

  const signedEnvelopeGuid = await buildSignedCommandEnvelope(
    reqGuid,
    clientUid,
    cleanAction,
    payload || {},
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
  dispatched_count: number;
  total_targets: number;
  items: Array<{ client_uid: string; request_guid: string }>;
}> {
  const cleanAction = (action || "").trim();
  if (!cleanAction) {
    throw new Error("action 不能为空");
  }
  const targets =
    targetClientUids && targetClientUids.length > 0
      ? targetClientUids
      : getOnlineClientUids();

  const items: Array<{ client_uid: string; request_guid: string }> = [];
  for (const uid of targets) {
    const res = await sendExtendCommandToClient(uid, cleanAction, payload, ttlSeconds);
    items.push({ client_uid: uid, request_guid: res.request_guid });
  }
  return {
    status: "broadcast_queued",
    action: cleanAction,
    dispatched_count: items.length,
    total_targets: targets.length,
    items,
  };
}

export function saveClientConfigUpload(requestGuid: string, payload: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM config_uploads WHERE request_guid = ?")
    .get(requestGuid.trim()) as { id: number } | undefined;
  if (!row) return false;
  db.prepare(`
    UPDATE config_uploads
    SET payload = ?, status = 'completed', uploaded_at = ?
    WHERE id = ?
  `).run(payload || "", new Date().toISOString(), row.id);
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
  return { status: "approved" };
}

export function rejectPairingCode(pairingId: string): { status: string } {
  const db = getDb();
  db.prepare("UPDATE pairing_codes SET approved = 0, status = 'rejected' WHERE id = ?").run(
    pairingId
  );
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
  db.prepare(`
    INSERT INTO audit_logs (client_uid, event_type, payload_b64, decoded_json, timestamp_utc, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    clientUid,
    eventType,
    payloadB64,
    JSON.stringify(decoded),
    timestampUtc,
    new Date().toISOString()
  );
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
    .prepare("SELECT * FROM pairing_codes WHERE client_uid = ? AND used = 0 ORDER BY created_at DESC LIMIT 1")
    .get(clientUid) as
    | {
        id: string;
        code: string;
        status: string;
        approved: number;
        preset_profile: string;
      }
    | undefined;

  if (existingCode && existingCode.status === "rejected") {
    return {
      retcode: 1001, // HandshakeClientRejected
      message: `配对请求已被管理员拒绝 (配对码: ${existingCode.code})`,
      serverPublicKey: "",
    };
  }

  if (existingCode && existingCode.approved) {
    db.prepare("UPDATE pairing_codes SET used = 1, status = 'used' WHERE id = ?").run(
      existingCode.id
    );
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
    try {
      const preset = JSON.parse(existingCode.preset_profile || "{}") as ClientProfileConfig;
      if (preset && Object.keys(preset).length > 0) {
        upsertClientProfile(clientUid, preset);
      }
    } catch {
      // Ignore
    }
    return {
      retcode: 10001, // Registered
      message: "Registered via pairing code",
      serverPublicKey: publicKeyArmor,
    };
  }

  if (!existingCode) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(`
      INSERT INTO pairing_codes (
        id, code, client_uid, client_id, client_mac, client_ip,
        status, approved, used, preset_profile, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, '{}', ?)
    `).run(crypto.randomUUID(), code, clientUid, clientId, clientMac, clientIp, nowIso);
    return {
      retcode: 10003, // PairingRequired
      message: `Device requires pairing code to join. Pairing Code: ${code}. Please contact admin for approval.`,
      serverPublicKey: "",
    };
  } else {
    db.prepare(`
      UPDATE pairing_codes
      SET client_id = ?, client_mac = ?, client_ip = ?
      WHERE id = ?
    `).run(clientId, clientMac, clientIp, existingCode.id);
    return {
      retcode: 10003, // PairingRequired
      message: `Device requires pairing code to join. Pairing Code: ${existingCode.code}. Please contact admin for approval.`,
      serverPublicKey: "",
    };
  }
}

export function handleGrpcClientUnRegister(clientUid: string): {
  retcode: number;
  message: string;
} {
  const db = getDb();
  const existing = db
    .prepare("SELECT uid FROM clients WHERE uid = ?")
    .get(clientUid);
  if (!existing) {
    return { retcode: 10002, message: "Client not found" };
  }
  deleteClientDevice(clientUid);
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

  let pcRow = db
    .prepare("SELECT * FROM pairing_codes WHERE client_uid = ? ORDER BY created_at DESC LIMIT 1")
    .get(clientUid) as
    | {
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
      }
    | undefined;

  if (!pcRow && code.trim()) {
    pcRow = db
      .prepare("SELECT * FROM pairing_codes WHERE code = ? ORDER BY created_at DESC LIMIT 1")
      .get(code.trim()) as typeof pcRow;
  }

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
    if (pcRow.approved || pcRow.status === "approved" || pcRow.used) {
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
  if (mode === "pairing") {
    const newCode = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(`
      INSERT INTO pairing_codes (
        id, code, client_uid, client_id, client_mac, client_ip,
        status, approved, used, preset_profile, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, '{}', ?)
    `).run(crypto.randomUUID(), newCode, clientUid, classId, mac, clientIp, nowIso);
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
