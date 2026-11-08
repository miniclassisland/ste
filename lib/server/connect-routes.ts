import { create } from "@bufbuild/protobuf";
import { createContextKey, type ConnectRouter, type HandlerContext } from "@connectrpc/connect";
import {
  HandshakeService,
  HandshakeScBeginHandShakeRspSchema,
  HandshakeScCompleteHandshakeRspSchema,
  ClientRegisterService,
  ClientRegisterScRspSchema,
  ClientCommandDeliverService,
  ClientCommandDeliverScRspSchema,
  ConfigUploadService,
  ConfigUploadScRspSchema,
  AuditService,
  AuditScRspSchema,
  SteSecurityGatewayService,
  ConnectWebRpcRspSchema,
  Retcode,
  CommandTypes,
} from "./proto.ts";
import {
  getDb,
  ensurePgpKeys,
  decryptChallengeToken,
  savePendingHandshake,
  completePendingHandshake,
  verifyGrpcSession,
  handleGrpcClientRegister,
  handleGrpcClientUnRegister,
  registerClientStreamListener,
  touchClientLastSeen,
  saveClientConfigUpload,
  recordAuditEvent,
  isPasswordInitialized,
  loginWithPassword,
  verifyWebSession,
  logoutWebSession,
  changeAdminPassword,
  getTenantAccount,
  updateTenantAccount,
  regenerateApiKey,
  buildManagementPreset,
  listResources,
  createResource,
  readResource,
  writeResource,
  deleteResource,
  listResourceHistory,
  getResourceHistoryDetail,
  rollbackResourceHistory,
  listClients,
  getClientDetails,
  getClientProfileConfig,
  setClientProfileConfig,
  renameClientDevice,
  disableClientDevice,
  enableClientDevice,
  deleteClientDevice,
  restartClientDevice,
  forceSyncClientDevice,
  disconnectClientSession,
  sendNotificationToClient,
  broadcastNotificationToClients,
  batchClientsAction,
  requestClientConfigSnapshot,
  listClientConfigUploads,
  getClientConfigUploadDetail,
  getPairingStatus,
  setPairingMode,
  listPairingCodes,
  approvePairingCode,
  rejectPairingCode,
  listPreRegistrations,
  createPreRegistration,
  batchCreatePreRegistrations,
  updatePreRegistrationInfo,
  setPreRegistrationEnabled,
  setPreRegistrationConfig,
  deletePreRegistration,
  downloadPreRegistrationPreset,
  listAuditLogs,
  clearAuditLogs,
  encodeClassIslandCredential,
} from "./db.ts";
import type {
  ClientProfileConfig,
  NotificationPayload,
  PreRegCreate,
  RegistrationMode,
} from "../types.ts";

export const kPeerIp = createContextKey<string>("127.0.0.1");
export const kOriginUrl = createContextKey<string>("http://localhost:21196");

function getMeta(ctx: HandlerContext, key: string): string {
  return (ctx.requestHeader.get(key) || "").trim();
}

function getPeerIp(ctx: HandlerContext): string {
  const xff = ctx.requestHeader.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = ctx.requestHeader.get("x-real-ip");
  if (xri) return xri.trim();
  return ctx.values.get(kPeerIp) || "127.0.0.1";
}

function getOrigin(ctx: HandlerContext): string {
  const proto = ctx.requestHeader.get("x-forwarded-proto") || "http";
  const host = ctx.requestHeader.get("x-forwarded-host") || ctx.requestHeader.get("host");
  if (host) return `${proto}://${host}`;
  return ctx.values.get(kOriginUrl) || "http://localhost:21196";
}

/**
 * Unified Security & Management Action Dispatcher (invoked by both ConnectES SteSecurityGateway and Next.js Server Actions)
 */
