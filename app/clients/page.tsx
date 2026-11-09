"use client";

import React, { useState, useEffect, useCallback } from "react";
import { clients, data, audit, accounts } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    NotificationPayload,
    ClientDeviceOut,
    ClientProfileConfig,
    ResourceType,
    ConfigUploadItem,
    CommandExecutionEnvelope,
    AuditLogItem,
} from "@/lib/types";
import {
    RESOURCE_TYPES,
    RESOURCE_TYPE_LABELS,
    CONFIG_TYPE_LABELS,
    AUDIT_EVENT_LABELS,
} from "@/lib/types";
import {
    Button, Input, Spinner, Dialog, DialogSurface, DialogBody,
    DialogTitle, DialogContent, DialogActions,
    Switch, Textarea,
    MessageBar, MessageBarBody,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    ArrowSync24Regular, Send24Regular,
    ArrowClockwise24Regular, Settings24Regular,
    Delete24Regular, PlugDisconnected24Regular,
    CheckmarkCircle24Regular, DismissCircle24Regular,
    DocumentSearch24Regular, CloudArrowDown24Regular,
    Desktop24Regular, Play24Regular, Eye24Regular,
    Folder24Regular, Wrench24Regular, CursorClick24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";

type DetailTab = "info" | "profile" | "extend" | "snapshots" | "audit" | "notify";
type ExtendSubTab = "hardware" | "runtime" | "ops" | "remote";

interface HardwareSummary {
    collectedAtUtc?: string;
    capturedAtUtc?: string;
    system?: {
        machineName?: string;
        hostName?: string;
        userName?: string;
        osDescription?: string;
        osVersion?: string;
        osArchitecture?: string;
        processArchitecture?: string;
        uptimeSeconds?: number;
        uptimeHours?: number;
        motherboardManufacturer?: string;
        motherboardProduct?: string;
        biosVendor?: string;
        biosVersion?: string;
        appVersion?: string;
    };
    motherboard?: {
        manufacturer?: string;
        product?: string;
        biosVersion?: string;
    };
    cpu?: Array<{
        name?: string;
        physicalCores?: number;
        cores?: number;
        logicalProcessors?: number;
        maxClockSpeedMhz?: number;
        maxClockMHz?: number;
    }>;
    processors?: Array<{
        name?: string;
        physicalCores?: number;
        cores?: number;
        logicalProcessors?: number;
        maxClockSpeedMhz?: number;
        maxClockMHz?: number;
    }>;
    memory?: {
        totalPhysicalBytes?: number;
        availablePhysicalBytes?: number;
        usedPercentage?: number;
        modules?: Array<{
            manufacturer?: string;
            capacityBytes?: number;
            speedMhz?: number;
            speedMHz?: number;
        }>;
    };
    gpus?: Array<{
        name?: string;
        driverVersion?: string;
        adapterRamBytes?: number;
    }>;
    disks?: Array<{
        model?: string;
        sizeBytes?: number;
        mediaType?: string;
        interfaceType?: string;
    }>;
    partitions?: Array<{
        name?: string;
        volumeLabel?: string;
        driveFormat?: string;
        totalSizeBytes?: number;
        availableFreeBytes?: number;
    }>;
    volumes?: Array<{
        name?: string;
        fileSystem?: string;
        totalBytes?: number;
        freeBytes?: number;
    }>;
    displays?: Array<{
        index?: number;
        displayName?: string;
        isPrimary?: boolean;
        widthPixels?: number;
        heightPixels?: number;
        scaling?: number;
    }>;
    monitors?: Array<{
        name?: string;
        bounds?: string;
        scaling?: number;
        isPrimary?: boolean;
    }>;
    networkInterfaces?: Array<{
        name?: string;
        description?: string;
        macAddress?: string;
        ipv4Addresses?: string[];
        speedBitsPerSecond?: number;
    }>;
    networkAdapters?: Array<{
        name?: string;
        description?: string;
        macAddress?: string;
        ipv4Addresses?: string[];
    }>;
}

interface RemoteProfileSummary {
    fileName: string;
    isActive?: boolean;
    sizeBytes?: number;
    subjectCount?: number;
    timeLayoutCount?: number;
    classPlanCount?: number;
}

interface InstalledPluginSummary {
    id: string;
    name?: string;
    version?: string;
    author?: string;
    isEnabled?: boolean;
    isUninstalling?: boolean;
    loadStatus?: string;
}

interface InstalledThemeSummary {
    id: string;
    name?: string;
    version?: string;
    author?: string;
    isEnabled?: boolean;
    isError?: boolean;
}

interface ProcessItem {
    pid?: number;
    name?: string;
    mainWindowTitle?: string;
    windowTitle?: string;
    workingSetBytes?: number;
    memoryMB?: number;
    responding?: boolean;
    executablePath?: string;
}

function formatByteSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return "-";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
}

