/* ===== TypeScript 类型定义 ===== */
/* 对应后端 OpenAPI Schema + ClassIsland 上游数据模型 */

// ============================================================
// 认证相关
// ============================================================

export interface UserRegisterRequest {
    email: string;
    password: string;
    username?: string;
    display_name?: string;
    cf_turnstile_response?: string;
}

export interface UserLoginRequest {
    email: string;
    password: string;
    cf_turnstile_response?: string;
}

export interface EmailAvailabilityRequest {
    email: string;
    cf_turnstile_response?: string;
}

export interface TokenResponse {
    token: string;
    access_token?: string;
    user_id?: string;
    expires_in?: number;
    token_type?: string;
    remaining_recovery_codes?: number;
    require_totp_reset?: boolean;
}

export interface MessageResponse {
    status: string;
    message: string;
}

export interface StatusResponse {
    status: string;
    message?: string;
}

// ============================================================
// 用户、账户
// ============================================================

export interface UserOut {
    id: string;
    username: string;
    email: string;
    display_name: string;
    role_code: string;
    is_active: boolean;
    can_create_account?: boolean;
    totp_enabled?: boolean;
    bound_qq_masked?: string | null;
    bound_qq?: string | null;
    qq_bound_manual?: boolean | null;
    qq_joined_group?: boolean | null;
    created_at: string;
}

export interface CommunityStatusResponse {
    bound: boolean;
    status: "unbound" | "joined" | "manual_pending";
    qq_masked: string | null;
    masked_qq?: string | null;
    is_manual: boolean;
    is_joined: boolean;
    prompt?: string;
}

export interface UserUpdateRequest {
    display_name?: string | null;
    username?: string | null;
    email?: string | null;
    role_code?: string | null;
    is_active?: boolean | null;
    can_create_account?: boolean | null;
    totp_enabled?: boolean | null;
}

export interface EmailUpdate {
    email: string;
}

export interface UsernameUpdate {
    username: string;
}

export interface DisplayNameUpdate {
    display_name: string;
}

export interface PasswordChange {
    old_password: string;
    new_password: string;
}

export type RegistrationMode = "open" | "pairing" | "pre_reg";

export const REGISTRATION_MODE_LABELS: Record<RegistrationMode, string> = {
    open: "开放接入",
    pairing: "配对码审批接入",
    pre_reg: "预注册白名单接入",
};

export interface AccountOut {
    id: string;
    name: string;
    slug: string;
    api_key: string;
    is_active: boolean;
    registration_mode?: RegistrationMode;
    server_url?: string;
    urls?: {
        grpc: string;
        manifest_template: string;
        preset_download: string;
    };
    created_at: string;
}

export interface AccountCreate {
    name: string;
    slug?: string;
    registration_mode?: RegistrationMode;
}

export interface AccountIdUpdate {
    new_id: string;
}

export interface SlugUpdate {
    slug: string;
}

export interface AccountNameUpdate {
    name: string;
    registration_mode?: RegistrationMode;
}

export interface AccountInfoUpdate {
    new_id?: string;
    name?: string;
    slug?: string;
    is_active?: boolean;
    registration_mode?: RegistrationMode;
}

export interface QuotaOut {
    id: string;
    account_id: string;
    quota_key: string;
    max_value: number;
    current_value: number;
}

export interface QuotaSetRequest {
    quota_key: string;
    max_value: number;
}

export const QUOTA_META: Record<string, { label: string; hint: string; type: "number" | "boolean"; defaultMax: number }> = {
    max_clients: {
        label: "允许注册的设备数",
        hint: "该账户允许登记注册的最大终端设备数量，默认 6 台，-1 表示不限制",
        type: "number",
        defaultMax: 6,
    },
    max_grpc_connections: {
        label: "允许实时长连接的设备数量",
        hint: "该账户允许同时建立实时双向长连接会话的最大在线终端数量，默认 4 个，-1 表示不限制",
        type: "number",
        defaultMax: 4,
    },
    max_bandwidth_mb: {
        label: "月度流量配额",
        hint: "该账户允许的最大配置与资源分发流量，默认 100 MB，-1 表示不限制",
        type: "number",
        defaultMax: 100,
    },
    "feature.ota": {
        label: "策略与组件分发",
        hint: "允许该账户使用远程组件与策略分发能力",
        type: "boolean",
        defaultMax: 1,
    },
    "feature.audit": {
        label: "终端安全审计日志",
        hint: "允许该账户收集并检索客户端事件审计日志",
        type: "boolean",
        defaultMax: 1,
    },
};

// ============================================================
// 2FA
// ============================================================

export interface TotpEnableResponse {
    secret: string;
    uri: string;
    recovery_codes: string[];
}

export interface TotpConfirmRequest {
    code: string;
}

export interface TotpDisableRequest {
    password?: string;
    totp_code?: string;
    recovery_code?: string;
    second_recovery_code?: string;
    recovery_codes?: string[];
}

export interface TotpVerifyRequest {
    temp_token: string;
    code: string;
}

export interface TotpRecoverRequest {
    temp_token: string;
    recovery_code: string;
}

// ============================================================
// 登录安全证书 (Login Security Certificate)
// ============================================================

export interface CertificateIssueRequest {
    password: string;
    totp_code?: string;
    recovery_code?: string;
    device_name?: string;
}