export async function dispatchManagementAction(
  action: string,
  token: string,
  payload: Record<string, unknown>,
  originUrl = "http://localhost:21196"
): Promise<unknown> {
  // Public / Auth actions
  if (action === "auth.status") {
    return {
      authenticated: verifyWebSession(token),
      password_initialized: isPasswordInitialized(),
    };
  }
  if (action === "auth.login") {
    const password = String(payload.password ?? "");
    return loginWithPassword(password);
  }
  if (action === "auth.logout") {
    logoutWebSession(token);
    return { status: "ok" };
  }
  if (action === "system.announcements") {
    return [];
  }
  if (action === "system.communityConfig") {
    return {
      community_url: "https://qm.qq.com/q/3456789",
      community_title: "加入社区交流群",
      community_description: "欢迎加入 MINI ClassIsland 社区交流群",
    };
  }

  // All subsequent actions require valid single-password session token
  if (!verifyWebSession(token)) {
    throw new Error("未登录或会话已过期，请重新输入管理密码");
  }

  switch (action) {
    case "auth.changePassword": {
      changeAdminPassword(
        String(payload.old_password ?? ""),
        String(payload.new_password ?? "")
      );
      return { status: "ok", message: "管理密码已修改" };
    }
    case "accounts.get":
      return getTenantAccount(originUrl);
    case "accounts.list":
      return [getTenantAccount(originUrl)];
    case "accounts.update":
      return updateTenantAccount(
        {
          name: payload.name as string | undefined,
          slug: payload.slug as string | undefined,
          registration_mode: payload.registration_mode as RegistrationMode | undefined,
          server_url: payload.server_url as string | undefined,
        },
        originUrl
      );
    case "accounts.regenerateKey":
      return regenerateApiKey();
    case "accounts.downloadPreset":
      return buildManagementPreset(
        payload.class_identity as string | undefined,
        originUrl
      );

    // Pairing
    case "pairing.getStatus":
      return getPairingStatus();
    case "pairing.setMode":
      return setPairingMode(payload.registration_mode as RegistrationMode);
    case "pairing.listCodes":
      return listPairingCodes();
    case "pairing.approve":
      return approvePairingCode(
        String(payload.pairing_id),
        payload.preset_profile as ClientProfileConfig | undefined
      );
    case "pairing.reject":
      return rejectPairingCode(String(payload.pairing_id));

    // Pre-registration
    case "preRegistration.list":
      return listPreRegistrations();
    case "preRegistration.create":
      return createPreRegistration(payload.data as PreRegCreate);
    case "preRegistration.batchCreate":
      return batchCreatePreRegistrations(payload.items as PreRegCreate[]);
    case "preRegistration.rename":
      return updatePreRegistrationInfo(
        String(payload.pre_reg_id),
        payload.data as { label?: string; class_identity?: string; mac_address?: string }
      );
    case "preRegistration.enable":
      return setPreRegistrationEnabled(String(payload.pre_reg_id), true);
    case "preRegistration.disable":
      return setPreRegistrationEnabled(String(payload.pre_reg_id), false);
    case "preRegistration.config":
      return setPreRegistrationConfig(
        String(payload.pre_reg_id),
        payload.profile as ClientProfileConfig
      );
    case "preRegistration.delete":
      return deletePreRegistration(String(payload.pre_reg_id));
    case "preRegistration.downloadPreset":
      return downloadPreRegistrationPreset(String(payload.pre_reg_id), originUrl);

    // Data / Resources
    case "data.list":
      return listResources(String(payload.resource_type));
    case "data.create":
      return createResource(String(payload.resource_type), String(payload.name));
    case "data.read":
      return readResource(String(payload.resource_type), String(payload.name));
    case "data.write":
      return writeResource(
        String(payload.resource_type),
        String(payload.name),
        payload.body
      );
    case "data.delete":
      return deleteResource(String(payload.resource_type), String(payload.name));
    case "data.listHistory":
      return listResourceHistory(String(payload.resource_type), String(payload.name));
    case "data.getHistoryDetail":
      return getResourceHistoryDetail(
        String(payload.resource_type),
        String(payload.name),
        Number(payload.history_id)
      );
    case "data.rollbackHistory":
      return rollbackResourceHistory(
        String(payload.resource_type),
        String(payload.name),
        Number(payload.history_id)
      );

    // Credentials
    case "credentials.encode":
      return { credential: encodeClassIslandCredential(String(payload.password ?? "")) };

    // Clients
    case "clients.list":
      return listClients();
    case "clients.details":
      return getClientDetails(String(payload.client_uid));
    case "clients.getProfileConfig":
      return getClientProfileConfig(String(payload.client_uid));
    case "clients.config":
      return setClientProfileConfig(
        String(payload.client_uid),
        payload.config as ClientProfileConfig
      );
    case "clients.rename":
      return renameClientDevice(
        String(payload.client_uid),
        payload.data as { display_name?: string; client_id?: string }
      );
    case "clients.disable":
      return disableClientDevice(String(payload.client_uid));
    case "clients.enable":
      return enableClientDevice(String(payload.client_uid));
    case "clients.delete":
      return deleteClientDevice(String(payload.client_uid));
    case "clients.restart":
      return restartClientDevice(String(payload.client_uid));
    case "clients.forceSync":
      return forceSyncClientDevice(String(payload.client_uid));
    case "clients.disconnect":
      disconnectClientSession(String(payload.client_uid));
      return { status: "disconnected" };
    case "clients.sendNotification":
      return sendNotificationToClient(
        String(payload.client_uid),
        payload.payload as NotificationPayload
      );
    case "clients.broadcastNotification":
      return broadcastNotificationToClients(
        payload.payload as NotificationPayload,
        payload.target_client_uids as string[] | undefined
      );
    case "clients.batch":
      return batchClientsAction(
        payload.body as {
          client_uids: string[];
          action: "force_sync" | "restart" | "disconnect" | "enable" | "disable" | "delete" | "assign_profile";
          profile_config?: ClientProfileConfig;
        }
      );
    case "clients.getConfig":
      return requestClientConfigSnapshot(
        String(payload.client_uid),
        Number(payload.config_type)
      );
    case "clients.listConfigUploads":
      return listClientConfigUploads(String(payload.client_uid));
    case "clients.getConfigUploadDetail":
      return getClientConfigUploadDetail(String(payload.request_guid));

    // Audit
    case "audit.list":
      return listAuditLogs(
        payload.params as { client_uid?: string; event_type?: number; limit?: number } | undefined
      );
    case "audit.clear":
      return clearAuditLogs(payload.client_uid as string | undefined);

    // Bulk export / import
    case "bulk.exportData": {
      const resources: Record<string, Record<string, unknown>> = {};
      for (const rt of [
        "Subjects",
        "TimeLayout",
        "ClassPlan",
        "Policy",
        "DefaultSettings",
        "Components",
        "Credentials",
      ]) {
        resources[rt] = {};
        for (const name of listResources(rt)) {
          resources[rt][name] = readResource(rt, name);
        }
      }
      return {
        exported_at: new Date().toISOString(),
        account: getTenantAccount(originUrl),
        resources,
        pre_registrations: listPreRegistrations(),
      };
    }
    case "bulk.importData": {
      const dataObj = (payload.data || {}) as Record<string, unknown>;
      const resources = (dataObj.resources || {}) as Record<string, Record<string, unknown>>;
      for (const [rt, files] of Object.entries(resources)) {
        if (files && typeof files === "object") {
          for (const [name, content] of Object.entries(files)) {
            writeResource(rt, name, content);
          }
        }
      }
      return { status: "imported" };
    }

    default:
      throw new Error(`未知操作: ${action}`);
  }
}