export default function ClientsPage() {
    const { accountId, currentAccount } = useAccount();
    const [clientList, setClientList] = useState<ClientDeviceOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "disabled">("all");
    const [selectedUids, setSelectedUids] = useState<string[]>([]);

    // 7 大资源可用文件名列表
    const [resourceOptions, setResourceOptions] = useState<Record<ResourceType, string[]>>({
        Subjects: [],
        TimeLayout: [],
        ClassPlan: [],
        Policy: [],
        Credentials: [],
        Components: [],
        DefaultSettings: [],
    });

    // 账户默认下发档案弹窗
    const [defaultProfileOpen, setDefaultProfileOpen] = useState(false);
    const [defaultProfileForm, setDefaultProfileForm] = useState<ClientProfileConfig>({});
    const [savingDefaultProfile, setSavingDefaultProfile] = useState(false);

    // 批量分配档案弹窗
    const [batchProfileOpen, setBatchProfileOpen] = useState(false);
    const [batchProfileForm, setBatchProfileForm] = useState<ClientProfileConfig>({});
    const [batchLoading, setBatchLoading] = useState(false);

    // 单设备管理弹窗
    const [activeClient, setActiveClient] = useState<ClientDeviceOut | null>(null);
    const [activeTab, setActiveTab] = useState<DetailTab>("info");
    const [editDisplayName, setEditDisplayName] = useState("");
    const [editClientId, setEditClientId] = useState("");
    const [editProfileForm, setEditProfileForm] = useState<ClientProfileConfig>({});
    const [useCustomProfile, setUseCustomProfile] = useState(false);
    const [savingDevice, setSavingDevice] = useState(false);

    // 集控增强子页面与状态
    const [extendSubTab, setExtendSubTab] = useState<ExtendSubTab>("hardware");
    const [extendBusy, setExtendBusy] = useState(false);
    const [extendResultText, setExtendResultText] = useState("");
    const [hardwareData, setHardwareData] = useState<HardwareSummary | null>(null);

    // 设置与档案热更新表单
    const [settingsPatchText, setSettingsPatchText] = useState("{\n  \"IsNotificationEnabled\": true\n}");
    const [overlayPropsToRemove, setOverlayPropsToRemove] = useState("IsNotificationEnabled");
    const [remoteProfiles, setRemoteProfiles] = useState<RemoteProfileSummary[]>([]);
    const [selectedRemoteProfile, setSelectedRemoteProfile] = useState("");
    const [profileEditName, setProfileEditName] = useState("Default.json");
    const [profileEditContent, setProfileEditContent] = useState("{\n  \"Name\": \"默认档案\",\n  \"Subjects\": {},\n  \"TimeLayouts\": {},\n  \"ClassPlans\": {}\n}");
    const [profileActivateOnSave, setProfileActivateOnSave] = useState(false);
    const [tempClassPlanMode, setTempClassPlanMode] = useState<"set" | "overlay" | "group" | "clear">("set");
    const [tempClassPlanId, setTempClassPlanId] = useState("");
    const [tempTimeLayoutId, setTempTimeLayoutId] = useState("");
    const [remoteComponentConfigs, setRemoteComponentConfigs] = useState<string[]>([]);
    const [selectedComponentConfig, setSelectedComponentConfig] = useState("Default");
    const [componentConfigEditName, setComponentConfigEditName] = useState("Default");
    const [componentConfigEditContent, setComponentConfigEditContent] = useState("{\n  \"Lines\": []\n}");

    // 自动化、更新、插件与主题管理状态
    const [remoteAutomations, setRemoteAutomations] = useState<string[]>([]);
    const [selectedAutomation, setSelectedAutomation] = useState("");
    const [automationEnabled, setAutomationEnabled] = useState(true);
    const [automationEditName, setAutomationEditName] = useState("Default");
    const [automationEditContent, setAutomationEditContent] = useState("[]");
    const [updateMode, setUpdateMode] = useState<number>(2);
    const [updateChannel, setUpdateChannel] = useState("stable");
    const [pluginList, setPluginList] = useState<InstalledPluginSummary[]>([]);
    const [pluginTargetId, setPluginTargetId] = useState("");
    const [pluginPackageUrl, setPluginPackageUrl] = useState("");
    const [themeList, setThemeList] = useState<InstalledThemeSummary[]>([]);
    const [themeTargetId, setThemeTargetId] = useState("");
    const [themeAppearanceMode, setThemeAppearanceMode] = useState<number>(0);
    const [themeColorSource, setThemeColorSource] = useState<number>(1);

    // 远程协助状态
    const [screenshotBase64, setScreenshotBase64] = useState("");
    const [screenshotMime, setScreenshotMime] = useState("image/jpeg");
    const [screenshotTime, setScreenshotTime] = useState("");
    const [screenshotDisplayIndex, setScreenshotDisplayIndex] = useState<number>(0);
    const [screenshotScale, setScreenshotScale] = useState<number>(0.75);
    const [clickButtonType, setClickButtonType] = useState<"left" | "right" | "middle">("left");
    const [clickModeType, setClickModeType] = useState<"single" | "double" | "down" | "up" | "move">("single");
    const [manualClickX, setManualClickX] = useState<number>(0);
    const [manualClickY, setManualClickY] = useState<number>(0);
    const [processKeyword, setProcessKeyword] = useState("");
    const [processList, setProcessList] = useState<ProcessItem[]>([]);
    const [execShell, setExecShell] = useState<"powershell" | "pwsh" | "cmd" | "bash" | "sh">("powershell");
    const [execCommandText, setExecCommandText] = useState("");
    const [execWorkingDir, setExecWorkingDir] = useState("");
    const [execTimeoutSeconds, setExecTimeoutSeconds] = useState<number>(15);

    // 远程配置快照
    const [snapshots, setSnapshots] = useState<ConfigUploadItem[]>([]);
    const [snapshotsLoading, setSnapshotsLoading] = useState(false);
    const [activeSnapshot, setActiveSnapshot] = useState<ConfigUploadItem | null>(null);
    const [requestingConfigType, setRequestingConfigType] = useState<number>(1);

    // 单设备审计日志
    const [deviceAudits, setDeviceAudits] = useState<AuditLogItem[]>([]);
    const [auditsLoading, setAuditsLoading] = useState(false);

    // 通知表单
    const [notifyForm, setNotifyForm] = useState<NotificationPayload>({
        MessageMask: "集控通知",
        MessageContent: "",
        DurationSeconds: 5,
        RepeatCounts: 1,
        IsEmergency: false,
        IsSpeechEnabled: true,
        IsEffectEnabled: true,
        IsSoundEnabled: true,
        IsTopmost: true,
    });

    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const loadResourceLists = useCallback(async () => {
        if (!accountId) return;
        const nextOpts: Record<ResourceType, string[]> = {
            Subjects: [],
            TimeLayout: [],
            ClassPlan: [],
            Policy: [],
            Credentials: [],
            Components: [],
            DefaultSettings: [],
        };
        await Promise.all(
            RESOURCE_TYPES.map(async (rt) => {
                try {
                    const list = await data.list(accountId, rt);
                    nextOpts[rt] = Array.isArray(list) ? list : [];
                } catch {
                    nextOpts[rt] = [];
                }
            })
        );
        setResourceOptions(nextOpts);
    }, [accountId]);

    const loadData = useCallback(async () => {
        if (!accountId) return;
        setLoading(true);
        try {
            const cl = await clients.list(accountId);
            setClientList(Array.isArray(cl) ? cl : []);
        } catch {
            setClientList([]);
        }
        setLoading(false);
    }, [accountId]);

    useEffect(() => {
        loadData();
        loadResourceLists();
    }, [loadData, loadResourceLists]);

    const filteredClients = clientList.filter((c) => {
        if (statusFilter === "online" && c.status !== "online") return false;
        if (statusFilter === "offline" && c.status !== "offline") return false;
        if (statusFilter === "disabled" && !c.is_disabled) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            return (
                c.uid.toLowerCase().includes(q) ||
                (c.client_id || "").toLowerCase().includes(q) ||
                (c.display_name || "").toLowerCase().includes(q) ||
                (c.mac || "").toLowerCase().includes(q) ||
                (c.ip || "").toLowerCase().includes(q)
            );
        }
        return true;
    });

    function toggleSelectAll(checked: boolean) {
        if (checked) {
            setSelectedUids(filteredClients.map((c) => c.uid));
        } else {
            setSelectedUids([]);
        }
    }

    function toggleSelectOne(uid: string) {
        setSelectedUids((prev) =>
            prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
        );
    }

    async function openDefaultProfileModal() {
        await loadResourceLists();
        try {
            const res = await clients.getProfileConfig(accountId, "__default__");
            setDefaultProfileForm(res.profile_config || {});
        } catch {
            setDefaultProfileForm({
                Subjects: "default",
                TimeLayout: "default",
                ClassPlan: "default",
                Policy: "default",
                Credentials: "default",
                Components: "default",
                DefaultSettings: "default",
            });
        }
        setDefaultProfileOpen(true);
    }

    async function handleSaveDefaultProfile() {
        setSavingDefaultProfile(true);
        try {
            await clients.config(accountId, "__default__", defaultProfileForm);
            setMsg({ type: "success", text: "账户默认下发档案配置已保存" });
            setDefaultProfileOpen(false);
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
        setSavingDefaultProfile(false);
    }

    async function openClientModal(client: ClientDeviceOut, initialTab: DetailTab = "info") {
        setActiveClient(client);
        setActiveTab(initialTab);
        setEditDisplayName(client.display_name || client.client_id || client.uid);
        setEditClientId(client.client_id || "");
        setUseCustomProfile(client.has_custom_profile);
        setEditProfileForm(client.profile_config || {});
        setActiveSnapshot(null);
        setExtendResultText("");
        if (initialTab === "snapshots") {
            loadSnapshots(client.uid);
        } else if (initialTab === "audit") {
            loadDeviceAudits(client.uid);
        }
    }

    async function loadSnapshots(uid: string) {
        setSnapshotsLoading(true);
        try {
            const list = await clients.listConfigUploads(accountId, uid);
            setSnapshots(Array.isArray(list) ? list : []);
        } catch {
            setSnapshots([]);
        }
        setSnapshotsLoading(false);
    }

    async function loadDeviceAudits(uid: string) {
        setAuditsLoading(true);
        try {
            const list = await audit.list(accountId, { client_uid: uid, limit: 100 });
            setDeviceAudits(Array.isArray(list) ? list : []);
        } catch {
            setDeviceAudits([]);
        }
        setAuditsLoading(false);
    }

    async function handleSwitchTab(tab: DetailTab) {
        setActiveTab(tab);
        if (!activeClient) return;
        if (tab === "snapshots") {
            await loadSnapshots(activeClient.uid);
        } else if (tab === "audit") {
            await loadDeviceAudits(activeClient.uid);
        }
    }

    async function dispatchAndPollExtendCommand(
        action: string,
        payload: Record<string, unknown> = {},
        onSuccess?: (data: unknown) => void
    ) {
        if (!activeClient) return;
        setExtendBusy(true);
        try {
            const dispatched = await clients.sendExtendCommand(
                accountId,
                activeClient.uid,
                action,
                payload,
                300
            );
            setMsg({ type: "success", text: "指令已下发，正在等待终端执行回传" });

            let completedDetail: ConfigUploadItem | null = null;
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise((r) => setTimeout(r, 1000));
                try {
                    const detail = await clients.getConfigUploadDetail(accountId, dispatched.request_guid);
                    if (detail.status === "completed") {
                        completedDetail = detail;
                        break;
                    }
                } catch {
                    // Continue polling
                }
            }

            if (!completedDetail) {
                setMsg({
                    type: "error",
                    text: "指令已下发，但终端暂未回传执行结果，请稍后在远程配置抓取列表中查看",
                });
                setExtendBusy(false);
                return;
            }

            const rawParsed = completedDetail.parsed_payload as CommandExecutionEnvelope | undefined;
            if (rawParsed && typeof rawParsed === "object" && ("success" in rawParsed || "ok" in rawParsed)) {
                const isOk = "success" in rawParsed ? Boolean(rawParsed.success) : Boolean(rawParsed.ok);
                if (!isOk) {
                    setMsg({
                        type: "error",
                        text: rawParsed.message || rawParsed.errorMessage || "终端拒绝或未能完成该指令",
                    });
                    setExtendResultText(JSON.stringify(rawParsed, null, 2));
                } else {
                    setMsg({ type: "success", text: "终端已完成指令并回传结果" });
                    setExtendResultText(JSON.stringify(rawParsed.data ?? rawParsed, null, 2));
                    if (onSuccess) {
                        onSuccess(rawParsed.data);
                    }
                }
            } else {
                setMsg({ type: "success", text: "终端已回传数据" });
                setExtendResultText(
                    completedDetail.parsed_payload
                        ? JSON.stringify(completedDetail.parsed_payload, null, 2)
                        : completedDetail.payload || ""
                );
                if (onSuccess) {
                    onSuccess(completedDetail.parsed_payload);
                }
            }
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "下发扩展指令失败" });
        }
        setExtendBusy(false);
    }

    async function handleBroadcastExtend(action: string, payload: Record<string, unknown> = {}) {
        if (selectedUids.length === 0) return;
        setBatchLoading(true);
        try {
            const res = await clients.broadcastExtendCommand(accountId, action, payload, selectedUids, 300);
            setMsg({
                type: "success",
                text: `已向 ${res.delivered_count ?? res.sent_count ?? res.dispatched_count ?? selectedUids.length} 台设备批量下发扩展指令`,
            });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "批量下发指令失败" });
        }
        setBatchLoading(false);
    }

    function handleScreenshotClick(e: React.MouseEvent<HTMLImageElement>) {
        if (!activeClient || extendBusy) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        dispatchAndPollExtendCommand("remote.simulate_click", {
            normalizedX: Number(normX.toFixed(4)),
            normalizedY: Number(normY.toFixed(4)),
            button: clickButtonType,
            clickType: clickModeType,
        });
    }

    async function handleSaveDeviceInfo() {
        if (!activeClient) return;
        setSavingDevice(true);
        try {
            await clients.rename(accountId, activeClient.uid, {
                display_name: editDisplayName.trim(),
                client_id: editClientId.trim(),
            });
            setMsg({ type: "success", text: "设备信息已更新" });
            await loadData();
            const updated = await clients.details(accountId, activeClient.uid);
            setActiveClient(updated);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
        setSavingDevice(false);
    }

    async function handleToggleDeviceDisable(client: ClientDeviceOut) {
        setActionLoading(client.uid);
        try {
            if (client.is_disabled) {
                await clients.enable(accountId, client.uid);
                setMsg({ type: "success", text: `设备 ${client.display_name || client.uid} 已启用` });
            } else {
                await clients.disable(accountId, client.uid);
                setMsg({ type: "success", text: `设备 ${client.display_name || client.uid} 已禁用并断开连接` });
            }
            await loadData();
            if (activeClient && activeClient.uid === client.uid) {
                const updated = await clients.details(accountId, client.uid);
                setActiveClient(updated);
            }
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "操作失败" });
        }
        setActionLoading(null);
    }

    async function handleSaveDeviceProfile() {
        if (!activeClient) return;
        setSavingDevice(true);
        try {
            if (!useCustomProfile) {
                await clients.config(accountId, activeClient.uid, {
                    ClassPlan: "",
                    TimeLayout: "",
                    Subjects: "",
                    DefaultSettings: "",
                    Policy: "",
                    Components: "",
                    Credentials: "",
                });
            } else {
                await clients.config(accountId, activeClient.uid, editProfileForm);
            }
            setMsg({ type: "success", text: "设备档案绑定已更新并向在线终端推送同步指令" });
            await loadData();
            const updated = await clients.details(accountId, activeClient.uid);
            setActiveClient(updated);
            setUseCustomProfile(updated.has_custom_profile);
            setEditProfileForm(updated.profile_config || {});
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存档案配置失败" });
        }
        setSavingDevice(false);
    }

    async function handleRequestSnapshot() {
        if (!activeClient) return;
        setSnapshotsLoading(true);
        try {
            await clients.getConfig(accountId, activeClient.uid, requestingConfigType);
            setMsg({
                type: "success",
                text: "已向终端下发配置上报请求，请稍候点击刷新查看结果",
            });
            await loadSnapshots(activeClient.uid);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "请求抓取失败" });
        }
        setSnapshotsLoading(false);
    }

    async function handleViewSnapshotDetail(guid: string) {
        try {
            const detail = await clients.getConfigUploadDetail(accountId, guid);
            setActiveSnapshot(detail);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "获取快照详情失败" });
        }
    }

    async function handleRestart(uid: string) {
        setActionLoading(uid);
        try {
            await clients.restart(accountId, uid);
            setMsg({ type: "success", text: `已向 ${uid} 发送重启指令` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "发送指令失败" });
        }
        setActionLoading(null);
    }

    async function handleSync(uid: string) {
        setActionLoading(uid);
        try {
            await clients.forceSync(accountId, uid);
            setMsg({ type: "success", text: `已向 ${uid} 发送强制同步指令` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "发送指令失败" });
        }
        setActionLoading(null);
    }

    async function handleDisconnect(uid: string) {
        setActionLoading(uid);
        try {
            await clients.disconnect(accountId, uid);
            setMsg({ type: "success", text: `已断开设备 ${uid} 的连接` });
            await loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "断开连接失败" });
        }
        setActionLoading(null);
    }

    async function handleDeleteDevice(uid: string) {
        if (!confirm(`确定要注销并移除客户端 ${uid} 吗？移除后该客户端需重新注册。`)) return;
        setActionLoading(uid);
        try {
            await clients.delete(accountId, uid);
            setMsg({ type: "success", text: `已移除客户端 ${uid}` });
            if (activeClient?.uid === uid) setActiveClient(null);
            setSelectedUids((prev) => prev.filter((id) => id !== uid));
            await loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "移除失败" });
        }
        setActionLoading(null);
    }

    async function handleSendNotification() {
        if (!activeClient) return;
        setSavingDevice(true);
        try {
            await clients.sendNotification(accountId, activeClient.uid, notifyForm);
            setMsg({ type: "success", text: `通知已推送至 ${activeClient.display_name || activeClient.uid}` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "推送失败" });
        }
        setSavingDevice(false);
    }

    async function handleBatchAction(
        action: "force_sync" | "restart" | "disconnect" | "enable" | "disable" | "delete" | "assign_profile"
    ) {
        if (selectedUids.length === 0) return;
        if (action === "delete" && !confirm(`确定要批量移除选中的 ${selectedUids.length} 台设备吗？`)) {
            return;
        }
        setBatchLoading(true);
        try {
            await clients.batch(accountId, {
                client_uids: selectedUids,
                action,
                profile_config: action === "assign_profile" ? batchProfileForm : undefined,
            });
            setMsg({ type: "success", text: `已对 ${selectedUids.length} 台设备执行批量操作` });
            if (action === "assign_profile") setBatchProfileOpen(false);
            if (action === "delete") setSelectedUids([]);
            await loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "批量操作失败" });
        }
        setBatchLoading(false);
    }

    const onlineCount = clientList.filter((c) => c.status === "online").length;
    const customProfileCount = clientList.filter((c) => c.has_custom_profile).length;
    const disabledCount = clientList.filter((c) => c.is_disabled).length;
    const slugName = currentAccount?.slug || "account";

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">客户端管理</h1>
                    <p className="page-subtitle">
                        实时监控设备状态、分配集控资源档案并执行远程控制与增强运维指令
                    </p>
                </div>
                <div className="flex gap-8">
                    <DownloadPresetPopoverButton
                        buttonText="下载通用配置"
                        appearance="secondary"
                        defaultFileName={`ManagementPreset-${slugName}-generic.json`}
                        onFetchData={() => accounts.downloadPreset(accountId)}
                        onError={(text) => setMsg({ type: "error", text })}
                    />
                    <Button appearance="secondary" icon={<Settings24Regular />} onClick={openDefaultProfileModal}>
                        默认下发档案配置
                    </Button>
                    <Button appearance="primary" icon={<ArrowSync24Regular />} onClick={loadData}>
                        刷新状态
                    </Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            {/* 统计概览卡片 */}
            <div className="grid-4 mb-16">
                <div className="stat-card">
                    <div className="stat-value">{clientList.length}</div>
                    <div className="stat-label">已注册设备总数</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: "var(--success-color)" }}>{onlineCount}</div>
                    <div className="stat-label">当前在线设备</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{customProfileCount}</div>
                    <div className="stat-label">专属档案绑定设备</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: disabledCount > 0 ? "var(--danger-color)" : undefined }}>
                        {disabledCount}
                    </div>
                    <div className="stat-label">已禁用设备</div>
                </div>
            </div>

            {/* 筛选与批量操作栏 */}
            <div className="card" style={{ padding: "14px 20px" }}>
                <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12 }}>
                    <div className="flex items-center gap-12" style={{ flex: 1, minWidth: 280 }}>
                        <Input
                            placeholder="搜索设备名称、班级标识、设备编号或网络地址..."
                            value={searchQuery}
                            onChange={(_, d) => setSearchQuery(d.value)}
                            style={{ width: 320 }}
                        />
                        <Select
                            value={statusFilter}
                            onChange={(_, d) => setStatusFilter(d.value as typeof statusFilter)}
                        >
                            <option value="all">全部状态 {clientList.length} 台</option>
                            <option value="online">仅在线 {onlineCount} 台</option>
                            <option value="offline">仅离线 {clientList.length - onlineCount} 台</option>
                            <option value="disabled">已禁用 {disabledCount} 台</option>
                        </Select>
                    </div>

                    {selectedUids.length > 0 && (
                        <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--accent-color)" }}>
                                已选 {selectedUids.length} 台：
                            </span>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBatchAction("force_sync")}>
                                批量同步
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => {
                                    setBatchProfileForm({
                                        Subjects: "default",
                                        TimeLayout: "default",
                                        ClassPlan: "default",
                                        Policy: "default",
                                        Credentials: "default",
                                        Components: "default",
                                        DefaultSettings: "default",
                                    });
                                    setBatchProfileOpen(true);
                                }}>
                                批量分配档案
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBroadcastExtend("profile.reload", {})}>
                                批量重载档案
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBroadcastExtend("update.action", { operation: "check" })}>
                                批量检查更新
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBatchAction("restart")}>
                                批量重启
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBatchAction("disconnect")}>
                                批量断开
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBatchAction("enable")}>
                                批量启用
                            </Button>
                            <Button size="small" appearance="secondary" disabled={batchLoading}
                                onClick={() => handleBatchAction("disable")}>
                                批量禁用
                            </Button>
                            <Button size="small" appearance="subtle" disabled={batchLoading}
                                style={{ color: "var(--danger-color)" }}
                                onClick={() => handleBatchAction("delete")}>
                                批量移除
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* 设备列表表格 */}
            <div className="card">
                {loading ? (
                    <div className="empty-state"><Spinner size="medium" /></div>
                ) : filteredClients.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-text">暂无符合条件的客户端设备</div>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: 36 }}>
                                    <input
                                        type="checkbox"
                                        checked={filteredClients.length > 0 && selectedUids.length === filteredClients.length}
                                        onChange={(e) => toggleSelectAll(e.target.checked)}
                                    />
                                </th>
                                <th>设备名称与班级标识</th>
                                <th>设备标识码</th>
                                <th>网络地址</th>
                                <th>状态</th>
                                <th>下发档案策略</th>
                                <th>最后活跃</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredClients.map((c) => (
                                <tr key={c.uid}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedUids.includes(c.uid)}
                                            onChange={() => toggleSelectOne(c.uid)}
                                        />
                                    </td>
                                    <td>
                                        <div style={{ fontWeight: 600 }}>{c.display_name || c.client_id || "未命名设备"}</div>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                            班级标识: {c.client_id || "-"}
                                        </div>
                                    </td>
                                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.uid}</td>
                                    <td style={{ fontSize: 12 }}>
                                        <div>网络地址: {c.ip || "-"}</div>
                                        <div style={{ color: "var(--text-secondary)" }}>物理地址: {c.mac || "-"}</div>
                                    </td>
                                    <td>
                                        <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
                                            <span className={`badge ${c.status === "online" ? "badge-success" : "badge-danger"}`}>
                                                {c.status === "online" ? "在线" : "离线"}
                                            </span>
                                            {c.is_disabled && (
                                                <span className="badge badge-warning">已禁用</span>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`badge ${c.has_custom_profile ? "badge-info" : "badge-success"}`}>
                                            {c.has_custom_profile ? "专属档案" : "账户默认"}
                                        </span>
                                        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                                            课表: {c.profile_config?.ClassPlan || "default"} / 时间表: {c.profile_config?.TimeLayout || "default"}
                                        </div>
                                    </td>
                                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                        {c.last_seen_at
                                            ? new Date(c.last_seen_at).toLocaleString("zh-CN")
                                            : c.registered_at
                                            ? new Date(c.registered_at).toLocaleString("zh-CN")
                                            : "-"}
                                    </td>
                                    <td>
                                        <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
                                            <Button
                                                appearance="primary"
                                                size="small"
                                                icon={<Settings24Regular />}
                                                onClick={() => openClientModal(c, "info")}
                                            >
                                                管理与配置
                                            </Button>
                                            <Button
                                                appearance="secondary"
                                                size="small"
                                                icon={<Wrench24Regular />}
                                                onClick={() => openClientModal(c, "extend")}
                                                disabled={c.status !== "online"}
                                            >
                                                集控增强
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<ArrowSync24Regular />}
                                                onClick={() => handleSync(c.uid)}
                                                disabled={actionLoading === c.uid || c.status !== "online"}
                                                title="立即同步配置"
                                            >
                                                同步
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<ArrowClockwise24Regular />}
                                                onClick={() => handleRestart(c.uid)}
                                                disabled={actionLoading === c.uid || c.status !== "online"}
                                                title="重启客户端"
                                            >
                                                重启
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<Send24Regular />}
                                                onClick={() => openClientModal(c, "notify")}
                                                disabled={c.status !== "online"}
                                            >
                                                通知
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* 账户默认下发档案配置弹窗 */}
            {defaultProfileOpen && (
                <Dialog open onOpenChange={(_, d) => setDefaultProfileOpen(d.open)}>
                    <DialogSurface style={{ minWidth: 540 }}>
                        <DialogBody>
                            <DialogTitle>账户默认下发档案配置</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    设置本账户下所有未单独绑定专属档案的客户端默认拉取的集控资源文件。
                                </p>
                                <div className="grid-2">
                                    {RESOURCE_TYPES.map((rt) => (
                                        <div key={rt} className="form-group">
                                            <label className="form-label">{RESOURCE_TYPE_LABELS[rt]}</label>
                                            <Select
                                                value={defaultProfileForm[rt] ?? ""}
                                                onChange={(_, d) =>
                                                    setDefaultProfileForm((prev) => ({ ...prev, [rt]: d.value }))
                                                }
                                                style={{ width: "100%" }}
                                            >
                                                <option value="">-- 不下发此项 --</option>
                                                {resourceOptions[rt].map((name) => (
                                                    <option key={name} value={name}>{name}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setDefaultProfileOpen(false)}>取消</Button>
                                <Button appearance="primary" onClick={handleSaveDefaultProfile} disabled={savingDefaultProfile}>
                                    {savingDefaultProfile ? <Spinner size="tiny" /> : "保存默认配置"}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 批量分配档案弹窗 */}
            {batchProfileOpen && (
                <Dialog open onOpenChange={(_, d) => setBatchProfileOpen(d.open)}>
                    <DialogSurface style={{ minWidth: 540 }}>
                        <DialogBody>
                            <DialogTitle>批量分配档案 — 共 {selectedUids.length} 台设备</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    为选中的 {selectedUids.length} 台设备统一指定集控资源并立即推送同步通知。
                                </p>
                                <div className="grid-2">
                                    {RESOURCE_TYPES.map((rt) => (
                                        <div key={rt} className="form-group">
                                            <label className="form-label">{RESOURCE_TYPE_LABELS[rt]}</label>
                                            <Select
                                                value={batchProfileForm[rt] ?? ""}
                                                onChange={(_, d) =>
                                                    setBatchProfileForm((prev) => ({ ...prev, [rt]: d.value }))
                                                }
                                                style={{ width: "100%" }}
                                            >
                                                <option value="">-- 不下发或跟随默认 --</option>
                                                {resourceOptions[rt].map((name) => (
                                                    <option key={name} value={name}>{name}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setBatchProfileOpen(false)}>取消</Button>
                                <Button
                                    appearance="primary"
                                    onClick={() => handleBatchAction("assign_profile")}
                                    disabled={batchLoading}
                                >
                                    {batchLoading ? <Spinner size="tiny" /> : "确认分配并同步"}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 单设备管理与配置主弹窗 */}
            {activeClient && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setActiveClient(null); }}>
                    <DialogSurface style={{ minWidth: 820, maxWidth: "94vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                设备管理 — {activeClient.display_name || activeClient.client_id || activeClient.uid}
                            </DialogTitle>
                            <DialogContent>
                                <div className="tab-bar">
                                    <button
                                        type="button"
                                        className={`tab-btn ${activeTab === "info" ? "active" : ""}`}
                                        onClick={() => handleSwitchTab("info")}
                                    >
                                        基本信息与控制
                                    </button>
                                    <button
                                        type="button"
                                        className={`tab-btn ${activeTab === "profile" ? "active" : ""}`}
                                        onClick={() => handleSwitchTab("profile")}
                                    >
                                        档案资源绑定
                                    </button>
                                    <button
                                        type="button"
                                        className={`tab-btn ${activeTab === "extend" ? "active" : ""}`}
                                        onClick={() => handleSwitchTab("extend")}
                                    >
                                        集控增强
                                    </button>
                                    <button
                                        type="button"
                                        className={`tab-btn ${activeTab === "snapshots" ? "active" : ""}`}
                                        onClick={() => handleSwitchTab("snapshots")}
                                    >
                                        远程配置抓取
                                    </button>
                                    <button
                                        type="button"
                                        className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
                                        onClick={() => handleSwitchTab("audit")}
                                    >
                                        设备审计日志
                                    </button>
                                    <button
                                        type="button"
                                        className={`tab-btn ${activeTab === "notify" ? "active" : ""}`}
                                        onClick={() => handleSwitchTab("notify")}
                                    >
                                        推送桌面通知
                                    </button>
                                </div>

                                {/* Tab 1: 基本信息与远程控制 */}
                                {activeTab === "info" && (
                                    <div>
                                        <div className="grid-2 mb-16">
                                            <div className="form-group">
                                                <label className="form-label">设备显示名称</label>
                                                <Input
                                                    value={editDisplayName}
                                                    onChange={(_, d) => setEditDisplayName(d.value)}
                                                    placeholder="例如：高一1班讲台一体机"
                                                    style={{ width: "100%" }}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">班级标识</label>
                                                <Input
                                                    value={editClientId}
                                                    onChange={(_, d) => setEditClientId(d.value)}
                                                    placeholder="例如：class-101"
                                                    style={{ width: "100%" }}
                                                />
                                            </div>
                                        </div>

                                        <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                            <div className="grid-2" style={{ gap: 8, fontSize: 13 }}>
                                                <div><strong>设备标识码：</strong>{activeClient.uid}</div>
                                                <div><strong>当前状态：</strong>{activeClient.status === "online" ? "在线" : "离线"}</div>
                                                <div><strong>物理网卡地址：</strong>{activeClient.mac || "-"}</div>
                                                <div><strong>最近网络地址：</strong>{activeClient.ip || "-"}</div>
                                                <div>
                                                    <strong>注册时间：</strong>
                                                    {activeClient.registered_at ? new Date(activeClient.registered_at).toLocaleString("zh-CN") : "-"}
                                                </div>
                                                <div>
                                                    <strong>最后心跳：</strong>
                                                    {activeClient.last_seen_at ? new Date(activeClient.last_seen_at).toLocaleString("zh-CN") : "-"}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between mb-16">
                                            <Button
                                                appearance="primary"
                                                onClick={handleSaveDeviceInfo}
                                                disabled={savingDevice}
                                            >
                                                {savingDevice ? <Spinner size="tiny" /> : "保存设备名称与标识"}
                                            </Button>

                                            <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                                <Button
                                                    appearance="secondary"
                                                    icon={<ArrowSync24Regular />}
                                                    onClick={() => handleSync(activeClient.uid)}
                                                    disabled={activeClient.status !== "online"}
                                                >
                                                    强制同步配置
                                                </Button>
                                                <Button
                                                    appearance="secondary"
                                                    icon={<ArrowClockwise24Regular />}
                                                    onClick={() => handleRestart(activeClient.uid)}
                                                    disabled={activeClient.status !== "online"}
                                                >
                                                    重启客户端
                                                </Button>
                                                <Button
                                                    appearance="secondary"
                                                    icon={<PlugDisconnected24Regular />}
                                                    onClick={() => handleDisconnect(activeClient.uid)}
                                                    disabled={activeClient.status !== "online"}
                                                >
                                                    断开连接
                                                </Button>
                                                <Button
                                                    appearance="secondary"
                                                    icon={activeClient.is_disabled ? <CheckmarkCircle24Regular /> : <DismissCircle24Regular />}
                                                    onClick={() => handleToggleDeviceDisable(activeClient)}
                                                >
                                                    {activeClient.is_disabled ? "启用此设备" : "禁用此设备"}
                                                </Button>
                                                <Button
                                                    appearance="subtle"
                                                    icon={<Delete24Regular />}
                                                    style={{ color: "var(--danger-color)" }}
                                                    onClick={() => handleDeleteDevice(activeClient.uid)}
                                                >
                                                    注销并删除
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Tab 2: 档案资源绑定 */}
                                {activeTab === "profile" && (
                                    <div>
                                        <div className="settings-item" style={{ marginBottom: 16 }}>
                                            <div className="settings-item-info">
                                                <div className="settings-item-label">为此设备指定专属档案配置</div>
                                                <div className="settings-item-hint">
                                                    关闭时，该设备将自动继承账户默认下发档案配置；开启后可单独指定各类集控资源文件。
                                                </div>
                                            </div>
                                            <Switch
                                                checked={useCustomProfile}
                                                onChange={(_, d) => setUseCustomProfile(d.checked)}
                                            />
                                        </div>

                                        {useCustomProfile && (
                                            <div className="grid-2 mb-16">
                                                {RESOURCE_TYPES.map((rt) => (
                                                    <div key={rt} className="form-group">
                                                        <label className="form-label">{RESOURCE_TYPE_LABELS[rt]}</label>
                                                        <Select
                                                            value={editProfileForm[rt] ?? ""}
                                                            onChange={(_, d) =>
                                                                setEditProfileForm((prev) => ({ ...prev, [rt]: d.value }))
                                                            }
                                                            style={{ width: "100%" }}
                                                        >
                                                            <option value="">-- 不下发此项或跟随账户默认 --</option>
                                                            {resourceOptions[rt].map((name) => (
                                                                <option key={name} value={name}>{name}</option>
                                                            ))}
                                                        </Select>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex justify-between items-center">
                                            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                                保存后若客户端在线，将立即向终端推送同步通知并触发资源拉取。
                                            </span>
                                            <Button
                                                appearance="primary"
                                                onClick={handleSaveDeviceProfile}
                                                disabled={savingDevice}
                                            >
                                                {savingDevice ? <Spinner size="tiny" /> : "保存档案绑定并同步"}
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* Tab 3: 集控增强 */}
                                {activeTab === "extend" && (
                                    <div>
                                        <div className="flex items-center justify-between mb-16" style={{ flexWrap: "wrap", gap: 8 }}>
                                            <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                                <Button
                                                    size="small"
                                                    appearance={extendSubTab === "hardware" ? "primary" : "secondary"}
                                                    icon={<Desktop24Regular />}
                                                    onClick={() => setExtendSubTab("hardware")}
                                                >
                                                    硬件与系统状态
                                                </Button>
                                                <Button
                                                    size="small"
                                                    appearance={extendSubTab === "runtime" ? "primary" : "secondary"}
                                                    icon={<Folder24Regular />}
                                                    onClick={() => setExtendSubTab("runtime")}
                                                >
                                                    设置与档案热更新
                                                </Button>
                                                <Button
                                                    size="small"
                                                    appearance={extendSubTab === "ops" ? "primary" : "secondary"}
                                                    icon={<Wrench24Regular />}
                                                    onClick={() => setExtendSubTab("ops")}
                                                >
                                                    扩展运维管理
                                                </Button>
                                                <Button
                                                    size="small"
                                                    appearance={extendSubTab === "remote" ? "primary" : "secondary"}
                                                    icon={<CursorClick24Regular />}
                                                    onClick={() => setExtendSubTab("remote")}
                                                >
                                                    远程协助
                                                </Button>
                                            </div>
                                            {extendBusy && <Spinner size="tiny" label="正在等待终端响应" />}
                                        </div>

                                        {/* 子面板 1: 硬件与系统状态 */}
                                        {extendSubTab === "hardware" && (
                                            <div>
                                                <div className="flex items-center justify-between mb-16">
                                                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                                        采集终端的处理器、内存、显卡、磁盘分区、显示器与网络适配器信息。
                                                    </span>
                                                    <Button
                                                        appearance="primary"
                                                        icon={<ArrowSync24Regular />}
                                                        disabled={extendBusy || activeClient.status !== "online"}
                                                        onClick={() =>
                                                            dispatchAndPollExtendCommand("hardware.get_info", {}, (res) => {
                                                                if (res && typeof res === "object") {
                                                                    setHardwareData(res as HardwareSummary);
                                                                }
                                                            })
                                                        }
                                                    >
                                                        获取硬件信息
                                                    </Button>
                                                </div>

                                                {hardwareData && (
                                                    <div className="grid-2 mb-16">
                                                        <div className="card" style={{ background: "var(--bg-subtle)" }}>
                                                            <div className="card-title">系统与主板</div>
                                                            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                                <div><strong>主机名称：</strong>{hardwareData.system?.machineName || hardwareData.system?.hostName || "-"}</div>
                                                                <div><strong>当前用户：</strong>{hardwareData.system?.userName || "-"}</div>
                                                                <div><strong>操作系统：</strong>{hardwareData.system?.osDescription || "-"}</div>
                                                                <div><strong>系统架构：</strong>{hardwareData.system?.osArchitecture || "-"}</div>
                                                                <div>
                                                                    <strong>持续运行：</strong>
                                                                    {hardwareData.system?.uptimeSeconds !== undefined
                                                                        ? `${(hardwareData.system.uptimeSeconds / 3600).toFixed(1)} 小时`
                                                                        : `${hardwareData.system?.uptimeHours ?? "-"} 小时`}
                                                                </div>
                                                                <div>
                                                                    <strong>主板型号：</strong>
                                                                    {hardwareData.system?.motherboardManufacturer || hardwareData.motherboard?.manufacturer || ""}{" "}
                                                                    {hardwareData.system?.motherboardProduct || hardwareData.motherboard?.product || "-"}
                                                                </div>
                                                                <div>
                                                                    <strong>应用版本：</strong>
                                                                    {hardwareData.system?.appVersion || "-"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="card" style={{ background: "var(--bg-subtle)" }}>
                                                            <div className="card-title">处理器与内存</div>
                                                            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                                <div>
                                                                    <strong>处理器：</strong>
                                                                    {(hardwareData.cpu || hardwareData.processors)
                                                                        ?.map((p) => {
                                                                            const cores = p.physicalCores ?? p.cores;
                                                                            return `${p.name || "处理器"} ${cores || 0}核/${p.logicalProcessors || 0}线程`;
                                                                        })
                                                                        .join("；") || "-"}
                                                                </div>
                                                                <div><strong>物理内存总量：</strong>{formatByteSize(hardwareData.memory?.totalPhysicalBytes)}</div>
                                                                <div><strong>当前可用内存：</strong>{formatByteSize(hardwareData.memory?.availablePhysicalBytes)}</div>
                                                                <div>
                                                                    <strong>显卡设备：</strong>
                                                                    {hardwareData.gpus?.map((g) => g.name).join("；") || "-"}
                                                                </div>
                                                                <div>
                                                                    <strong>显示器：</strong>
                                                                    {hardwareData.displays
                                                                        ? hardwareData.displays
                                                                              .map((d) => `${d.displayName || "显示器"} ${d.widthPixels || 0}×${d.heightPixels || 0}`)
                                                                              .join("；")
                                                                        : hardwareData.monitors
                                                                        ? hardwareData.monitors.map((m) => `${m.name || "显示器"} ${m.bounds || ""}`).join("；")
                                                                        : "-"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="card" style={{ background: "var(--bg-subtle)" }}>
                                                            <div className="card-title">存储与分区</div>
                                                            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                                <div>
                                                                    <strong>物理磁盘：</strong>
                                                                    {hardwareData.disks?.map((d) => `${d.model || "磁盘"} ${formatByteSize(d.sizeBytes)}`).join("；") || "-"}
                                                                </div>
                                                                <div>
                                                                    <strong>逻辑分区：</strong>
                                                                    {hardwareData.partitions
                                                                        ? hardwareData.partitions
                                                                              .map(
                                                                                  (p) =>
                                                                                      `${p.name || ""} 可用 ${formatByteSize(p.availableFreeBytes)} / ${formatByteSize(p.totalSizeBytes)}`
                                                                              )
                                                                              .join("；")
                                                                        : hardwareData.volumes
                                                                        ? hardwareData.volumes
                                                                              .map((v) => `${v.name || ""} 可用 ${formatByteSize(v.freeBytes)} / ${formatByteSize(v.totalBytes)}`)
                                                                              .join("；")
                                                                        : "-"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="card" style={{ background: "var(--bg-subtle)" }}>
                                                            <div className="card-title">网络适配器</div>
                                                            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                                                {(hardwareData.networkInterfaces || hardwareData.networkAdapters || []).length > 0 ? (
                                                                    (hardwareData.networkInterfaces || hardwareData.networkAdapters || []).map((nic, idx) => (
                                                                        <div key={idx} style={{ marginBottom: 4 }}>
                                                                            <strong>{nic.name || "网卡"}：</strong>
                                                                            {(nic.ipv4Addresses || []).join(", ") || "-"} / {nic.macAddress || "-"}
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <div>-</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* 子面板 2: 设置与档案热更新 */}
                                        {extendSubTab === "runtime" && (
                                            <div>
                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">终端设置热更新</div>
                                                    <div className="flex items-center gap-8 mb-12" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("settings.get", {}, (res) => {
                                                                    if (res && typeof res === "object") {
                                                                        const content = "settings" in res ? (res as { settings: unknown }).settings : res;
                                                                        setSettingsPatchText(JSON.stringify(content, null, 2));
                                                                    }
                                                                })
                                                            }
                                                        >
                                                            读取终端设置
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("settings.sync_default", {})}
                                                        >
                                                            同步集控默认设置
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                try {
                                                                    const parsed = JSON.parse(settingsPatchText);
                                                                    dispatchAndPollExtendCommand("settings.patch", { settings: parsed });
                                                                } catch {
                                                                    setMsg({ type: "error", text: "设置内容格式无效" });
                                                                }
                                                            }}
                                                        >
                                                            增量修改设置
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                try {
                                                                    const parsed = JSON.parse(settingsPatchText);
                                                                    dispatchAndPollExtendCommand("settings.set_overlay", { values: parsed });
                                                                } catch {
                                                                    setMsg({ type: "error", text: "覆盖层内容格式无效" });
                                                                }
                                                            }}
                                                        >
                                                            写入设置覆盖层
                                                        </Button>
                                                        <Input
                                                            size="small"
                                                            value={overlayPropsToRemove}
                                                            onChange={(_, d) => setOverlayPropsToRemove(d.value)}
                                                            placeholder="要移除的覆盖属性名，多个用逗号分隔"
                                                            style={{ width: 220 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                const props = overlayPropsToRemove
                                                                    .split(",")
                                                                    .map((s) => s.trim())
                                                                    .filter(Boolean);
                                                                dispatchAndPollExtendCommand("settings.remove_overlay", { properties: props });
                                                            }}
                                                        >
                                                            移除设置覆盖项
                                                        </Button>
                                                    </div>
                                                    <Textarea
                                                        value={settingsPatchText}
                                                        onChange={(_, d) => setSettingsPatchText(d.value)}
                                                        rows={4}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>

                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">多套档案同时管理与运行时热变更</div>
                                                    <div className="flex items-center gap-8 mb-12" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("profile.list", {}, (res) => {
                                                                    if (res && typeof res === "object" && "profiles" in res) {
                                                                        const rawList = (res as { profiles?: Array<string | RemoteProfileSummary>; activeProfile?: string }).profiles || [];
                                                                        const normalized: RemoteProfileSummary[] = rawList.map((item) =>
                                                                            typeof item === "string" ? { fileName: item } : item
                                                                        );
                                                                        setRemoteProfiles(normalized);
                                                                        if (normalized.length > 0 && !selectedRemoteProfile) {
                                                                            setSelectedRemoteProfile(normalized[0].fileName);
                                                                        }
                                                                    }
                                                                })
                                                            }
                                                        >
                                                            获取多套档案列表
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("profile.reload", {})}
                                                        >
                                                            立即热重载当前档案与组件
                                                        </Button>
                                                        <Select
                                                            size="small"
                                                            value={selectedRemoteProfile}
                                                            onChange={(_, d) => setSelectedRemoteProfile(d.value)}
                                                        >
                                                            <option value="">-- 选择终端档案文件 --</option>
                                                            {remoteProfiles.map((p) => (
                                                                <option key={p.fileName} value={p.fileName}>
                                                                    {p.fileName}{p.isActive ? " — 当前使用" : ""}
                                                                </option>
                                                            ))}
                                                        </Select>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !selectedRemoteProfile || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("profile.switch", {
                                                                    fileName: selectedRemoteProfile,
                                                                })
                                                            }
                                                        >
                                                            热切换活动档案
                                                        </Button>
                                                    </div>

                                                    {remoteProfiles.length > 0 && (
                                                        <div className="table-container mb-12" style={{ maxHeight: 180, overflowY: "auto" }}>
                                                            <table className="data-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>档案文件名</th>
                                                                        <th>状态</th>
                                                                        <th>科目 / 时间表 / 课表数</th>
                                                                        <th>快捷操作</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {remoteProfiles.map((p) => (
                                                                        <tr key={p.fileName}>
                                                                            <td>{p.fileName}</td>
                                                                            <td>
                                                                                <span className={`badge ${p.isActive ? "badge-success" : "badge-info"}`}>
                                                                                    {p.isActive ? "当前使用" : "备用档案"}
                                                                                </span>
                                                                            </td>
                                                                            <td>
                                                                                {p.subjectCount ?? "-"} / {p.timeLayoutCount ?? "-"} / {p.classPlanCount ?? "-"}
                                                                            </td>
                                                                            <td>
                                                                                <div className="flex gap-4">
                                                                                    <Button
                                                                                        size="small"
                                                                                        appearance="secondary"
                                                                                        disabled={extendBusy}
                                                                                        onClick={() => {
                                                                                            setProfileEditName(p.fileName);
                                                                                            dispatchAndPollExtendCommand(
                                                                                                "profile.get",
                                                                                                { fileName: p.fileName },
                                                                                                (res) => {
                                                                                                    if (res && typeof res === "object" && "profile" in res) {
                                                                                                        setProfileEditContent(
                                                                                                            JSON.stringify((res as { profile: unknown }).profile, null, 2)
                                                                                                        );
                                                                                                    }
                                                                                                }
                                                                                            );
                                                                                        }}
                                                                                    >
                                                                                        读取
                                                                                    </Button>
                                                                                    {!p.isActive && (
                                                                                        <Button
                                                                                            size="small"
                                                                                            appearance="primary"
                                                                                            disabled={extendBusy}
                                                                                            onClick={() =>
                                                                                                dispatchAndPollExtendCommand("profile.switch", {
                                                                                                    fileName: p.fileName,
                                                                                                })
                                                                                            }
                                                                                        >
                                                                                            激活
                                                                                        </Button>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}

                                                    <div className="flex items-center gap-8 mb-12" style={{ flexWrap: "wrap" }}>
                                                        <Select
                                                            size="small"
                                                            value={tempClassPlanMode}
                                                            onChange={(_, d) => setTempClassPlanMode(d.value as typeof tempClassPlanMode)}
                                                        >
                                                            <option value="set">设置当日临时课表</option>
                                                            <option value="overlay">创建临时课表覆盖层</option>
                                                            <option value="group">临时启用课表群</option>
                                                            <option value="clear">清除临时课表与覆盖层</option>
                                                        </Select>
                                                        {tempClassPlanMode !== "clear" && (
                                                            <Input
                                                                size="small"
                                                                value={tempClassPlanId}
                                                                onChange={(_, d) => setTempClassPlanId(d.value)}
                                                                placeholder="输入课表或课表群标识码"
                                                                style={{ width: 220 }}
                                                            />
                                                        )}
                                                        {tempClassPlanMode === "overlay" && (
                                                            <Input
                                                                size="small"
                                                                value={tempTimeLayoutId}
                                                                onChange={(_, d) => setTempTimeLayoutId(d.value)}
                                                                placeholder="可选：指定时间表标识码"
                                                                style={{ width: 200 }}
                                                            />
                                                        )}
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={
                                                                extendBusy ||
                                                                activeClient.status !== "online" ||
                                                                (tempClassPlanMode !== "clear" && !tempClassPlanId.trim())
                                                            }
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("profile.temp_classplan", {
                                                                    mode: tempClassPlanMode,
                                                                    classPlanId: tempClassPlanId.trim() || undefined,
                                                                    timeLayoutId: tempTimeLayoutId.trim() || undefined,
                                                                })
                                                            }
                                                        >
                                                            执行临时课表指令
                                                        </Button>
                                                    </div>

                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Input
                                                            size="small"
                                                            value={profileEditName}
                                                            onChange={(_, d) => setProfileEditName(d.value)}
                                                            placeholder="档案文件名，如 Default.json"
                                                            style={{ width: 200 }}
                                                        />
                                                        <Switch
                                                            checked={profileActivateOnSave}
                                                            onChange={(_, d) => setProfileActivateOnSave(d.checked)}
                                                            label="保存后立即激活"
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !profileEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand(
                                                                    "profile.get",
                                                                    { fileName: profileEditName.trim() },
                                                                    (res) => {
                                                                        if (res && typeof res === "object") {
                                                                            const c = "profile" in res
                                                                                ? (res as { profile: unknown }).profile
                                                                                : "content" in res
                                                                                ? (res as { content: unknown }).content
                                                                                : res;
                                                                            setProfileEditContent(
                                                                                typeof c === "string" ? c : JSON.stringify(c, null, 2)
                                                                            );
                                                                        }
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            读取档案内容
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !profileEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                try {
                                                                    const parsed = JSON.parse(profileEditContent);
                                                                    dispatchAndPollExtendCommand("profile.put", {
                                                                        fileName: profileEditName.trim(),
                                                                        profile: parsed,
                                                                        activate: profileActivateOnSave,
                                                                    });
                                                                } catch {
                                                                    setMsg({ type: "error", text: "档案内容不是有效的 JSON 对象" });
                                                                }
                                                            }}
                                                        >
                                                            保存整套档案
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !profileEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                try {
                                                                    const parsed = JSON.parse(profileEditContent) as Record<string, unknown>;
                                                                    dispatchAndPollExtendCommand("profile.patch", {
                                                                        fileName: profileEditName.trim(),
                                                                        ...parsed,
                                                                    });
                                                                } catch {
                                                                    setMsg({ type: "error", text: "修订内容不是有效的 JSON 对象" });
                                                                }
                                                            }}
                                                        >
                                                            运行时增量更新档案
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            style={{ color: "var(--danger-color)" }}
                                                            disabled={extendBusy || !profileEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("profile.delete", {
                                                                    fileName: profileEditName.trim(),
                                                                })
                                                            }
                                                        >
                                                            删除档案文件
                                                        </Button>
                                                    </div>
                                                    <Textarea
                                                        value={profileEditContent}
                                                        onChange={(_, d) => setProfileEditContent(d.value)}
                                                        rows={4}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>

                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">组件布局配置热更新</div>
                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("profile.components.list", {}, (res) => {
                                                                    if (res && typeof res === "object" && "configs" in res) {
                                                                        const list = (res as { configs?: string[]; currentComponentConfig?: string }).configs || [];
                                                                        setRemoteComponentConfigs(list);
                                                                        const cur = (res as { currentComponentConfig?: string }).currentComponentConfig;
                                                                        if (cur) setSelectedComponentConfig(cur);
                                                                    }
                                                                })
                                                            }
                                                        >
                                                            获取组件布局列表
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("profile.components.reload", {})}
                                                        >
                                                            立即热重载组件布局
                                                        </Button>
                                                        <Select
                                                            size="small"
                                                            value={selectedComponentConfig}
                                                            onChange={(_, d) => setSelectedComponentConfig(d.value)}
                                                        >
                                                            <option value="Default">Default</option>
                                                            {remoteComponentConfigs
                                                                .filter((c) => c !== "Default")
                                                                .map((c) => (
                                                                    <option key={c} value={c}>{c}</option>
                                                                ))}
                                                        </Select>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !selectedComponentConfig || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("profile.components.switch", {
                                                                    configName: selectedComponentConfig,
                                                                })
                                                            }
                                                        >
                                                            热切换组件布局
                                                        </Button>
                                                    </div>
                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Input
                                                            size="small"
                                                            value={componentConfigEditName}
                                                            onChange={(_, d) => setComponentConfigEditName(d.value)}
                                                            placeholder="组件布局方案名，如 Default"
                                                            style={{ width: 200 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !componentConfigEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand(
                                                                    "profile.components.get",
                                                                    { configName: componentConfigEditName.trim() },
                                                                    (res) => {
                                                                        if (res && typeof res === "object" && "components" in res) {
                                                                            setComponentConfigEditContent(
                                                                                JSON.stringify((res as { components: unknown }).components, null, 2)
                                                                            );
                                                                        }
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            读取组件布局
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !componentConfigEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                try {
                                                                    const parsed = JSON.parse(componentConfigEditContent);
                                                                    dispatchAndPollExtendCommand("profile.components.put", {
                                                                        configName: componentConfigEditName.trim(),
                                                                        components: parsed,
                                                                        activate: true,
                                                                    });
                                                                } catch {
                                                                    setMsg({ type: "error", text: "组件布局内容不是有效的 JSON 对象" });
                                                                }
                                                            }}
                                                        >
                                                            热更新组件布局配置
                                                        </Button>
                                                    </div>
                                                    <Textarea
                                                        value={componentConfigEditContent}
                                                        onChange={(_, d) => setComponentConfigEditContent(d.value)}
                                                        rows={3}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* 子面板 3: 扩展运维管理 */}
                                        {extendSubTab === "ops" && (
                                            <div>
                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">自动化配置管理</div>
                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("automation.list", {}, (res) => {
                                                                    if (res && typeof res === "object" && "configs" in res) {
                                                                        const list = (res as { configs?: string[]; currentConfig?: string; isAutomationEnabled?: boolean }).configs || [];
                                                                        setRemoteAutomations(list);
                                                                        const cur = (res as { currentConfig?: string }).currentConfig;
                                                                        if (cur) {
                                                                            setSelectedAutomation(cur);
                                                                        } else if (list.length > 0 && !selectedAutomation) {
                                                                            setSelectedAutomation(list[0]);
                                                                        }
                                                                        if ("isAutomationEnabled" in res) {
                                                                            setAutomationEnabled(Boolean((res as { isAutomationEnabled?: boolean }).isAutomationEnabled));
                                                                        }
                                                                    }
                                                                })
                                                            }
                                                        >
                                                            获取自动化列表
                                                        </Button>
                                                        <Select
                                                            size="small"
                                                            value={selectedAutomation}
                                                            onChange={(_, d) => setSelectedAutomation(d.value)}
                                                        >
                                                            <option value="">-- 选择自动化配置 --</option>
                                                            {remoteAutomations.map((a) => (
                                                                <option key={a} value={a}>{a}</option>
                                                            ))}
                                                        </Select>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !selectedAutomation || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("automation.switch", {
                                                                    configName: selectedAutomation,
                                                                })
                                                            }
                                                        >
                                                            切换活动自动化配置
                                                        </Button>
                                                        <Switch
                                                            checked={automationEnabled}
                                                            onChange={(_, d) => setAutomationEnabled(d.checked)}
                                                            label="启用自动化总开关"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Input
                                                            size="small"
                                                            value={automationEditName}
                                                            onChange={(_, d) => setAutomationEditName(d.value)}
                                                            placeholder="配置名称，如 Default"
                                                            style={{ width: 220 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !automationEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand(
                                                                    "automation.get",
                                                                    { configName: automationEditName.trim() },
                                                                    (res) => {
                                                                        if (res && typeof res === "object") {
                                                                            const wf = "workflows" in res
                                                                                ? (res as { workflows: unknown }).workflows
                                                                                : "content" in res
                                                                                ? (res as { content: unknown }).content
                                                                                : res;
                                                                            setAutomationEditContent(
                                                                                typeof wf === "string" ? wf : JSON.stringify(wf, null, 2)
                                                                            );
                                                                        }
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            读取自动化工作流
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !automationEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                try {
                                                                    const parsed = JSON.parse(automationEditContent);
                                                                    dispatchAndPollExtendCommand("automation.put", {
                                                                        configName: automationEditName.trim(),
                                                                        workflows: Array.isArray(parsed) ? parsed : [],
                                                                        isAutomationEnabled: automationEnabled,
                                                                    });
                                                                } catch {
                                                                    setMsg({ type: "error", text: "自动化工作流必须是有效的 JSON 数组" });
                                                                }
                                                            }}
                                                        >
                                                            保存自动化工作流
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            style={{ color: "var(--danger-color)" }}
                                                            disabled={extendBusy || !automationEditName.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("automation.delete", {
                                                                    configName: automationEditName.trim(),
                                                                })
                                                            }
                                                        >
                                                            删除自动化配置
                                                        </Button>
                                                    </div>
                                                    <Textarea
                                                        value={automationEditContent}
                                                        onChange={(_, d) => setAutomationEditContent(d.value)}
                                                        rows={3}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>

                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">客户端更新服务控制</div>
                                                    <div className="flex items-center gap-8 mb-12" style={{ flexWrap: "wrap" }}>
                                                        <Select
                                                            size="small"
                                                            value={String(updateMode)}
                                                            onChange={(_, d) => setUpdateMode(Number(d.value))}
                                                        >
                                                            <option value="0">从不自动更新</option>
                                                            <option value="1">自动检查更新</option>
                                                            <option value="2">自动检查并提示</option>
                                                            <option value="3">自动下载更新</option>
                                                        </Select>
                                                        <Input
                                                            size="small"
                                                            value={updateChannel}
                                                            onChange={(_, d) => setUpdateChannel(d.value)}
                                                            placeholder="更新通道"
                                                            style={{ width: 160 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("update.configure", {
                                                                    updateMode,
                                                                    channel: updateChannel,
                                                                })
                                                            }
                                                        >
                                                            保存更新配置
                                                        </Button>
                                                    </div>
                                                    <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.get_status", {})}
                                                        >
                                                            查询更新状态
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.action", { operation: "check" })}
                                                        >
                                                            立即检查更新
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.action", { operation: "download" })}
                                                        >
                                                            下载可用更新
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.action", { operation: "check_and_download" })}
                                                        >
                                                            检查并下载更新
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.action", { operation: "extract" })}
                                                        >
                                                            部署更新包
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.action", { operation: "stop" })}
                                                        >
                                                            停止下载
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("update.action", { operation: "restart_to_update" })}
                                                        >
                                                            重启并应用更新
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">客户端插件与主题管理</div>
                                                    <div className="flex items-center gap-8 mb-12" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("plugin.list", {}, (res) => {
                                                                    if (res && typeof res === "object" && "plugins" in res) {
                                                                        setPluginList((res as { plugins?: InstalledPluginSummary[] }).plugins || []);
                                                                    }
                                                                })
                                                            }
                                                        >
                                                            查询插件列表
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("plugin.refresh_market", {})}
                                                        >
                                                            刷新插件市场
                                                        </Button>
                                                        <Input
                                                            size="small"
                                                            value={pluginTargetId}
                                                            onChange={(_, d) => setPluginTargetId(d.value)}
                                                            placeholder="输入插件标识码"
                                                            style={{ width: 200 }}
                                                        />
                                                        <Input
                                                            size="small"
                                                            value={pluginPackageUrl}
                                                            onChange={(_, d) => setPluginPackageUrl(d.value)}
                                                            placeholder="可选：插件包下载链接"
                                                            style={{ width: 200 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={
                                                                extendBusy ||
                                                                (!pluginTargetId.trim() && !pluginPackageUrl.trim()) ||
                                                                activeClient.status !== "online"
                                                            }
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("plugin.install", {
                                                                    pluginId: pluginTargetId.trim() || undefined,
                                                                    packageUrl: pluginPackageUrl.trim() || undefined,
                                                                })
                                                            }
                                                        >
                                                            安装插件
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !pluginTargetId.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("plugin.set_enabled", {
                                                                    pluginId: pluginTargetId.trim(),
                                                                    enabled: true,
                                                                })
                                                            }
                                                        >
                                                            启用插件
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !pluginTargetId.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("plugin.set_enabled", {
                                                                    pluginId: pluginTargetId.trim(),
                                                                    enabled: false,
                                                                })
                                                            }
                                                        >
                                                            禁用插件
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            style={{ color: "var(--danger-color)" }}
                                                            disabled={extendBusy || !pluginTargetId.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("plugin.uninstall", {
                                                                    pluginId: pluginTargetId.trim(),
                                                                    uninstall: true,
                                                                })
                                                            }
                                                        >
                                                            卸载插件
                                                        </Button>
                                                    </div>

                                                    {pluginList.length > 0 && (
                                                        <div className="table-container mb-12" style={{ maxHeight: 160, overflowY: "auto" }}>
                                                            <table className="data-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>插件名称</th>
                                                                        <th>插件标识</th>
                                                                        <th>版本</th>
                                                                        <th>状态</th>
                                                                        <th>操作</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {pluginList.map((plg) => (
                                                                        <tr key={plg.id}>
                                                                            <td>{plg.name || plg.id}</td>
                                                                            <td style={{ fontSize: 12 }}>{plg.id}</td>
                                                                            <td>{plg.version || "-"}</td>
                                                                            <td>
                                                                                <span className={`badge ${plg.isEnabled ? "badge-success" : "badge-warning"}`}>
                                                                                    {plg.isEnabled ? "已启用" : "已禁用"}
                                                                                </span>
                                                                            </td>
                                                                            <td>
                                                                                <div className="flex gap-4">
                                                                                    <Button
                                                                                        size="small"
                                                                                        appearance="secondary"
                                                                                        disabled={extendBusy}
                                                                                        onClick={() =>
                                                                                            dispatchAndPollExtendCommand("plugin.set_enabled", {
                                                                                                pluginId: plg.id,
                                                                                                enabled: !plg.isEnabled,
                                                                                            })
                                                                                        }
                                                                                    >
                                                                                        {plg.isEnabled ? "禁用" : "启用"}
                                                                                    </Button>
                                                                                    <Button
                                                                                        size="small"
                                                                                        appearance="subtle"
                                                                                        style={{ color: "var(--danger-color)" }}
                                                                                        disabled={extendBusy}
                                                                                        onClick={() =>
                                                                                            dispatchAndPollExtendCommand("plugin.uninstall", {
                                                                                                pluginId: plg.id,
                                                                                                uninstall: true,
                                                                                            })
                                                                                        }
                                                                                    >
                                                                                        卸载
                                                                                    </Button>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}

                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("theme.list", {}, (res) => {
                                                                    if (res && typeof res === "object" && "themes" in res) {
                                                                        setThemeList((res as { themes?: InstalledThemeSummary[] }).themes || []);
                                                                    }
                                                                })
                                                            }
                                                        >
                                                            查询主题列表
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() => dispatchAndPollExtendCommand("theme.reload", {})}
                                                        >
                                                            重载全部主题
                                                        </Button>
                                                        <Input
                                                            size="small"
                                                            value={themeTargetId}
                                                            onChange={(_, d) => setThemeTargetId(d.value)}
                                                            placeholder="输入主题标识码或下载链接"
                                                            style={{ width: 220 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || !themeTargetId.trim() || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                const val = themeTargetId.trim();
                                                                const isUrl = val.startsWith("http://") || val.startsWith("https://");
                                                                dispatchAndPollExtendCommand(
                                                                    "theme.install",
                                                                    isUrl ? { packageUrl: val, enable: true } : { themeId: val, enable: true }
                                                                );
                                                            }}
                                                        >
                                                            安装并启用主题
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || !themeTargetId.trim() || activeClient.status !== "online"}
                                                            onClick={() => {
                                                                const ids = themeTargetId
                                                                    .split(",")
                                                                    .map((s) => s.trim())
                                                                    .filter(Boolean);
                                                                dispatchAndPollExtendCommand("theme.set_enabled", {
                                                                    enabledThemes: ids,
                                                                });
                                                            }}
                                                        >
                                                            设置启用主题列表
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            style={{ color: "var(--danger-color)" }}
                                                            disabled={extendBusy || !themeTargetId.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("theme.uninstall", {
                                                                    themeId: themeTargetId.trim(),
                                                                })
                                                            }
                                                        >
                                                            卸载主题
                                                        </Button>
                                                    </div>

                                                    <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                                        <Select
                                                            size="small"
                                                            value={String(themeAppearanceMode)}
                                                            onChange={(_, d) => setThemeAppearanceMode(Number(d.value))}
                                                        >
                                                            <option value="0">跟随系统外观</option>
                                                            <option value="1">浅色外观</option>
                                                            <option value="2">深色外观</option>
                                                        </Select>
                                                        <Select
                                                            size="small"
                                                            value={String(themeColorSource)}
                                                            onChange={(_, d) => setThemeColorSource(Number(d.value))}
                                                        >
                                                            <option value="0">自定义主题色</option>
                                                            <option value="1">跟随系统壁纸主题色</option>
                                                            <option value="2">跟随系统强调色</option>
                                                        </Select>
                                                        <Button
                                                            size="small"
                                                            appearance="secondary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("theme.set_appearance", {
                                                                    themeMode: themeAppearanceMode,
                                                                    colorSource: themeColorSource,
                                                                })
                                                            }
                                                        >
                                                            应用外观与色彩方案
                                                        </Button>
                                                    </div>

                                                    {themeList.length > 0 && (
                                                        <div className="table-container mt-8" style={{ maxHeight: 150, overflowY: "auto" }}>
                                                            <table className="data-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>主题名称</th>
                                                                        <th>主题标识</th>
                                                                        <th>状态</th>
                                                                        <th>操作</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {themeList.map((thm) => (
                                                                        <tr key={thm.id}>
                                                                            <td>{thm.name || thm.id}</td>
                                                                            <td style={{ fontSize: 12 }}>{thm.id}</td>
                                                                            <td>
                                                                                <span className={`badge ${thm.isEnabled ? "badge-success" : "badge-info"}`}>
                                                                                    {thm.isEnabled ? "已启用" : "未启用"}
                                                                                </span>
                                                                            </td>
                                                                            <td>
                                                                                <div className="flex gap-4">
                                                                                    <Button
                                                                                        size="small"
                                                                                        appearance="secondary"
                                                                                        disabled={extendBusy}
                                                                                        onClick={() =>
                                                                                            dispatchAndPollExtendCommand("theme.set_enabled", {
                                                                                                enabledThemes: thm.isEnabled
                                                                                                    ? themeList.filter((t) => t.isEnabled && t.id !== thm.id).map((t) => t.id)
                                                                                                    : [...themeList.filter((t) => t.isEnabled).map((t) => t.id), thm.id],
                                                                                            })
                                                                                        }
                                                                                    >
                                                                                        {thm.isEnabled ? "停用" : "启用"}
                                                                                    </Button>
                                                                                    <Button
                                                                                        size="small"
                                                                                        appearance="subtle"
                                                                                        style={{ color: "var(--danger-color)" }}
                                                                                        disabled={extendBusy}
                                                                                        onClick={() =>
                                                                                            dispatchAndPollExtendCommand("theme.uninstall", {
                                                                                                themeId: thm.id,
                                                                                            })
                                                                                        }
                                                                                    >
                                                                                        卸载
                                                                                    </Button>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* 子面板 4: 远程协助 */}
                                        {extendSubTab === "remote" && (
                                            <div>
                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">远程桌面画面与模拟点击控制</div>
                                                    <div className="flex items-center justify-between mb-12" style={{ flexWrap: "wrap", gap: 8 }}>
                                                        <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                                            <Input
                                                                size="small"
                                                                type="number"
                                                                value={String(screenshotDisplayIndex)}
                                                                onChange={(_, d) => setScreenshotDisplayIndex(Math.max(0, Number(d.value) || 0))}
                                                                style={{ width: 90 }}
                                                                placeholder="屏幕序号"
                                                            />
                                                            <Select
                                                                size="small"
                                                                value={String(screenshotScale)}
                                                                onChange={(_, d) => setScreenshotScale(Number(d.value) || 0.75)}
                                                            >
                                                                <option value="0.5">缩放比例 50%</option>
                                                                <option value="0.75">缩放比例 75%</option>
                                                                <option value="1">原始分辨率 100%</option>
                                                            </Select>
                                                            <Button
                                                                size="small"
                                                                appearance="primary"
                                                                icon={<Eye24Regular />}
                                                                disabled={extendBusy || activeClient.status !== "online"}
                                                                onClick={() =>
                                                                    dispatchAndPollExtendCommand(
                                                                        "remote.screenshot",
                                                                        { displayIndex: screenshotDisplayIndex, scale: screenshotScale },
                                                                        (res) => {
                                                                            if (res && typeof res === "object" && "imageBase64" in res) {
                                                                                const r = res as { imageBase64?: string; mimeType?: string };
                                                                                setScreenshotBase64(r.imageBase64 || "");
                                                                                setScreenshotMime(r.mimeType || "image/jpeg");
                                                                                setScreenshotTime(new Date().toLocaleTimeString("zh-CN"));
                                                                            }
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                捕获屏幕画面
                                                            </Button>
                                                            <Select
                                                                size="small"
                                                                value={clickButtonType}
                                                                onChange={(_, d) => setClickButtonType(d.value as typeof clickButtonType)}
                                                            >
                                                                <option value="left">鼠标左键</option>
                                                                <option value="right">鼠标右键</option>
                                                                <option value="middle">鼠标中键</option>
                                                            </Select>
                                                            <Select
                                                                size="small"
                                                                value={clickModeType}
                                                                onChange={(_, d) => setClickModeType(d.value as typeof clickModeType)}
                                                            >
                                                                <option value="single">单击触发</option>
                                                                <option value="double">双击触发</option>
                                                                <option value="down">按下鼠标</option>
                                                                <option value="up">抬起鼠标</option>
                                                                <option value="move">仅移动光标</option>
                                                            </Select>
                                                        </div>
                                                        <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                                            <Input
                                                                size="small"
                                                                type="number"
                                                                value={String(manualClickX)}
                                                                onChange={(_, d) => setManualClickX(Number(d.value) || 0)}
                                                                style={{ width: 90 }}
                                                                placeholder="横坐标"
                                                            />
                                                            <Input
                                                                size="small"
                                                                type="number"
                                                                value={String(manualClickY)}
                                                                onChange={(_, d) => setManualClickY(Number(d.value) || 0)}
                                                                style={{ width: 90 }}
                                                                placeholder="纵坐标"
                                                            />
                                                            <Button
                                                                size="small"
                                                                appearance="secondary"
                                                                disabled={extendBusy || activeClient.status !== "online"}
                                                                onClick={() =>
                                                                    dispatchAndPollExtendCommand("remote.simulate_click", {
                                                                        x: manualClickX,
                                                                        y: manualClickY,
                                                                        button: clickButtonType,
                                                                        clickType: clickModeType,
                                                                    })
                                                                }
                                                            >
                                                                发送坐标点击
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    {screenshotTime && (
                                                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                                                            捕获时间：{screenshotTime}，直接点击下方画面即可向对应位置发送模拟点击指令
                                                        </div>
                                                    )}
                                                    {screenshotBase64 && (
                                                        <div style={{ textAlign: "center", overflow: "auto" }}>
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={`data:${screenshotMime};base64,${screenshotBase64}`}
                                                                alt="远程终端画面"
                                                                onClick={handleScreenshotClick}
                                                                style={{
                                                                    maxWidth: "100%",
                                                                    maxHeight: 360,
                                                                    borderRadius: 8,
                                                                    border: "1px solid var(--border-color)",
                                                                    cursor: "crosshair",
                                                                }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">终端运行进程清单</div>
                                                    <div className="flex items-center gap-8 mb-12" style={{ flexWrap: "wrap" }}>
                                                        <Input
                                                            size="small"
                                                            value={processKeyword}
                                                            onChange={(_, d) => setProcessKeyword(d.value)}
                                                            placeholder="按进程名称或窗口标题筛选..."
                                                            style={{ width: 240 }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            disabled={extendBusy || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand(
                                                                    "remote.process_list",
                                                                    { keyword: processKeyword.trim() },
                                                                    (res) => {
                                                                        if (res && typeof res === "object" && "processes" in res) {
                                                                            setProcessList(
                                                                                ((res as { processes?: ProcessItem[] }).processes || []).slice(0, 150)
                                                                            );
                                                                        }
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            获取进程清单
                                                        </Button>
                                                    </div>
                                                    {processList.length > 0 && (
                                                        <div className="table-container" style={{ maxHeight: 200, overflowY: "auto" }}>
                                                            <table className="data-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>进程编号</th>
                                                                        <th>进程名称</th>
                                                                        <th>窗口标题</th>
                                                                        <th>内存占用</th>
                                                                        <th>响应状态</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {processList.map((proc, idx) => {
                                                                        const memMb =
                                                                            proc.workingSetBytes !== undefined
                                                                                ? Math.round(proc.workingSetBytes / (1024 * 1024))
                                                                                : proc.memoryMB ?? 0;
                                                                        return (
                                                                            <tr key={`${proc.pid}-${idx}`}>
                                                                                <td>{proc.pid}</td>
                                                                                <td>{proc.name || "-"}</td>
                                                                                <td>{proc.mainWindowTitle || proc.windowTitle || "-"}</td>
                                                                                <td>{memMb} MB</td>
                                                                                <td>{proc.responding === false ? "无响应" : "正常"}</td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                                    <div className="card-title">远程命令执行</div>
                                                    <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
                                                        <Select
                                                            size="small"
                                                            value={execShell}
                                                            onChange={(_, d) => setExecShell(d.value as typeof execShell)}
                                                        >
                                                            <option value="powershell">PowerShell</option>
                                                            <option value="pwsh">PowerShell Core</option>
                                                            <option value="cmd">命令提示符</option>
                                                            <option value="bash">Bash</option>
                                                            <option value="sh">Shell</option>
                                                        </Select>
                                                        <Input
                                                            size="small"
                                                            value={execWorkingDir}
                                                            onChange={(_, d) => setExecWorkingDir(d.value)}
                                                            placeholder="可选：工作目录"
                                                            style={{ width: 180 }}
                                                        />
                                                        <Input
                                                            size="small"
                                                            type="number"
                                                            value={String(execTimeoutSeconds)}
                                                            onChange={(_, d) => setExecTimeoutSeconds(Number(d.value) || 15)}
                                                            style={{ width: 100 }}
                                                        />
                                                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>超时秒数</span>
                                                        <Button
                                                            size="small"
                                                            appearance="primary"
                                                            icon={<Play24Regular />}
                                                            disabled={extendBusy || !execCommandText.trim() || activeClient.status !== "online"}
                                                            onClick={() =>
                                                                dispatchAndPollExtendCommand("remote.exec_code", {
                                                                    shell: execShell,
                                                                    command: execCommandText,
                                                                    workingDirectory: execWorkingDir.trim() || undefined,
                                                                    timeoutSeconds: execTimeoutSeconds,
                                                                })
                                                            }
                                                        >
                                                            执行命令
                                                        </Button>
                                                    </div>
                                                    <Textarea
                                                        value={execCommandText}
                                                        onChange={(_, d) => setExecCommandText(d.value)}
                                                        placeholder="输入要在终端执行的命令脚本..."
                                                        rows={3}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {extendResultText && (
                                            <div className="json-editor">
                                                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                                                    终端执行回传结果
                                                </div>
                                                <textarea
                                                    readOnly
                                                    value={extendResultText}
                                                    style={{ minHeight: 160 }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tab 4: 远程配置抓取 */}
                                {activeTab === "snapshots" && (
                                    <div>
                                        <div className="flex items-center justify-between mb-16" style={{ gap: 12 }}>
                                            <div className="flex items-center gap-8">
                                                <Select
                                                    value={String(requestingConfigType)}
                                                    onChange={(_, d) => setRequestingConfigType(Number(d.value))}
                                                >
                                                    {Object.entries(CONFIG_TYPE_LABELS).map(([k, label]) => (
                                                        <option key={k} value={k}>{label}</option>
                                                    ))}
                                                </Select>
                                                <Button
                                                    appearance="primary"
                                                    icon={<CloudArrowDown24Regular />}
                                                    onClick={handleRequestSnapshot}
                                                    disabled={snapshotsLoading || activeClient.status !== "online"}
                                                >
                                                    请求终端上报
                                                </Button>
                                            </div>
                                            <Button
                                                appearance="secondary"
                                                icon={<ArrowSync24Regular />}
                                                onClick={() => loadSnapshots(activeClient.uid)}
                                                disabled={snapshotsLoading}
                                            >
                                                刷新上报列表
                                            </Button>
                                        </div>

                                        {snapshotsLoading ? (
                                            <div className="empty-state"><Spinner size="small" /></div>
                                        ) : snapshots.length === 0 ? (
                                            <div className="empty-state" style={{ padding: 24 }}>
                                                <div className="empty-state-text">暂无配置上报记录</div>
                                            </div>
                                        ) : (
                                            <div className="table-container mb-16">
                                                <table className="data-table">
                                                    <thead>
                                                        <tr>
                                                            <th>配置类型</th>
                                                            <th>状态</th>
                                                            <th>上报时间</th>
                                                            <th>操作</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {snapshots.map((s) => (
                                                            <tr key={s.request_guid}>
                                                                <td>{CONFIG_TYPE_LABELS[s.config_type] || s.config_type_name}</td>
                                                                <td>
                                                                    <span className={`badge ${s.status === "completed" ? "badge-success" : "badge-warning"}`}>
                                                                        {s.status === "completed" ? "已上报" : "等待客户端响应"}
                                                                    </span>
                                                                </td>
                                                                <td style={{ fontSize: 12 }}>
                                                                    {s.uploaded_at ? new Date(s.uploaded_at).toLocaleString("zh-CN") : "-"}
                                                                </td>
                                                                <td>
                                                                    <Button
                                                                        size="small"
                                                                        appearance="subtle"
                                                                        icon={<DocumentSearch24Regular />}
                                                                        disabled={s.status !== "completed"}
                                                                        onClick={() => handleViewSnapshotDetail(s.request_guid)}
                                                                    >
                                                                        查看内容
                                                                    </Button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {activeSnapshot && (
                                            <div className="json-editor">
                                                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                                                    快照详情 — {CONFIG_TYPE_LABELS[activeSnapshot.config_type] || activeSnapshot.config_type_name}
                                                </div>
                                                <textarea
                                                    readOnly
                                                    value={
                                                        activeSnapshot.parsed_payload
                                                            ? JSON.stringify(activeSnapshot.parsed_payload, null, 2)
                                                            : activeSnapshot.payload || ""
                                                    }
                                                    style={{ minHeight: 220 }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tab 5: 设备审计日志 */}
                                {activeTab === "audit" && (
                                    <div>
                                        <div className="flex justify-between items-center mb-16">
                                            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                                展示该终端实时上报的敏感行为与运行事件。
                                            </span>
                                            <Button
                                                size="small"
                                                appearance="secondary"
                                                icon={<ArrowSync24Regular />}
                                                onClick={() => loadDeviceAudits(activeClient.uid)}
                                            >
                                                刷新日志
                                            </Button>
                                        </div>

                                        {auditsLoading ? (
                                            <div className="empty-state"><Spinner size="small" /></div>
                                        ) : deviceAudits.length === 0 ? (
                                            <div className="empty-state" style={{ padding: 24 }}>
                                                <div className="empty-state-text">暂无该设备的审计日志</div>
                                            </div>
                                        ) : (
                                            <div className="table-container">
                                                <table className="data-table">
                                                    <thead>
                                                        <tr>
                                                            <th>事件类型</th>
                                                            <th>事件详情</th>
                                                            <th>上报时间</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {deviceAudits.map((log) => (
                                                            <tr key={log.id}>
                                                                <td>
                                                                    <span className="badge badge-info">
                                                                        {AUDIT_EVENT_LABELS[log.event_type] || log.event_name}
                                                                    </span>
                                                                </td>
                                                                <td style={{ fontSize: 12 }}>
                                                                    {Object.keys(log.decoded || {}).length > 0
                                                                        ? JSON.stringify(log.decoded)
                                                                        : "-"}
                                                                </td>
                                                                <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                                                    {log.logged_at ? new Date(log.logged_at).toLocaleString("zh-CN") : "-"}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Tab 6: 推送桌面通知 */}
                                {activeTab === "notify" && (
                                    <div>
                                        <div className="grid-2">
                                            <div className="form-group">
                                                <label className="form-label">遮罩标题</label>
                                                <Input
                                                    value={notifyForm.MessageMask || ""}
                                                    onChange={(_, d) => setNotifyForm({ ...notifyForm, MessageMask: d.value })}
                                                    style={{ width: "100%" }}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">持续秒数</label>
                                                <Input
                                                    type="number"
                                                    value={String(notifyForm.DurationSeconds || 5)}
                                                    onChange={(_, d) =>
                                                        setNotifyForm({ ...notifyForm, DurationSeconds: parseFloat(d.value) || 5 })
                                                    }
                                                    style={{ width: "100%" }}
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">通知正文</label>
                                            <Textarea
                                                value={notifyForm.MessageContent || ""}
                                                onChange={(_, d) => setNotifyForm({ ...notifyForm, MessageContent: d.value })}
                                                style={{ width: "100%" }}
                                                rows={3}
                                            />
                                        </div>
                                        <div className="flex gap-16 mb-16" style={{ flexWrap: "wrap" }}>
                                            <Switch
                                                checked={notifyForm.IsEmergency || false}
                                                onChange={(_, d) => setNotifyForm({ ...notifyForm, IsEmergency: d.checked })}
                                                label="紧急通知"
                                            />
                                            <Switch
                                                checked={notifyForm.IsSpeechEnabled || false}
                                                onChange={(_, d) => setNotifyForm({ ...notifyForm, IsSpeechEnabled: d.checked })}
                                                label="语音播报"
                                            />
                                            <Switch
                                                checked={notifyForm.IsSoundEnabled || false}
                                                onChange={(_, d) => setNotifyForm({ ...notifyForm, IsSoundEnabled: d.checked })}
                                                label="提示音效"
                                            />
                                            <Switch
                                                checked={notifyForm.IsEffectEnabled || false}
                                                onChange={(_, d) => setNotifyForm({ ...notifyForm, IsEffectEnabled: d.checked })}
                                                label="全屏波纹特效"
                                            />
                                            <Switch
                                                checked={notifyForm.IsTopmost || false}
                                                onChange={(_, d) => setNotifyForm({ ...notifyForm, IsTopmost: d.checked })}
                                                label="置顶显示"
                                            />
                                        </div>
                                        <Button
                                            appearance="primary"
                                            icon={<Send24Regular />}
                                            onClick={handleSendNotification}
                                            disabled={savingDevice || activeClient.status !== "online"}
                                        >
                                            {savingDevice ? <Spinner size="tiny" /> : "立即发送通知"}
                                        </Button>
                                    </div>
                                )}
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setActiveClient(null)}>关闭</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