export interface CertificateIssueResponse {
    code: string;
    deeplink: string;
    expires_in: number;
    cert_id: string;
    family_id: string;
    generation: number;
    max_generation: number;
    issued_at: number;
    expires_at: number;
}

export interface LoginCertificateItem {
    cert_id: string;
    family_id: string;
    generation: number;
    max_generation: number;
    issued_at: number;
    expires_at: number;
    last_used_at: number;
    redeemed: boolean;
    device_name: string;
    can_rotate: boolean;
}

export interface LoginCertificateFull {
    cert_id: string;
    family_id: string;
    user_id: string;
    cert_secret: string;
    generation: number;
    max_generation: number;
    issued_at: number;
    expires_at: number;
    device_name: string;
}

export interface CertificateRedeemResponse {
    certificate: LoginCertificateFull;
    token: string;
    expires_in: number;
}

export interface CertificateSessionResponse {
    token: string;
    expires_in: number;
    cert_id: string;
    generation: number;
    max_generation: number;
    cert_expires_at: number;
    can_rotate: boolean;
}

export interface CertificateRotateResponse {
    certificate: LoginCertificateFull;
    token: string;
    expires_in: number;
}

// ============================================================
// 客户端档案分配配置 (7 大资源)
// ============================================================

export interface ClientProfileConfig {
    ClassPlan?: string;
    TimeLayout?: string;
    Subjects?: string;
    DefaultSettings?: string;
    Policy?: string;
    Components?: string;
    Credentials?: string;
    [key: string]: string | undefined;
}

// ============================================================
// 配对码
// ============================================================

export interface PairingCodeOut {
    id: string;
    code: string;
    client_uid?: string;
    client_id?: string;
    client_mac?: string;
    client_ip?: string;
    status?: "pending" | "approved" | "rejected";
    approved?: boolean;
    used?: boolean;
    preset_profile?: ClientProfileConfig | null;
    created_at?: string;
    expires_at?: string;
}

export interface PairingStatusResponse {
    pairing_enabled: boolean;
    registration_mode: RegistrationMode;
}

// ============================================================
// 预注册客户端
// ============================================================

export interface PreRegOut {
    id: string;
    account_id: string;
    label: string;
    class_identity: string;
    mac_address?: string | null;
    is_enabled?: boolean;
    preset_profile?: ClientProfileConfig | null;
    bound_client_uid?: string | null;
    created_at: string;
}

export interface PreRegCreate {
    label: string;
    class_identity: string;
    mac_address?: string | null;
    preset_profile?: ClientProfileConfig | null;
}

// ============================================================
// 访问控制
// ============================================================

export interface AccessMember {
    id: string;
    user_id: string;
    account_id: string;
    role_in_account: string;
    joined_at: string;
    username?: string;
    display_name?: string;
    email?: string;
}

export interface AccessRoleUpdate {
    role_in_account: string;
}

/** 账户内角色 */
export const ACCOUNT_ROLE_LABELS: Record<string, string> = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    viewer: "观察者",
};

// ============================================================
// 邀请管理
// ============================================================

export interface InvitationOut {
    id: string;
    account_id: string;
    inviter_user_id: string;
    code: string;
    role_in_account: string;
    max_uses: number;
    used_count: number;
    expires_at: string | null;
    is_active: boolean;
    created_at: string;
}

export interface InvitationCreate {
    role_in_account?: string;
    max_uses?: number;
    expires_at?: string | null;
}

// ============================================================
// 系统设置
// ============================================================

/** Admin 设置白名单键 */
export const SETTINGS_ALLOWED_KEYS = [
    "registration_open",
    "require_approval",
    "max_accounts_per_user",
    "default_role",
    "announcement_title",
    "motd",
] as const;

export interface SettingsUpdate {
    items: Record<string, string>;
}

export interface SiteAnnouncement {
    title: string;
    subtitle: string;
}

// ============================================================
// 通知
// ============================================================

export interface NotificationPayload {
    MessageMask?: string;
    MessageContent?: string;
    OverlayIconLeft?: number;
    OverlayIconRight?: number;
    IsEmergency?: boolean;
    IsSpeechEnabled?: boolean;
    IsEffectEnabled?: boolean;
    IsSoundEnabled?: boolean;
    IsTopmost?: boolean;
    DurationSeconds?: number;
    RepeatCounts?: number;
}

// ============================================================
// 批量操作
// ============================================================

export type BatchOpType = "create" | "write" | "update" | "delete";

export interface BatchOperation {
    action: BatchOpType;
    resource_type: string;
    name: string;
    payload?: Record<string, unknown> | null;
}

export interface BatchRequest {
    operations: BatchOperation[];
    target_account_id?: string;
}

export interface ClientBatchRequest {
    client_uids: string[];
    action: "force_sync" | "restart" | "disconnect" | "enable" | "disable" | "delete" | "assign_profile";
    profile_config?: ClientProfileConfig | null;
}

// ============================================================
// 资源类型
// ============================================================

export type ResourceType =
    | "ClassPlan"
    | "TimeLayout"
    | "Subjects"
    | "Policy"
    | "DefaultSettings"
    | "Components"
    | "Credentials";

