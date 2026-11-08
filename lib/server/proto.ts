import { create, toBinary } from "@bufbuild/protobuf";
import {
  FileDescriptorProtoSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
} from "@bufbuild/protobuf/wkt";
import { fileDesc, serviceDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import type { GenService, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";

// ============================================================================
// Enum Constants (matching ClassIsland.Shared.Protobuf.Enum.*)
// ============================================================================

export const Retcode = {
  Unspecified: 0,
  Success: 200,
  ServerInternalError: 500,
  InvalidRequest: 404,
  HandshakeClientRejected: 1001,
  Registered: 10001,
  ClientNotFound: 10002,
  PairingRequired: 10003,
} as const;

export const CommandTypes = {
  DefaultCommand: 0,
  Ping: 10,
  Pong: 11,
  RestartApp: 101,
  SendNotification: 102,
  DataUpdated: 103,
  GetClientConfig: 104,
} as const;

export const ConfigTypes = {
  UnspecifiedConfig: 0,
  AppSettings: 1,
  Profile: 2,
  CurrentComponent: 3,
  CurrentAutomation: 4,
  Logs: 5,
  PluginList: 6,
} as const;

export const AuditEvents = {
  DefaultEvent: 0,
  AuthorizeSuccess: 1,
  AuthorizeFailed: 2,
  AppSettingsUpdated: 4,
  ClassChangeCompleted: 5,
  ClassPlanUpdated: 6,
  TimeLayoutUpdated: 7,
  SubjectUpdated: 8,
  AppCrashed: 9,
  AppStarted: 10,
  AppExited: 11,
  PluginInstalled: 12,
  PluginUninstalled: 13,
} as const;

export const ListItemUpdateOperations = {
  ListItemUpdateOperationsUnspecified: 0,
  Add: 1,
  Update: 2,
  Remove: 3,
} as const;

// ============================================================================
// TypeScript Message Shapes
// ============================================================================

export type HandshakeScBeginHandShakeReqShape = Message<"ClassIsland.Shared.Protobuf.Service.HandshakeScBeginHandShakeReq"> & {
  ClientUid: string;
  ClientMac: string;
  ChallengeTokenEncrypted: string;
  RequestedServerKeyId: bigint;
};

export type HandshakeScBeginHandShakeRspShape = Message<"ClassIsland.Shared.Protobuf.Service.HandshakeScBeginHandShakeRsp"> & {
  Retcode: number;
  Message: string;
  ChallengeTokenDecrypted: string;
  ServerPublicKey: string;
};

export type HandshakeScCompleteHandshakeReqShape = Message<"ClassIsland.Shared.Protobuf.Service.HandshakeScCompleteHandshakeReq"> & {
  Accepted: boolean;
};

export type HandshakeScCompleteHandshakeRspShape = Message<"ClassIsland.Shared.Protobuf.Service.HandshakeScCompleteHandshakeRsp"> & {
  Retcode: number;
  Message: string;
  SessionId: string;
};

export type ClientRegisterCsReqShape = Message<"ClassIsland.Shared.Protobuf.Service.ClientRegisterCsReq"> & {
  ClientUid: string;
  ClientId: string;
  ClientMac: string;
};

export type ClientRegisterScRspShape = Message<"ClassIsland.Shared.Protobuf.Service.ClientRegisterScRsp"> & {
  Retcode: number;
  Message: string;
  ServerPublicKey: string;
};

export type ClientCommandDeliverScReqShape = Message<"ClassIsland.Shared.Protobuf.Service.ClientCommandDeliverScReq"> & {
  Type: number;
  Payload: Uint8Array;
};

export type ClientCommandDeliverScRspShape = Message<"ClassIsland.Shared.Protobuf.Service.ClientCommandDeliverScRsp"> & {
  RetCode: number;
  Type: number;
  Payload: Uint8Array;
};

export type ConfigUploadScReqShape = Message<"ClassIsland.Shared.Protobuf.Service.ConfigUploadScReq"> & {
  RequestGuidId: string;
  Payload: string;
};

export type ConfigUploadScRspShape = Message<"ClassIsland.Shared.Protobuf.Service.ConfigUploadScRsp"> & {
  Retcode: number;
  Message: string;
};

export type AuditScReqShape = Message<"ClassIsland.Shared.Protobuf.Service.AuditScReq"> & {
  Event: number;
  Payload: Uint8Array;
  TimestampUtc: bigint;
};

export type AuditScRspShape = Message<"ClassIsland.Shared.Protobuf.Service.AuditScRsp"> & {
  Retcode: number;
  Message: string;
};

export type SendNotificationShape = Message<"ClassIsland.Shared.Protobuf.Service.SendNotification"> & {
  MessageMask: string;
  MessageContent: string;
  OverlayIconLeft: number;
  OverlayIconRight: number;
  IsEmergency: boolean;
  IsSpeechEnabled: boolean;
  IsEffectEnabled: boolean;
  IsSoundEnabled: boolean;
  IsTopmost: boolean;
  DurationSeconds: number;
  RepeatCounts: number;
};

export type GetClientConfigShape = Message<"ClassIsland.Shared.Protobuf.Service.GetClientConfig"> & {
  RequestGuid: string;
  ConfigType: number;
};

export type HeartBeatShape = Message<"ClassIsland.Shared.Protobuf.Service.HeartBeat"> & {
  isOnline: boolean;
};

// Audit payload shapes
export type AuthorizeEventShape = Message<"ClassIsland.Shared.Protobuf.Service.AuthorizeEvent"> & {
  Level: number;
};

export type AppSettingsUpdatedShape = Message<"ClassIsland.Shared.Protobuf.Service.AppSettingsUpdated"> & {
  PropertyName: string;
};

export type ClassChangeCompletedShape = Message<"ClassIsland.Shared.Protobuf.Service.ClassChangeCompleted"> & {
  ClassPlanId: string;
  ChangeMode: number;
  SourceClassIndex: number;
  SourceClassSubjectId: string;
  TargetClassIndex: number;
  TargetClassSubjectId: string;
  WriteToSourceClassPlan: boolean;
};

export type ProfileItemUpdatedShape = Message<"ClassIsland.Shared.Protobuf.Service.ProfileItemUpdated"> & {
  ItemId: string;
  Operation: number;
};

export type AppCrashedShape = Message<"ClassIsland.Shared.Protobuf.Service.AppCrashed"> & {
  Stacktrace: string;
};

export type PluginInstalledShape = Message<"ClassIsland.Shared.Protobuf.Service.PluginInstalled"> & {
  PluginId: string;
  Version: string;
};

export type PluginUninstalledShape = Message<"ClassIsland.Shared.Protobuf.Service.PluginUninstalled"> & {
  PluginId: string;
  Version: string;
};

// ConnectES Internal Web Security & Data RPC Shape
export type ConnectWebRpcReqShape = Message<"ClassIsland.Shared.Protobuf.Service.ConnectWebRpcReq"> & {
  Action: string;
  Token: string;
  PayloadJson: string;
};

export type ConnectWebRpcRspShape = Message<"ClassIsland.Shared.Protobuf.Service.ConnectWebRpcRsp"> & {
  Ok: boolean;
  Error: string;
  ResultJson: string;
};

// ============================================================================
// Descriptor Hydration via @bufbuild/protobuf
// ============================================================================

const OPT = FieldDescriptorProto_Label.OPTIONAL;
const T_STRING = FieldDescriptorProto_Type.STRING;
const T_BYTES = FieldDescriptorProto_Type.BYTES;
const T_BOOL = FieldDescriptorProto_Type.BOOL;
const T_INT32 = FieldDescriptorProto_Type.INT32;
const T_INT64 = FieldDescriptorProto_Type.INT64;
const T_DOUBLE = FieldDescriptorProto_Type.DOUBLE;

const PKG = "ClassIsland.Shared.Protobuf.Service";

const fileDescriptorProto = create(FileDescriptorProtoSchema, {
  name: "cyrene_msp.proto",
  package: PKG,
  syntax: "proto3",
  messageType: [
    // 0: HandshakeScBeginHandShakeReq
    {
      name: "HandshakeScBeginHandShakeReq",
      field: [
        { name: "ClientUid", number: 1, label: OPT, type: T_STRING, jsonName: "ClientUid" },
        { name: "ClientMac", number: 2, label: OPT, type: T_STRING, jsonName: "ClientMac" },
        { name: "ChallengeTokenEncrypted", number: 3, label: OPT, type: T_STRING, jsonName: "ChallengeTokenEncrypted" },
        { name: "RequestedServerKeyId", number: 4, label: OPT, type: T_INT64, jsonName: "RequestedServerKeyId" },
      ],
    },
    // 1: HandshakeScBeginHandShakeRsp
    {
      name: "HandshakeScBeginHandShakeRsp",
      field: [
        { name: "Retcode", number: 1, label: OPT, type: T_INT32, jsonName: "Retcode" },
        { name: "Message", number: 2, label: OPT, type: T_STRING, jsonName: "Message" },
        { name: "ChallengeTokenDecrypted", number: 3, label: OPT, type: T_STRING, jsonName: "ChallengeTokenDecrypted" },
        { name: "ServerPublicKey", number: 4, label: OPT, type: T_STRING, jsonName: "ServerPublicKey" },
      ],
    },
    // 2: HandshakeScCompleteHandshakeReq
    {
      name: "HandshakeScCompleteHandshakeReq",
      field: [
        { name: "Accepted", number: 1, label: OPT, type: T_BOOL, jsonName: "Accepted" },
      ],
    },
    // 3: HandshakeScCompleteHandshakeRsp
    {
      name: "HandshakeScCompleteHandshakeRsp",
      field: [
        { name: "Retcode", number: 1, label: OPT, type: T_INT32, jsonName: "Retcode" },
        { name: "Message", number: 2, label: OPT, type: T_STRING, jsonName: "Message" },
        { name: "SessionId", number: 3, label: OPT, type: T_STRING, jsonName: "SessionId" },
      ],
    },
    // 4: ClientRegisterCsReq
    {
      name: "ClientRegisterCsReq",
      field: [
        { name: "ClientUid", number: 1, label: OPT, type: T_STRING, jsonName: "ClientUid" },
        { name: "ClientId", number: 2, label: OPT, type: T_STRING, jsonName: "ClientId" },
        { name: "ClientMac", number: 3, label: OPT, type: T_STRING, jsonName: "ClientMac" },
      ],
    },
    // 5: ClientRegisterScRsp
    {
      name: "ClientRegisterScRsp",
      field: [
        { name: "Retcode", number: 1, label: OPT, type: T_INT32, jsonName: "Retcode" },
        { name: "Message", number: 2, label: OPT, type: T_STRING, jsonName: "Message" },
        { name: "ServerPublicKey", number: 3, label: OPT, type: T_STRING, jsonName: "ServerPublicKey" },
      ],
    },
    // 6: ClientCommandDeliverScReq
    {
      name: "ClientCommandDeliverScReq",
      field: [
        { name: "Type", number: 2, label: OPT, type: T_INT32, jsonName: "Type" },
        { name: "Payload", number: 3, label: OPT, type: T_BYTES, jsonName: "Payload" },
      ],
    },
    // 7: ClientCommandDeliverScRsp
    {
      name: "ClientCommandDeliverScRsp",
      field: [
        { name: "RetCode", number: 1, label: OPT, type: T_INT32, jsonName: "RetCode" },
        { name: "Type", number: 2, label: OPT, type: T_INT32, jsonName: "Type" },
        { name: "Payload", number: 3, label: OPT, type: T_BYTES, jsonName: "Payload" },
      ],
    },
    // 8: ConfigUploadScReq
    {
      name: "ConfigUploadScReq",
      field: [
        { name: "RequestGuidId", number: 1, label: OPT, type: T_STRING, jsonName: "RequestGuidId" },
        { name: "Payload", number: 2, label: OPT, type: T_STRING, jsonName: "Payload" },
      ],
    },
    // 9: ConfigUploadScRsp
    {
      name: "ConfigUploadScRsp",
      field: [
        { name: "Retcode", number: 1, label: OPT, type: T_INT32, jsonName: "Retcode" },
        { name: "Message", number: 2, label: OPT, type: T_STRING, jsonName: "Message" },
      ],
    },
    // 10: AuditScReq
    {
      name: "AuditScReq",
      field: [
        { name: "Event", number: 1, label: OPT, type: T_INT32, jsonName: "Event" },
        { name: "Payload", number: 2, label: OPT, type: T_BYTES, jsonName: "Payload" },
        { name: "TimestampUtc", number: 3, label: OPT, type: T_INT64, jsonName: "TimestampUtc" },
      ],
    },
    // 11: AuditScRsp
    {
      name: "AuditScRsp",
      field: [
        { name: "Retcode", number: 1, label: OPT, type: T_INT32, jsonName: "Retcode" },
        { name: "Message", number: 2, label: OPT, type: T_STRING, jsonName: "Message" },
      ],
    },
    // 12: SendNotification
    {
      name: "SendNotification",
      field: [
        { name: "MessageMask", number: 1, label: OPT, type: T_STRING, jsonName: "MessageMask" },
        { name: "MessageContent", number: 2, label: OPT, type: T_STRING, jsonName: "MessageContent" },
        { name: "OverlayIconLeft", number: 3, label: OPT, type: T_INT32, jsonName: "OverlayIconLeft" },
        { name: "OverlayIconRight", number: 4, label: OPT, type: T_INT32, jsonName: "OverlayIconRight" },
        { name: "IsEmergency", number: 5, label: OPT, type: T_BOOL, jsonName: "IsEmergency" },
        { name: "IsSpeechEnabled", number: 6, label: OPT, type: T_BOOL, jsonName: "IsSpeechEnabled" },
        { name: "IsEffectEnabled", number: 7, label: OPT, type: T_BOOL, jsonName: "IsEffectEnabled" },
        { name: "IsSoundEnabled", number: 8, label: OPT, type: T_BOOL, jsonName: "IsSoundEnabled" },
        { name: "IsTopmost", number: 9, label: OPT, type: T_BOOL, jsonName: "IsTopmost" },
        { name: "DurationSeconds", number: 10, label: OPT, type: T_DOUBLE, jsonName: "DurationSeconds" },
        { name: "RepeatCounts", number: 11, label: OPT, type: T_INT32, jsonName: "RepeatCounts" },
      ],
    },
    // 13: GetClientConfig
    {
      name: "GetClientConfig",
      field: [
        { name: "RequestGuid", number: 1, label: OPT, type: T_STRING, jsonName: "RequestGuid" },
        { name: "ConfigType", number: 2, label: OPT, type: T_INT32, jsonName: "ConfigType" },
      ],
    },
    // 14: HeartBeat
    {
      name: "HeartBeat",
      field: [
        { name: "isOnline", number: 1, label: OPT, type: T_BOOL, jsonName: "isOnline" },
      ],
    },
    // 15: AuthorizeEvent
    {
      name: "AuthorizeEvent",
      field: [
        { name: "Level", number: 1, label: OPT, type: T_INT32, jsonName: "Level" },
      ],
    },
    // 16: AppSettingsUpdated
    {
      name: "AppSettingsUpdated",
      field: [
        { name: "PropertyName", number: 1, label: OPT, type: T_STRING, jsonName: "PropertyName" },
      ],
    },
    // 17: ClassChangeCompleted
    {
      name: "ClassChangeCompleted",
      field: [
        { name: "ClassPlanId", number: 1, label: OPT, type: T_STRING, jsonName: "ClassPlanId" },
        { name: "ChangeMode", number: 2, label: OPT, type: T_INT32, jsonName: "ChangeMode" },
        { name: "SourceClassIndex", number: 3, label: OPT, type: T_INT32, jsonName: "SourceClassIndex" },
        { name: "SourceClassSubjectId", number: 4, label: OPT, type: T_STRING, jsonName: "SourceClassSubjectId" },
        { name: "TargetClassIndex", number: 5, label: OPT, type: T_INT32, jsonName: "TargetClassIndex" },
        { name: "TargetClassSubjectId", number: 6, label: OPT, type: T_STRING, jsonName: "TargetClassSubjectId" },
        { name: "WriteToSourceClassPlan", number: 7, label: OPT, type: T_BOOL, jsonName: "WriteToSourceClassPlan" },
      ],
    },
    // 18: ProfileItemUpdated
    {
      name: "ProfileItemUpdated",
      field: [
        { name: "ItemId", number: 1, label: OPT, type: T_STRING, jsonName: "ItemId" },
        { name: "Operation", number: 2, label: OPT, type: T_INT32, jsonName: "Operation" },
      ],
    },
    // 19: AppCrashed
    {
      name: "AppCrashed",
      field: [
        { name: "Stacktrace", number: 1, label: OPT, type: T_STRING, jsonName: "Stacktrace" },
      ],
    },
    // 20: PluginInstalled
    {
      name: "PluginInstalled",
      field: [
        { name: "PluginId", number: 1, label: OPT, type: T_STRING, jsonName: "PluginId" },
        { name: "Version", number: 2, label: OPT, type: T_STRING, jsonName: "Version" },
      ],
    },
    // 21: PluginUninstalled
    {
      name: "PluginUninstalled",
      field: [
        { name: "PluginId", number: 1, label: OPT, type: T_STRING, jsonName: "PluginId" },
        { name: "Version", number: 2, label: OPT, type: T_STRING, jsonName: "Version" },
      ],
    },
    // 22: ConnectWebRpcReq
    {
      name: "ConnectWebRpcReq",
      field: [
        { name: "Action", number: 1, label: OPT, type: T_STRING, jsonName: "Action" },
        { name: "Token", number: 2, label: OPT, type: T_STRING, jsonName: "Token" },
        { name: "PayloadJson", number: 3, label: OPT, type: T_STRING, jsonName: "PayloadJson" },
      ],
    },
    // 23: ConnectWebRpcRsp
    {
      name: "ConnectWebRpcRsp",
      field: [
        { name: "Ok", number: 1, label: OPT, type: T_BOOL, jsonName: "Ok" },
        { name: "Error", number: 2, label: OPT, type: T_STRING, jsonName: "Error" },
        { name: "ResultJson", number: 3, label: OPT, type: T_STRING, jsonName: "ResultJson" },
      ],
    },
  ],
  service: [
    // 0: Handshake
    {
      name: "Handshake",
      method: [
        {
          name: "BeginHandshake",
          inputType: `.${PKG}.HandshakeScBeginHandShakeReq`,
          outputType: `.${PKG}.HandshakeScBeginHandShakeRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
        {
          name: "CompleteHandshake",
          inputType: `.${PKG}.HandshakeScCompleteHandshakeReq`,
          outputType: `.${PKG}.HandshakeScCompleteHandshakeRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
      ],
    },
    // 1: ClientRegister
    {
      name: "ClientRegister",
      method: [
        {
          name: "Register",
          inputType: `.${PKG}.ClientRegisterCsReq`,
          outputType: `.${PKG}.ClientRegisterScRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
        {
          name: "UnRegister",
          inputType: `.${PKG}.ClientRegisterCsReq`,
          outputType: `.${PKG}.ClientRegisterScRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
      ],
    },
    // 2: ClientCommandDeliver
    {
      name: "ClientCommandDeliver",
      method: [
        {
          name: "ListenCommand",
          inputType: `.${PKG}.ClientCommandDeliverScReq`,
          outputType: `.${PKG}.ClientCommandDeliverScRsp`,
          clientStreaming: true,
          serverStreaming: true,
        },
      ],
    },
    // 3: ConfigUpload
    {
      name: "ConfigUpload",
      method: [
        {
          name: "UploadConfig",
          inputType: `.${PKG}.ConfigUploadScReq`,
          outputType: `.${PKG}.ConfigUploadScRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
      ],
    },
    // 4: Audit
    {
      name: "Audit",
      method: [
        {
          name: "LogEvent",
          inputType: `.${PKG}.AuditScReq`,
          outputType: `.${PKG}.AuditScRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
      ],
    },
    // 5: SteSecurityGateway (ConnectES security & management RPC)
    {
      name: "SteSecurityGateway",
      method: [
        {
          name: "Invoke",
          inputType: `.${PKG}.ConnectWebRpcReq`,
          outputType: `.${PKG}.ConnectWebRpcRsp`,
          clientStreaming: false,
          serverStreaming: false,
        },
      ],
    },
  ],
});

const b64Desc = Buffer.from(toBinary(FileDescriptorProtoSchema, fileDescriptorProto)).toString("base64");
export const cyreneMspFileDesc = fileDesc(b64Desc);

// Export Message Schemas
export const HandshakeScBeginHandShakeReqSchema: GenMessage<HandshakeScBeginHandShakeReqShape> = messageDesc(cyreneMspFileDesc, 0);
export const HandshakeScBeginHandShakeRspSchema: GenMessage<HandshakeScBeginHandShakeRspShape> = messageDesc(cyreneMspFileDesc, 1);
export const HandshakeScCompleteHandshakeReqSchema: GenMessage<HandshakeScCompleteHandshakeReqShape> = messageDesc(cyreneMspFileDesc, 2);
export const HandshakeScCompleteHandshakeRspSchema: GenMessage<HandshakeScCompleteHandshakeRspShape> = messageDesc(cyreneMspFileDesc, 3);
export const ClientRegisterCsReqSchema: GenMessage<ClientRegisterCsReqShape> = messageDesc(cyreneMspFileDesc, 4);
export const ClientRegisterScRspSchema: GenMessage<ClientRegisterScRspShape> = messageDesc(cyreneMspFileDesc, 5);
export const ClientCommandDeliverScReqSchema: GenMessage<ClientCommandDeliverScReqShape> = messageDesc(cyreneMspFileDesc, 6);
export const ClientCommandDeliverScRspSchema: GenMessage<ClientCommandDeliverScRspShape> = messageDesc(cyreneMspFileDesc, 7);
export const ConfigUploadScReqSchema: GenMessage<ConfigUploadScReqShape> = messageDesc(cyreneMspFileDesc, 8);
export const ConfigUploadScRspSchema: GenMessage<ConfigUploadScRspShape> = messageDesc(cyreneMspFileDesc, 9);
export const AuditScReqSchema: GenMessage<AuditScReqShape> = messageDesc(cyreneMspFileDesc, 10);
export const AuditScRspSchema: GenMessage<AuditScRspShape> = messageDesc(cyreneMspFileDesc, 11);

export const SendNotificationSchema: GenMessage<SendNotificationShape> = messageDesc(cyreneMspFileDesc, 12);
export const GetClientConfigSchema: GenMessage<GetClientConfigShape> = messageDesc(cyreneMspFileDesc, 13);
export const HeartBeatSchema: GenMessage<HeartBeatShape> = messageDesc(cyreneMspFileDesc, 14);

export const AuthorizeEventSchema: GenMessage<AuthorizeEventShape> = messageDesc(cyreneMspFileDesc, 15);
export const AppSettingsUpdatedSchema: GenMessage<AppSettingsUpdatedShape> = messageDesc(cyreneMspFileDesc, 16);
export const ClassChangeCompletedSchema: GenMessage<ClassChangeCompletedShape> = messageDesc(cyreneMspFileDesc, 17);
export const ProfileItemUpdatedSchema: GenMessage<ProfileItemUpdatedShape> = messageDesc(cyreneMspFileDesc, 18);
export const AppCrashedSchema: GenMessage<AppCrashedShape> = messageDesc(cyreneMspFileDesc, 19);
export const PluginInstalledSchema: GenMessage<PluginInstalledShape> = messageDesc(cyreneMspFileDesc, 20);
export const PluginUninstalledSchema: GenMessage<PluginUninstalledShape> = messageDesc(cyreneMspFileDesc, 21);

export const ConnectWebRpcReqSchema: GenMessage<ConnectWebRpcReqShape> = messageDesc(cyreneMspFileDesc, 22);
export const ConnectWebRpcRspSchema: GenMessage<ConnectWebRpcRspShape> = messageDesc(cyreneMspFileDesc, 23);

// Export Service Descriptors
export const HandshakeService: GenService<{
  beginHandshake: {
    methodKind: "unary";
    input: typeof HandshakeScBeginHandShakeReqSchema;
    output: typeof HandshakeScBeginHandShakeRspSchema;
  };
  completeHandshake: {
    methodKind: "unary";
    input: typeof HandshakeScCompleteHandshakeReqSchema;
    output: typeof HandshakeScCompleteHandshakeRspSchema;
  };
}> = serviceDesc(cyreneMspFileDesc, 0);

export const ClientRegisterService: GenService<{
  register: {
    methodKind: "unary";
    input: typeof ClientRegisterCsReqSchema;
    output: typeof ClientRegisterScRspSchema;
  };
  unRegister: {
    methodKind: "unary";
    input: typeof ClientRegisterCsReqSchema;
    output: typeof ClientRegisterScRspSchema;
  };
}> = serviceDesc(cyreneMspFileDesc, 1);

export const ClientCommandDeliverService: GenService<{
  listenCommand: {
    methodKind: "bidi_streaming";
    input: typeof ClientCommandDeliverScReqSchema;
    output: typeof ClientCommandDeliverScRspSchema;
  };
}> = serviceDesc(cyreneMspFileDesc, 2);

export const ConfigUploadService: GenService<{
  uploadConfig: {
    methodKind: "unary";
    input: typeof ConfigUploadScReqSchema;
    output: typeof ConfigUploadScRspSchema;
  };
}> = serviceDesc(cyreneMspFileDesc, 3);

export const AuditService: GenService<{
  logEvent: {
    methodKind: "unary";
    input: typeof AuditScReqSchema;
    output: typeof AuditScRspSchema;
  };
}> = serviceDesc(cyreneMspFileDesc, 4);

export const SteSecurityGatewayService: GenService<{
  invoke: {
    methodKind: "unary";
    input: typeof ConnectWebRpcReqSchema;
    output: typeof ConnectWebRpcRspSchema;
  };
}> = serviceDesc(cyreneMspFileDesc, 5);