/**
 * Register all 5 Cyrene_MSP gRPC services + SteSecurityGateway ConnectES service
 */
export function registerConnectRoutes(router: ConnectRouter): void {
  // 1. Handshake Service
  router.service(HandshakeService, {
    async beginHandshake(req, ctx) {
      const clientUid = (req.ClientUid || getMeta(ctx, "cuid")).trim();
      const clientMac = (req.ClientMac || "").trim();
      const encryptedToken = (req.ChallengeTokenEncrypted || "").trim();

      if (!clientUid) {
        return create(HandshakeScBeginHandShakeRspSchema, {
          Retcode: Retcode.InvalidRequest,
          Message: "Missing ClientUid",
        });
      }

      const db = getDb();
      const clientRow = db
        .prepare("SELECT uid, is_disabled FROM clients WHERE uid = ?")
        .get(clientUid) as { uid: string; is_disabled: number } | undefined;

      if (!clientRow) {
        return create(HandshakeScBeginHandShakeRspSchema, {
          Retcode: Retcode.ClientNotFound,
          Message: "Client not registered",
        });
      }
      if (clientRow.is_disabled) {
        return create(HandshakeScBeginHandShakeRspSchema, {
          Retcode: Retcode.HandshakeClientRejected,
          Message: "Client device is disabled by administrator",
        });
      }

      touchClientLastSeen(clientUid, getPeerIp(ctx));

      let decryptedToken = "";
      try {
        decryptedToken = await decryptChallengeToken(encryptedToken);
      } catch (err) {
        return create(HandshakeScBeginHandShakeRspSchema, {
          Retcode: Retcode.HandshakeClientRejected,
          Message: `PGP challenge decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      savePendingHandshake(clientUid, clientMac, decryptedToken);
      const { publicKeyArmor } = await ensurePgpKeys();

      return create(HandshakeScBeginHandShakeRspSchema, {
        Retcode: Retcode.Success,
        Message: "OK",
        ChallengeTokenDecrypted: decryptedToken,
        ServerPublicKey: publicKeyArmor,
      });
    },

    async completeHandshake(req, ctx) {
      const clientUid = getMeta(ctx, "cuid");
      if (!req.Accepted) {
        return create(HandshakeScCompleteHandshakeRspSchema, {
          Retcode: Retcode.HandshakeClientRejected,
          Message: "Handshake not accepted by client",
        });
      }
      const sessionId = completePendingHandshake(clientUid);
      if (!sessionId) {
        return create(HandshakeScCompleteHandshakeRspSchema, {
          Retcode: Retcode.InvalidRequest,
          Message: "No pending handshake found or expired",
        });
      }
      touchClientLastSeen(clientUid, getPeerIp(ctx));
      return create(HandshakeScCompleteHandshakeRspSchema, {
        Retcode: Retcode.Success,
        Message: "Handshake complete",
        SessionId: sessionId,
      });
    },
  });

  // 2. ClientRegister Service
  router.service(ClientRegisterService, {
    async register(req, ctx) {
      const clientUid = (req.ClientUid || getMeta(ctx, "cuid")).trim();
      const clientId = (req.ClientId || "").trim();
      const clientMac = (req.ClientMac || "").trim();

      if (!clientUid) {
        return create(ClientRegisterScRspSchema, {
          Retcode: Retcode.InvalidRequest,
          Message: "ClientUid is required",
        });
      }

      const res = await handleGrpcClientRegister(
        clientUid,
        clientId,
        clientMac,
        getPeerIp(ctx)
      );
      return create(ClientRegisterScRspSchema, {
        Retcode: res.retcode,
        Message: res.message,
        ServerPublicKey: res.serverPublicKey,
      });
    },

    async unRegister(req, ctx) {
      const clientUid = (req.ClientUid || getMeta(ctx, "cuid")).trim();
      const res = handleGrpcClientUnRegister(clientUid);
      return create(ClientRegisterScRspSchema, {
        Retcode: res.retcode,
        Message: res.message,
      });
    },
  });

  // 3. ClientCommandDeliver Service (Bidi Streaming)
  router.service(ClientCommandDeliverService, {
    async *listenCommand(reqs, ctx) {
      const clientUid = getMeta(ctx, "cuid");
      const sessionToken = getMeta(ctx, "session");
      const peerIp = getPeerIp(ctx);

      if (!verifyGrpcSession(clientUid, sessionToken)) {
        yield create(ClientCommandDeliverScRspSchema, {
          RetCode: Retcode.HandshakeClientRejected,
          Type: CommandTypes.DefaultCommand,
          Payload: new Uint8Array(),
        });
        return;
      }

      touchClientLastSeen(clientUid, peerIp);

      // Create an async queue bridged to both incoming client pings and outgoing server commands
      type StreamEvent =
        | { kind: "outgoing"; cmdType: number; payload: Uint8Array }
        | { kind: "done" };

      const buffer: StreamEvent[] = [];
      let resolveNext: ((ev: StreamEvent) => void) | null = null;

      const enqueue = (ev: StreamEvent) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(ev);
        } else {
          buffer.push(ev);
        }
      };

      const unregister = registerClientStreamListener(clientUid, (entry) => {
        enqueue({ kind: "outgoing", cmdType: entry.cmdType, payload: entry.payload });
      });

      // Read client incoming stream in background
      (async () => {
        try {
          for await (const reqMsg of reqs) {
            touchClientLastSeen(clientUid, peerIp);
            if (reqMsg.Type === CommandTypes.Ping) {
              enqueue({
                kind: "outgoing",
                cmdType: CommandTypes.Pong,
                payload: new Uint8Array(),
              });
            }
          }
        } catch {
          // Stream closed or aborted
        } finally {
          enqueue({ kind: "done" });
        }
      })();

      try {
        while (!ctx.signal.aborted) {
          const ev =
            buffer.length > 0
              ? buffer.shift()!
              : await new Promise<StreamEvent>((resolve) => {
                  resolveNext = resolve;
                  ctx.signal.addEventListener(
                    "abort",
                    () => resolve({ kind: "done" }),
                    { once: true }
                  );
                });

          if (ev.kind === "done") {
            break;
          }

          yield create(ClientCommandDeliverScRspSchema, {
            RetCode: Retcode.Success,
            Type: ev.cmdType,
            Payload: ev.payload,
          });
        }
      } finally {
        unregister();
      }
    },
  });

  // 4. ConfigUpload Service
  router.service(ConfigUploadService, {
    async uploadConfig(req, ctx) {
      const clientUid = getMeta(ctx, "cuid");
      const sessionToken = getMeta(ctx, "session");
      if (!verifyGrpcSession(clientUid, sessionToken)) {
        return create(ConfigUploadScRspSchema, {
          Retcode: Retcode.HandshakeClientRejected,
          Message: "Invalid or expired session",
        });
      }

      const reqGuid = (req.RequestGuidId || "").trim();
      if (!reqGuid) {
        return create(ConfigUploadScRspSchema, {
          Retcode: Retcode.InvalidRequest,
          Message: "Missing RequestGuidId",
        });
      }

      const ok = saveClientConfigUpload(reqGuid, req.Payload || "");
      if (!ok) {
        return create(ConfigUploadScRspSchema, {
          Retcode: Retcode.InvalidRequest,
          Message: "ConfigUpload record not found",
        });
      }

      touchClientLastSeen(clientUid, getPeerIp(ctx));
      return create(ConfigUploadScRspSchema, {
        Retcode: Retcode.Success,
        Message: "Config uploaded",
      });
    },
  });

  // 5. Audit Service
  router.service(AuditService, {
    async logEvent(req, ctx) {
      const clientUid = getMeta(ctx, "cuid");
      const sessionToken = getMeta(ctx, "session");
      if (!verifyGrpcSession(clientUid, sessionToken)) {
        return create(AuditScRspSchema, {
          Retcode: Retcode.HandshakeClientRejected,
          Message: "Invalid or expired session",
        });
      }

      touchClientLastSeen(clientUid, getPeerIp(ctx));
      recordAuditEvent(
        clientUid,
        Number(req.Event || 0),
        req.Payload || new Uint8Array(),
        Number(req.TimestampUtc || BigInt(Math.floor(Date.now() / 1000)))
      );

      return create(AuditScRspSchema, {
        Retcode: Retcode.Success,
        Message: "Logged",
      });
    },
  });

  // 6. SteSecurityGateway (ConnectES Security & Management Stack)
  router.service(SteSecurityGatewayService, {
    async invoke(req, ctx) {
      try {
        const payload = req.PayloadJson ? JSON.parse(req.PayloadJson) : {};
        const result = await dispatchManagementAction(
          req.Action,
          req.Token,
          payload,
          getOrigin(ctx)
        );
        return create(ConnectWebRpcRspSchema, {
          Ok: true,
          Error: "",
          ResultJson: JSON.stringify(result ?? null),
        });
      } catch (err) {
        return create(ConnectWebRpcRspSchema, {
          Ok: false,
          Error: err instanceof Error ? err.message : String(err),
          ResultJson: "null",
        });
      }
    },
  });
}