export const RESOURCE_TYPES: ResourceType[] = [
    "Subjects",
    "TimeLayout",
    "ClassPlan",
    "Policy",
    "Credentials",
    "Components",
    "DefaultSettings",
];

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
    ClassPlan: "课表",
    TimeLayout: "时间表",
    Subjects: "科目",
    Policy: "策略",
    DefaultSettings: "默认设置",
    Components: "组件设置",
    Credentials: "凭据",
};

// ============================================================
// 系统角色
// ============================================================

export const SYSTEM_ROLES = {
    BANNED: "banned",
    PENDING: "pending",
    NORMAL: "normal",
    ADMIN: "admin",
    SUPERADMIN: "superadmin",
} as const;

export const ROLE_LABELS: Record<string, string> = {
    banned: "已封禁",
    pending: "待激活",
    normal: "普通用户",
    admin: "管理员",
    superadmin: "超级管理员",
};

// ============================================================
// ClassIsland 上游数据模型
// ============================================================

/** 上游 ClassIsland 空 GUID 常量 (Guid.Empty) */
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** 判断 GUID 是否为空或 Guid.Empty */
export function isEmptyGuid(id?: string | null): boolean {
    if (!id) return true;
    const trimmed = id.trim().toLowerCase();
    return trimmed === "" || trimmed === EMPTY_GUID;
}

/** 将空字符串/null 标准化为上游 Guid.Empty ("00000000-0000-0000-0000-000000000000") */
export function toUpstreamGuidOrEmpty(id?: string | null): string {
    return isEmptyGuid(id) ? EMPTY_GUID : id!.trim();
}

/** 科目 */
export interface Subject {
    Name: string;
    Initial: string;
    TeacherName: string;
    IsOutDoor: boolean;
    AttachedObjects?: Record<string, unknown>;
    AttachableSettings?: Record<string, unknown>;
}

/** 时间点类型: 0=上课, 1=课间, 2=分割线, 3=行动 */
export type TimeType = 0 | 1 | 2 | 3;

export const TIME_TYPE_LABELS: Record<TimeType, string> = {
    0: "上课",
    1: "课间休息",
    2: "分割线",
    3: "行动",
};

/** 自动化行动项 (ClassIsland.Shared.Models.Automation.ActionItem) */
export interface ActionItem {
    Id: string;
    Settings?: Record<string, unknown> | null;
    IsRevert?: boolean;
}

/** 自动化行动组 (ClassIsland.Shared.Models.Automation.ActionSet) */
export interface ActionSet {
    Name?: string;
    IsEnabled?: boolean;
    IsRevertEnabled?: boolean;
    Guid?: string;
    /** 上游 JsonPropertyName("Actions") */
    Actions?: ActionItem[];
    [key: string]: unknown;
}

/** 上游内置行动定义 */
export interface BuiltinActionMeta {
    id: string;
    name: string;
    category: string;
    desc: string;
    defaultSettings: Record<string, unknown> | null;
}

export const BUILTIN_ACTIONS: BuiltinActionMeta[] = [
    {
        id: "classisland.os.run",
        name: "运行",
        category: "系统",
        desc: "运行应用程序、命令、文件、文件夹或打开网页链接",
        defaultSettings: { RunType: "Application", Value: "", Args: "" },
    },
    {
        id: "classisland.showNotification",
        name: "显示提醒",
        category: "提醒",
        desc: "在主界面顶栏弹出提醒遮罩与正文，支持语音播报与音效",
        defaultSettings: {
            Mask: "",
            MaskDurationSeconds: 5,
            IsMaskSpeechEnabled: true,
            Content: "",
            ContentDurationSeconds: 10,
            IsContentSpeechEnabled: true,
            IsAdvancedSettingsEnabled: false,
            IsEffectEnabled: true,
            IsSoundEffectEnabled: true,
            IsTopmostEnabled: true,
            CustomSoundEffectPath: "",
            IsWaitForCompleteEnabled: false,
        },
    },
    {
        id: "classisland.notification.weather",
        name: "显示天气提醒",
        category: "提醒",
        desc: "播报今日天气预报、气象预警或逐小时天气预报",
        defaultSettings: { NotificationKind: 0 },
    },
    {
        id: "classisland.broadcastSignal",
        name: "广播信号",
        category: "自动化",
        desc: "向自动化系统广播指定名称的触发器信号",
        defaultSettings: { SignalName: "", IsRevert: false },
    },
    {
        id: "classisland.action.sleep",
        name: "等待时长",
        category: "流程控制",
        desc: "等待指定秒数后再继续执行后续行动",
        defaultSettings: { Value: 5 },
    },
    {
        id: "classisland.settings",
        name: "修改应用设置",
        category: "应用",
        desc: "动态修改 ClassIsland 客户端设置项的值",
        defaultSettings: { Name: "", Value: "" },
    },
    {
        id: "classisland.app.restart",
        name: "重启 ClassIsland",
        category: "应用",
        desc: "重新启动 ClassIsland 客户端应用",
        defaultSettings: { Value: false },
    },
    {
        id: "classisland.app.quit",
        name: "退出 ClassIsland",
        category: "应用",
        desc: "关闭并退出 ClassIsland 客户端应用",
        defaultSettings: null,
    },
];

/** 时间表项 (兼容 StartSecond/EndSecond DateTime 与 StartTime/EndTime) */
export interface TimeLayoutItem {
    StartSecond?: string;
    EndSecond?: string;
    StartTime?: string;
    EndTime?: string;
    TimeType: TimeType;
    IsHideDefault?: boolean;
    DefaultClassId?: string;
    BreakName?: string;
    ActionSet?: ActionSet | null;
    AttachedObjects?: Record<string, unknown>;
    AttachableSettings?: Record<string, unknown>;
}

/** 时间表 */
export interface TimeLayout {
    Name: string;
    Layouts: TimeLayoutItem[];
    AttachedObjects?: Record<string, unknown>;
    AttachableSettings?: Record<string, unknown>;
}

/** 课程信息 */
export interface ClassInfo {
    SubjectId: string;
    IsChangedClass?: boolean;
    IsEnabled?: boolean;
    AttachedObjects?: Record<string, unknown>;
    AttachableSettings?: Record<string, unknown>;
}

/** 课表触发规则 */
export interface TimeRule {
    WeekDay: number;
    WeekCountDiv: number;
    WeekCountDivTotal: number;
}

/** 课表 */
export interface ClassPlan {
    Name: string;
    TimeLayoutId: string;
    Classes: ClassInfo[];
    TimeRule: TimeRule;
    IsEnabled: boolean;
    IsOverlay?: boolean;
    OverlaySourceId?: string | null;
    OverlaySetupTime?: string;
    AssociatedGroup?: string;
    AttachedObjects?: Record<string, unknown>;
    AttachableSettings?: Record<string, unknown>;
}

/** 课表群 */
export interface ClassPlanGroup {
    Name: string;
    IsGlobal?: boolean;
}

/** 档案 */
export interface Profile {
    Name: string;
    TimeLayouts: Record<string, TimeLayout>;
    ClassPlans: Record<string, ClassPlan>;
    Subjects: Record<string, Subject>;
    ClassPlanGroups?: Record<string, ClassPlanGroup>;
    IsOverlayClassPlanEnabled?: boolean;
    OverlayClassPlanId?: string | null;
    SelectedClassPlanGroupId?: string;
    TempOverlayClassPlanSetupTime?: string;
}

/** 管理策略 */
export interface ManagementPolicy {
    DisableProfileClassPlanEditing?: boolean;
    DisableProfileTimeLayoutEditing?: boolean;
    DisableProfileSubjectsEditing?: boolean;
    DisableProfileEditing?: boolean;
    DisableSettingsEditing?: boolean;
    DisableSplashCustomize?: boolean;
    DisableDebugMenu?: boolean;
    AllowExitManagement?: boolean;
    DisableEasterEggs?: boolean;
}

/** 管理服务器类型: 0=无服务器, 1=集控服务器 */
export type ManagementServerKind = 0 | 1;

export const MANAGEMENT_SERVER_KIND_LABELS: Record<ManagementServerKind, string> = {
    0: "无服务器",
    1: "集控服务器",
};

/** 引导设置 (ManagementSettings / ManagementPreset.json) */
export interface ManagementSettings {
    IsManagementEnabled?: boolean;
    ManagementServerKind?: ManagementServerKind;
    ManagementServer?: string;
    ManagementServerGrpc?: string;
    ManifestUrlTemplate?: string;
    ClassIdentity?: string;
}

/** 客户端应用默认设置 (ClassIsland.Models.Settings 全量字段) */
export interface AppDefaultSettings {
    /* 1. 常规、档案与课程显示 (General & Schedule) */
    IsMainWindowVisible?: boolean;
    IsWelcomeWindowShowed?: boolean;
    SelectedProfile?: string;
    CurrentComponentConfig?: string;
    ShowDate?: boolean;
    HideOnClass?: boolean;
    SingleWeekStartTime?: string;
    MultiWeekRotationMaxCycle?: number;
    MultiWeekRotationOffset?: Record<string, number>;
    DefaultOnClassTimePointMinutes?: number;
    DefaultBreakingTimePointMinutes?: number;
    ShowExtraInfoOnTimePoint?: boolean;
    ExtraInfoType?: number;
    IsCountdownEnabled?: boolean;
    CountdownSeconds?: number;
    ExtraInfo4ShowSecondsSeconds?: number;
    IsNonExactCountdownEnabled?: boolean;
    ScheduleSpacing?: number;
    ShowCurrentLessonOnlyOnClass?: boolean;
    IsSwapMode?: boolean;
    IsProfileEditorClassInfoSubjectAutoMoveNextEnabled?: boolean;
    ExpAllowEditingActivatedTimeLayout?: boolean;
    ClassPlanEditModeIndex?: number;
    TimeLayoutEditorIndex?: number;

    /* 2. 窗口、停靠、交互与避让规则 (Window, Docking & Hide Rules) */
    WindowDockingLocation?: number;
    WindowDockingMonitorIndex?: number;
    WindowDockingOffsetX?: number;
    WindowDockingOffsetY?: number;
    WindowLayer?: number;
    WindowTopmostRecheckMode?: number;
    IsIgnoreWorkAreaEnabled?: boolean;
    HideMode?: number;
    HideOnFullscreen?: boolean;
    ExcludedFullscreenWindow?: string[];
    HideOnMaxWindow?: boolean;
    IsMouseClickingEnabled?: boolean;
    UseRawInput?: boolean;
    IsMouseInFadingEnabled?: boolean;
    IsMouseInFadingReversed?: boolean;
    TouchInFadingDurationMs?: number;
    TaskBarIconClickBehavior?: number;
    IsCompatibleWindowTransparentEnabled?: boolean;
    IsWaitForTransientDisabled?: boolean;
    AnimationLevel?: number;
    ReduceProgressAccuracy?: boolean;
    IsScreenRecordingModeEnabled?: boolean;
    IsWindowCaptureBlockingEnabled?: boolean;

    /* 3. 外观、主题、色彩与字体 (Appearance, Theme & Fonts) */
    Theme?: number;
    Scale?: number;
    Opacity?: number;
    RadiusX?: number;
    RadiusY?: number;
    MainWindowLineVerticalMargin?: number;
    IsIslandSeperated?: boolean;
    ColorSource?: number;
    PrimaryColor?: string;
    SecondaryColor?: string;
    SelectedPlatteIndex?: number;
    TargetLightValue?: number;
    IsWallpaperAutoUpdateEnabled?: boolean;
    WallpaperAutoUpdateIntervalSeconds?: number;
    WallpaperClassName?: string;
    IsFallbackModeEnabled?: boolean;
    UseExperimentColorPickingMethod?: boolean;
    IsCustomBackgroundColorEnabled?: boolean;
    BackgroundColor?: string;
    IsCustomForegroundColorEnabled?: boolean;
    CustomForegroundColor?: string;
    MainWindowFont?: string;
    MainWindowFontWeight2?: number;
    MainWindowSecondaryFontSize?: number;
    MainWindowBodyFontSize?: number;
    MainWindowEmphasizedFontSize?: number;
    MainWindowLargeFontSize?: number;

    /* 4. 提醒、特效与渠道控制 (Notifications & Effects) */
    IsNotificationEnabled?: boolean;
    IsNotificationEffectEnabled?: boolean;
    IsNotificationSoundEnabled?: boolean;
    NotificationSoundVolume?: number;
    NotificationSoundPath?: string;
    IsNotificationTopmostEnabled?: boolean;
    NotificationEffectRenderingScale?: number;
    IsNotificationEffectRenderingScaleAutoSet?: boolean;
    NotificationUseStandaloneEffectUiThread?: boolean;
    AllowNotificationSpeech?: boolean;
    AllowNotificationEffect?: boolean;
    AllowNotificationSound?: boolean;
    AllowNotificationTopmost?: boolean;
    NotificationProvidersEnableStates?: Record<string, boolean>;
    NotificationProvidersPriority?: string[];

    /* 5. 语音合成 (Speech / TTS) */
    IsSpeechEnabled?: boolean;
    SpeechVolume?: number;
    SpeechSource?: number;
    SelectedSpeechProvider?: string;
    EdgeTtsVoiceName?: string;
    NotificationSpeechCustomSmgTokenSource?: string;
    GptSoVitsSpeechSettings?: Record<string, unknown>;

    /* 6. 天气与气象预警 (Weather) */
    CityId?: string;
    CityName?: string;
    WeatherLocationSource?: number;
    WeatherLongitude?: number;
    WeatherLatitude?: number;
    AutoRefreshWeatherLocation?: boolean;
    NoTLSWeatherRequests?: boolean;
    ExcludedWeatherAlerts?: string[];
    WeatherIconId?: string;

    /* 7. 时间同步与校准 (Time & NTP) */
    IsExactTimeEnabled?: boolean;
    ExactTimeServer?: string;
    TimeOffsetSeconds?: number;
    IsTimeAutoAdjustEnabled?: boolean;
    TimeAutoAdjustSeconds?: number;

    /* 8. 启动画面、自动化、备份、更新与诊断 (System, Backup, Updates & Debug) */
    IsSplashEnabled?: boolean;
    SplashCustomText?: string;
    SplashCustomLogoSource?: string;
    ShowDetailedStatusOnSplash?: boolean;
    IsAutomationEnabled?: boolean;
    CurrentAutomationConfig?: string;
    IsAutomationWarningVisible?: boolean;
    IsAutoBackupEnabled?: boolean;
    AutoBackupIntervalDays?: number;
    AutoBackupLimit?: number;
    UpdateMode?: number;
    SelectedUpdateChannelV2?: string;
    SelectedUpdateMirrorV2?: string;
    AutoInstallUpdateNextStartup?: boolean;
    OfficialSelectedMirror?: string;
    IgnoreSslForPluginMirrors?: boolean;
    IsPluginsAutoUpdateEnabled?: boolean;
    IsPluginsUpdateNotificationEnabled?: boolean;
    AutoDisableCorruptPlugins?: boolean;
    IsCriticalSafeMode?: boolean;
    CriticalSafeModeMethod?: number;
    IsReportingEnabled?: boolean;
    IsRefreshingToastEnabled?: boolean;
    RefreshingToastThresholdDays?: number;
    MaxRefreshingToastCounts?: number;
    ShowEchoCaveWhenSettingsPageLoading?: boolean;
    SettingsPagesCachePolicy?: number;
    IsDebugEnabled?: boolean;
    IsDebugOptionsEnabled?: boolean;
    IsMainWindowDebugEnabled?: boolean;
    IsDebugConsoleEnabled?: boolean;
    DebugAnimationScale?: number;
    [key: string]: unknown;
}

/** 授权等级: 0=无, 1=用户认证, 2=管理员认证 */
export type AuthorizeLevel = 0 | 1 | 2;

export const AUTHORIZE_LEVEL_LABELS: Record<AuthorizeLevel, string> = {
    0: "无需认证",
    1: "用户认证",
    2: "管理员认证",
};

/** 凭据配置 */
export interface ManagementCredentialConfig {
    UserCredential?: string;
    AdminCredential?: string;
    EditAuthorizeSettingsAuthorizeLevel?: AuthorizeLevel;
    EditPolicyAuthorizeLevel?: AuthorizeLevel;
    ExitManagementAuthorizeLevel?: AuthorizeLevel;
    EditProfileAuthorizeLevel?: AuthorizeLevel;
    EditSettingsAuthorizeLevel?: AuthorizeLevel;
    ExitApplicationAuthorizeLevel?: AuthorizeLevel;
    EditComponentsAuthorizeLevel?: AuthorizeLevel;
    PluginManagementAuthorizeLevel?: AuthorizeLevel;
    ChangeLessonsAuthorizeLevel?: AuthorizeLevel;
}

/** 水平对齐方式 */
export type HorizontalAlignmentType = 0 | 1 | 2 | 3;

export const HORIZONTAL_ALIGNMENT_LABELS: Record<HorizontalAlignmentType, string> = {
    0: "拉伸",
    1: "左对齐",
    2: "居中",
    3: "右对齐",
};

/** 组件设置项 (ComponentSettings) */
export interface ComponentSettingsItem {
    Id?: string;
    NameCache?: string;
    Settings?: unknown;
    HideOnRule?: boolean;
    HidingRules?: unknown;
    /* 字体大小 */
    IsResourceOverridingEnabled?: boolean;
    MainWindowSecondaryFontSize?: number;
    MainWindowBodyFontSize?: number;
    MainWindowEmphasizedFontSize?: number;
    MainWindowLargeFontSize?: number;
    /* 颜色 */
    IsCustomForegroundColorEnabled?: boolean;
    ForegroundColor?: string;
    IsCustomBackgroundColorEnabled?: boolean;
    BackgroundColor?: string;
    IsCustomBackgroundOpacityEnabled?: boolean;
    BackgroundOpacity?: number;
    IsCustomCornerRadiusEnabled?: boolean;
    CustomCornerRadius?: number;
    Opacity?: number;
    /* 布局 */
    RelativeLineNumber?: number;
    HorizontalAlignment?: HorizontalAlignmentType;
    IsMinWidthEnabled?: boolean;
    MinWidth?: number;
    IsMaxWidthEnabled?: boolean;
    MaxWidth?: number;
    IsFixedWidthEnabled?: boolean;
    FixedWidth?: number;
    IsCustomMarginEnabled?: boolean;
    MarginLeft?: number;
    MarginTop?: number;
    MarginRight?: number;
    MarginBottom?: number;
    LastWidthCache?: number;
}

/** 主界面行设置 (MainWindowLineSettings) */
export interface ComponentLineSettings {
    Children: ComponentSettingsItem[];
    IslandSeparationMode?: number;
    IsMainLine?: boolean;
    IsNotificationEnabled?: boolean;
    IsEnabled?: boolean;
    HideOnRule?: boolean;
    HidingRules?: unknown;
    IsResourceOverridingEnabled?: boolean;
    MainWindowSecondaryFontSize?: number;
    MainWindowBodyFontSize?: number;
    MainWindowEmphasizedFontSize?: number;
    MainWindowLargeFontSize?: number;
    IsCustomForegroundColorEnabled?: boolean;
    ForegroundColor?: string;
    IsCustomBackgroundColorEnabled?: boolean;
    BackgroundColor?: string;
    IsCustomBackgroundOpacityEnabled?: boolean;
    BackgroundOpacity?: number;
    IsCustomCornerRadiusEnabled?: boolean;
    CustomCornerRadius?: number;
    Opacity?: number;
}

/** 组件配置档案 (ComponentProfile) */
export interface ComponentProfile {
    Lines: ComponentLineSettings[];
}

/** 旧版前端曾误用的假 GUID 到真实上游 ClassIsland 组件 GUID 的自动迁移映射表 */
export const LEGACY_COMPONENT_GUID_MAP: Record<string, string> = {
    "df398495-e1f4-4e4e-b62c-512000e55029": "1db2017d-e374-4bc6-9d57-0b4adf03a6b8", // 课程表
    "9781b66c-647c-463b-bd42-8879901c2d08": "9e1af71d-8f77-4b21-a342-448787104dd9", // 时钟
    "c01377d5-9072-4c72-975a-c71b161b61d0": "df3f8295-21f6-482e-bada-fa0e5f14bb66", // 日期
    "a5a2e554-1c59-4b11-9472-b15e8767d814": "ca495086-e297-4beb-9603-c5c1c1a8551e", // 天气简报
    "856510b1-9464-4822-b472-5e997e61001b": "7c645d35-8151-48ba-b4ac-15017460d994", // 倒计时
    "f63f108c-227c-414b-9e65-2e6f18471f7b": "ee8f66bd-c423-4e7c-ab46-aa9976b00e08", // 文本
    "341b6d16-8f5b-46b2-9551-208b6511e2a0": "ab0f26d5-9df6-4575-b844-73b04d0907c1", // 分割线
    "48c55091-1f5a-4d6e-91c8-a0b528c45646": "c911d762-107f-40c6-84cc-0146ab3c86b1", // 分组容器
    "78998996-96f9-47f4-a1e8-4f8c0965e7e6": "7e19a113-d281-4f33-970a-834a0b78b5ad", // 轮播容器
};

export interface BuiltinComponentMeta {
    id: string;
    name: string;
    desc: string;
    isContainer?: boolean;
    hasSettings?: boolean;
    defaultSettings?: Record<string, unknown> | null;
}

/** 上游 ClassIsland 真实内置组件列表 (App.Services.xaml.cs) */
export const BUILTIN_COMPONENTS: BuiltinComponentMeta[] = [
    {
        id: "1db2017d-e374-4bc6-9d57-0b4adf03a6b8",
        name: "课程表",
        desc: "显示当前的课程表信息。",
        hasSettings: true,
        defaultSettings: {
            ShowExtraInfoOnTimePoint: true,
            ExtraInfoType: 0,
            IsCountdownEnabled: true,
            CountdownSeconds: 60,
            ExtraInfo4ShowSecondsSeconds: 0,
            ScheduleSpacing: 1,
            ShowCurrentLessonOnlyOnClass: false,
            IsNonExactCountdownEnabled: false,
            ShowPlaceholderOnEmptyClassPlan: true,
            ShowTomorrowSchedule: false,
            TomorrowScheduleShowMode: 1,
            FadeCompletedClasses: true,
            HideFinishedClass: false,
            HighlightChangedClass: false,
            PlaceholderTextNoClass: "今天没有课程。",
            PlaceholderTextAllClassEnded: "今日课程已全部结束。",
        },
    },
    {
        id: "9e1af71d-8f77-4b21-a342-448787104dd9",
        name: "时钟",
        desc: "显示现在的时间，支持精确到秒。",
        hasSettings: true,
        defaultSettings: {
            ShowSeconds: false,
            ShowRealTime: false,
            FlashTimeSeparator: true,
        },
    },
    {
        id: "df3f8295-21f6-482e-bada-fa0e5f14bb66",
        name: "日期",
        desc: "显示今天的日期和星期。",
        hasSettings: false,
        defaultSettings: null,
    },
    {
        id: "ca495086-e297-4beb-9603-c5c1c1a8551e",
        name: "天气简报",
        desc: "显示当前的天气概况和气象预警。",
        hasSettings: true,
        defaultSettings: {
            ShowMainWeatherInfo: true,
            MainWeatherInfoKind: 0,
            ShowAlerts: true,
            AlertsTitleShowMode: 1,
            ShowRainTime: true,
            IsFuzzyLongRainCountdownEnabled: true,
        },
    },
    {
        id: "7c645d35-8151-48ba-b4ac-15017460d994",
        name: "倒计时",
        desc: "显示距离某一时间点的剩余时间。",
        hasSettings: true,
        defaultSettings: {
            CountDownName: "倒计时",
            OverTime: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + "T00:00:00",
            StartTime: new Date().toISOString().slice(0, 10) + "T00:00:00",
            FontColor: "#FF0000",
            FontSize: 16,
            CountDownConnector: "还有",
            IsConnectorColorEmphasized: false,
            CustomStringFormat: "%D天",
            ShowProgress: false,
            ProgressBarMode: 0,
            IsProgressInverted: false,
            UseAccentOnProgressBar: true,
            IsCompactModeEnabled: false,
            CountdownSource: 0,
            IsAdvancedCycleTimingEnabled: false,
            CycleStartTime: new Date().toISOString().slice(0, 10) + "T00:00:00",
            CycleBeforeDuration: "00:00:00",
            CycleDuration: "1.00:00:00",
            CycleAfterDuration: "00:00:00",
            IsCycleCountLimited: false,
            CycleCountLimit: 2,
            NatureTimeUseMode: 0,
            IsCustomWeekCountdownStartDayEnabled: false,
            WeekCountdownStartDay: 1,
        },
    },
    {
        id: "ee8f66bd-c423-4e7c-ab46-aa9976b00e08",
        name: "文本",
        desc: "显示自定义文本内容。",
        hasSettings: true,
        defaultSettings: {
            TextContent: "",
            UseCustomFontColor: true,
            FontColor: "#FFFFFF",
            FontSize: 16,
        },
    },
    {
        id: "ab0f26d5-9df6-4575-b844-73b04d0907c1",
        name: "分割线",
        desc: "显示一条垂直分割线，用于分隔不同组件。",
        hasSettings: false,
        defaultSettings: null,
    },
    {
        id: "c911d762-107f-40c6-84cc-0146ab3c86b1",
        name: "分组容器",
        desc: "将多个组件水平排列分组合并显示。",
        isContainer: true,
        hasSettings: false,
        defaultSettings: {
            Children: [],
        },
    },
    {
        id: "2d849ece-9f21-4c78-9434-415cfc283294",
        name: "堆叠容器",
        desc: "将多个组件按堆叠方式组合显示。",
        isContainer: true,
        hasSettings: false,
        defaultSettings: {
            Children: [],
        },
    },
    {
        id: "7e19a113-d281-4f33-970a-834a0b78b5ad",
        name: "轮播容器",
        desc: "按指定间隔轮播展示多个子组件。",
        isContainer: true,
        hasSettings: true,
        defaultSettings: {
            Children: [],
            SlideSeconds: 15,
            SlideMode: 0,
            IsPauseOnRuleEnabled: false,
            PauseRule: {},
            IsStopOnRuleEnabled: false,
            StopRule: {},
            IsAnimationEnabled: false,
        },
    },
    {
        id: "70fcd5ea-3fae-4e06-aca2-4f4df47f9acd",
        name: "滚动容器",
        desc: "以横向走马灯方式连续滚动展示子组件。",
        isContainer: true,
        hasSettings: true,
        defaultSettings: {
            Children: [],
            SpeedPixelPerSecond: 40,
            IsPauseEnabled: true,
            PauseSeconds: 10,
            PauseOffsetX: 0,
            PauseOnRule: false,
            PauseRule: {},
            StopOnRule: false,
            StopRule: {},
        },
    },
];

// ============================================================
// 客户端设备与远程上报/审计
// ============================================================

export interface ClientDeviceOut {
    uid: string;
    client_id: string;
    display_name: string;
    mac: string;
    ip: string | null;
    is_disabled: boolean;
    status: "online" | "offline";
    registered_at: string | null;
    last_seen_at: string | null;
    profile_config: ClientProfileConfig;
    has_custom_profile: boolean;
}

export interface ClientInfo extends Partial<ClientDeviceOut> {
    uid: string;
    [key: string]: unknown;
}

export const CONFIG_TYPE_LABELS: Record<number, string> = {
    1: "应用设置",
    2: "当前档案",
    3: "组件配置",
    4: "自动化配置",
    5: "运行日志",
    6: "已安装插件",
};

export interface ConfigUploadItem {
    request_guid: string;
    client_uid: string | null;
    config_type: number;
    config_type_name: string;
    status: "pending" | "completed";
    uploaded_at: string | null;
    payload_preview?: string;
    payload?: string;
    parsed_payload?: unknown;
}

export const AUDIT_EVENT_LABELS: Record<number, string> = {
    0: "未指定事件",
    1: "授权验证成功",
    2: "授权验证失败",
    4: "应用设置更新",
    5: "换课操作完成",
    6: "课表更新",
    7: "时间表更新",
    8: "科目更新",
    9: "应用异常崩溃",
    10: "应用启动",
    11: "应用正常退出",
    12: "插件安装",
    13: "插件卸载",
};

export interface AuditLogItem {
    id: number;
    client_uid: string;
    event_type: number;
    event_name: string;
    timestamp_utc: number;
    logged_at: string | null;
    decoded: Record<string, unknown>;
}

// ============================================================
// 2FA 登录流中间态
// ============================================================

export interface TwoFARequired {
    requires_2fa: true;
    temp_token: string;
}

export type LoginResult = TokenResponse | TwoFARequired;

// ============================================================
// 周几名称
// ============================================================

export const WEEKDAY_LABELS = [
    "周日", "周一", "周二", "周三", "周四", "周五", "周六"
];

export interface ResourceHistoryItem {
    version: number;
    name: string;
    resource_type: string;
    updated_at: string;
    size_bytes: number;
    is_current: boolean;
}

export interface ResourceHistoryVersionOut {
    version: number;
    name: string;
    resource_type: string;
    updated_at: string;
    content: unknown;
}

// ============================================================
// 工单系统
// ============================================================

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketCategory = "account" | "client" | "bug" | "feature" | "other";

export interface TicketMessage {
    id: number;
    author_id: string;
    author_role: "user" | "admin";
    content: string;
    created_at: string;
}

export interface TicketUserSummary {
    id: string;
    username: string;
    email: string;
    display_name: string;
    role_code: string;
    is_active: boolean;
}

export interface TicketItem {
    id: string;
    user_id: string;
    subject: string;
    category: TicketCategory;
    priority: TicketPriority;
    status: TicketStatus;
    created_at: string;
    updated_at: string;
    last_reply_at: string | null;
    last_reply_by: string;
    admin_unread: boolean;
    user_unread: boolean;
    message_count: number;
    user?: TicketUserSummary | null;
}

export interface TicketDetail extends TicketItem {
    content: string;
    messages: TicketMessage[];
}

export interface TicketListResponse {
    total: number;
    items: TicketItem[];
}

export interface TicketCreateRequest {
    subject: string;
    content: string;
    category: TicketCategory;
    priority: TicketPriority;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
    open: "待处理",
    in_progress: "处理中",
    resolved: "已解决",
    closed: "已关闭",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
    low: "低",
    normal: "普通",
    high: "高",
    urgent: "紧急",
};

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
    account: "账户问题",
    client: "客户端问题",
    bug: "故障报告",
    feature: "功能建议",
    other: "其他",
};

// ============================================================
// 反向移动端扫码登录网页 (Mobile -> Web QR Login)
// ============================================================

export interface QrLoginCreateResponse {
    code: string;
    deeplink: string;
    expires_in: number;
    expires_at: number;
}

export interface QrLoginPollResponse {
    status: "pending" | "authorized" | "expired";
    token?: string;
    user_id?: string;
    expires_at?: number;
}

