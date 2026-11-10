"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clients, data, audit } from "@/lib/api";
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
    AUDIT_EVENT_LABELS,
} from "@/lib/types";
import {
    Button, Input, Spinner, Dialog, DialogSurface, DialogBody,
    DialogTitle, DialogContent, DialogActions,
    Switch, Textarea,
    Popover, PopoverTrigger, PopoverSurface,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import { Select } from "@/components/CustomSelect";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import {
    ArrowSync24Regular,
    Settings24Regular,
    DocumentSearch24Regular,
    CursorClick24Regular,
    Info16Regular, Settings16Regular, ShieldTask16Regular,
    Clock16Regular, Book16Regular, Apps16Regular,
    Board16Regular, ArrowUp16Regular, QuestionCircle16Regular,
    Image16Regular, ArrowDownload16Regular, ArrowClockwise16Regular,
    Filter16Regular, ChevronLeft16Regular, ChevronRight16Regular,
    Dismiss16Regular, LockClosed16Regular, LockOpen16Regular,
} from "@fluentui/react-icons";

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

function wildcardToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
}

function matchesClientSearch(c: ClientDeviceOut, rawQuery: string): boolean {
    const trimmed = rawQuery.trim();
    if (!trimmed) return true;
    const tokens = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    for (const token of tokens) {
        const colonIdx = token.indexOf(":");
        if (colonIdx > 0) {
            const key = token.slice(0, colonIdx).toLowerCase();
            const val = token.slice(colonIdx + 1).replace(/^"|"$/g, "");
            if (key === "status") {
                if (val === "online" && c.status !== "online") return false;
                if (val === "offline" && c.status !== "offline") return false;
                if (val === "disabled" && !c.is_disabled) return false;
                continue;
            }
            if (key === "name") {
                const nameTarget = c.display_name || c.client_id || "";
                if (val.includes("*")) {
                    if (!wildcardToRegExp(val).test(nameTarget)) return false;
                } else if (!nameTarget.toLowerCase().includes(val.toLowerCase())) {
                    return false;
                }
                continue;
            }
            if (key === "id") {
                if (!(c.client_id || "").toLowerCase().includes(val.toLowerCase())) return false;
                continue;
            }
            if (key === "tag") {
                const tags = [c.client_id, c.has_custom_profile ? "专属" : "默认", c.ip || ""].join(" ").toLowerCase();
                if (!tags.includes(val.toLowerCase())) return false;
                continue;
            }
        }
        const kw = token.replace(/^"|"$/g, "").toLowerCase();
        const hit =
            (c.client_id || "").toLowerCase().includes(kw) ||
            (c.display_name || "").toLowerCase().includes(kw) ||
            (c.mac || "").toLowerCase().includes(kw) ||
            (c.ip || "").toLowerCase().includes(kw);
        if (!hit) return false;
    }
    return true;
}

export default function ClientsPage() {
    const router = useRouter();
    const { accountId } = useAccount();
    const [clientList, setClientList] = useState<ClientDeviceOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "disabled">("all");
    const [selectedUids, setSelectedUids] = useState<string[]>([]);
    const [pageSize, setPageSize] = useState<number>(20);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // 右侧全高浮动侧边栏选中实例
    const [inspectorClient, setInspectorClient] = useState<ClientDeviceOut | null>(null);
    const [activeClient, setActiveClient] = useState<ClientDeviceOut | null>(null);

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

    // 批量操作与批量通知气泡
    const [batchLoading, setBatchLoading] = useState(false);
    const [batchNotifyForm, setBatchNotifyForm] = useState<NotificationPayload>({
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

    // 优化的设备信息弹窗（查看增强引擎详细设备信息 + 编辑显示名称，不可编辑 ID）
    const [infoDialogOpen, setInfoDialogOpen] = useState(false);
    const [editDisplayName, setEditDisplayName] = useState("");
    const [editProfileForm, setEditProfileForm] = useState<ClientProfileConfig>({});
    const [savingDevice, setSavingDevice] = useState(false);

    // 集控增强状态
    const [extendBusy, setExtendBusy] = useState(false);
    const [hardwareData, setHardwareData] = useState<HardwareSummary | null>(null);

    // 监控：进程弹窗、截图弹窗与发送指令气泡
    const [processDialogOpen, setProcessDialogOpen] = useState(false);
    const [processList, setProcessList] = useState<ProcessItem[]>([]);
    const [screenshotModalOpen, setScreenshotModalOpen] = useState(false);
    const [screenshotBase64, setScreenshotBase64] = useState("");
    const [screenshotMime, setScreenshotMime] = useState("image/jpeg");
    const [screenshotTakeoverActive, setScreenshotTakeoverActive] = useState(false);
    const [execShell, setExecShell] = useState<"powershell" | "pwsh" | "cmd" | "bash" | "sh">("powershell");
    const [quickExecCmd, setQuickExecCmd] = useState<string>("");
    const [execResultText, setExecResultText] = useState<string>("");

    // 绑定到触发客户端的审计日志弹窗
    const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
    const [auditTargetClient, setAuditTargetClient] = useState<ClientDeviceOut | null>(null);
    const [globalAudits, setGlobalAudits] = useState<AuditLogItem[]>([]);
    const [globalAuditsLoading, setGlobalAuditsLoading] = useState(false);
    const [auditFilterEvent, setAuditFilterEvent] = useState("");
    const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItem | null>(null);

    // 单设备推送提醒表单
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
            return matchesClientSearch(c, searchQuery);
        }
        return true;
    });

    function updateLocalClient(uid: string, patch: Partial<ClientDeviceOut>) {
        setClientList((prev) =>
            prev.map((item) => (item.uid === uid ? { ...item, ...patch } : item))
        );
        setInspectorClient((prev) => (prev && prev.uid === uid ? { ...prev, ...patch } : prev));
        setActiveClient((prev) => (prev && prev.uid === uid ? { ...prev, ...patch } : prev));
    }

    function selectInspectorClient(client: ClientDeviceOut) {
        setInspectorClient(client);
        setActiveClient(client);
        setEditDisplayName(client.display_name || client.client_id || "未命名实例");
        if (client.hardware_info && typeof client.hardware_info === "object") {
            setHardwareData(client.hardware_info as HardwareSummary);
        } else {
            setHardwareData(null);
        }
        setEditProfileForm({
            DefaultSettings: client.profile_config?.DefaultSettings || "default",
            Policy: client.profile_config?.Policy || "default",
            TimeLayout: client.profile_config?.TimeLayout || "default",
            Subjects: client.profile_config?.Subjects || "default",
            Components: client.profile_config?.Components || "default",
            ClassPlan: client.profile_config?.ClassPlan || "default",
            Credentials: client.profile_config?.Credentials || "default",
        });
    }

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
            setMsg({ type: "success", text: "默认配置已保存" });
            setDefaultProfileOpen(false);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
        setSavingDefaultProfile(false);
    }

    function openDeviceInfoModal(client: ClientDeviceOut) {
        selectInspectorClient(client);
        setInfoDialogOpen(true);
        if (client.status === "online" && client.extend_management_enabled && !client.hardware_info) {
            void dispatchAndPollExtendCommand("hardware.get_info", {}, (res) => {
                if (res && typeof res === "object") {
                    setHardwareData(res as HardwareSummary);
                    updateLocalClient(client.uid, { hardware_info: res as Record<string, unknown> });
                }
            });
        }
    }

    async function dispatchAndPollExtendCommand(
        action: string,
        payload: Record<string, unknown> = {},
        onSuccess?: (data: unknown) => void
    ) {
        const target = inspectorClient || activeClient;
        if (!target) return;
        setExtendBusy(true);
        try {
            const dispatched = await clients.sendExtendCommand(
                accountId,
                target.uid,
                action,
                payload,
                300
            );
            setMsg({ type: "success", text: "指令已下发，正在等待终端回传" });

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
                    text: "终端暂未回传执行结果",
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
                        text: rawParsed.message || rawParsed.errorMessage || "终端未能完成该指令",
                    });
                } else {
                    setMsg({ type: "success", text: "终端已完成指令" });
                    if (onSuccess) {
                        onSuccess(rawParsed.data);
                    }
                }
            } else {
                setMsg({ type: "success", text: "终端已回传数据" });
                if (onSuccess) {
                    onSuccess(completedDetail.parsed_payload);
                }
            }
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "下发指令失败" });
        }
        setExtendBusy(false);
    }

    function handleScreenshotClick(e: React.MouseEvent<HTMLImageElement>) {
        if (!inspectorClient || extendBusy || !screenshotTakeoverActive) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setScreenshotTakeoverActive(false);
        void dispatchAndPollExtendCommand("remote.simulate_click", {
            normalizedX: Number(normX.toFixed(4)),
            normalizedY: Number(normY.toFixed(4)),
            button: "left",
            clickType: "single",
        });
    }

    function handleCaptureScreenshot() {
        if (!inspectorClient || extendBusy) return;
        void dispatchAndPollExtendCommand(
            "remote.screenshot",
            { displayIndex: 0, scale: 0.75 },
            (res) => {
                if (res && typeof res === "object" && "imageBase64" in res) {
                    const r = res as { imageBase64?: string; mimeType?: string };
                    setScreenshotBase64(r.imageBase64 || "");
                    setScreenshotMime(r.mimeType || "image/jpeg");
                    setScreenshotTakeoverActive(false);
                    setScreenshotModalOpen(true);
                }
            }
        );
    }

    function handleFetchProcesses() {
        if (!inspectorClient || extendBusy) return;
        void dispatchAndPollExtendCommand(
            "remote.process_list",
            { keyword: "" },
            (res) => {
                if (res && typeof res === "object" && "processes" in res) {
                    setProcessList(
                        ((res as { processes?: ProcessItem[] }).processes || []).slice(0, 150)
                    );
                    setProcessDialogOpen(true);
                }
            }
        );
    }

    async function handleSaveDeviceInfo() {
        if (!inspectorClient) return;
        setSavingDevice(true);
        try {
            const trimmedName = editDisplayName.trim();
            await clients.rename(accountId, inspectorClient.uid, {
                display_name: trimmedName,
            });
            updateLocalClient(inspectorClient.uid, { display_name: trimmedName });
            setMsg({ type: "success", text: "显示名称已更新" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
        setSavingDevice(false);
    }

    async function handleRestart(uid: string) {
        setActionLoading(uid);
        try {
            await clients.restart(accountId, uid);
            setMsg({ type: "success", text: "已发送重启指令" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "发送指令失败" });
        }
        setActionLoading(null);
    }

    async function handleToggleLock(client: ClientDeviceOut) {
        setActionLoading(client.uid);
        try {
            if (client.is_app_locked) {
                const res = await clients.unlock(accountId, client.uid);
                updateLocalClient(client.uid, { is_app_locked: res.is_app_locked });
                setMsg({ type: "success", text: res.message || "已解锁客户端" });
            } else {
                const res = await clients.lock(accountId, client.uid);
                updateLocalClient(client.uid, { is_app_locked: res.is_app_locked });
                setMsg({ type: "success", text: res.message || "已锁定客户端" });
            }
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "操作失败" });
        }
        setActionLoading(null);
    }

    async function handleSendNotification() {
        if (!inspectorClient) return;
        setSavingDevice(true);
        try {
            await clients.sendNotification(accountId, inspectorClient.uid, notifyForm);
            setMsg({ type: "success", text: `通知已推送至 ${inspectorClient.display_name || inspectorClient.client_id || "目标实例"}` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "推送失败" });
        }
        setSavingDevice(false);
    }

    async function handleBatchAction(
        action: "restart" | "remove" | "lock" | "unlock" | "send_notification"
    ) {
        if (selectedUids.length === 0) return;
        setBatchLoading(true);
        try {
            await clients.batch(accountId, {
                client_uids: selectedUids,
                action,
                notification: action === "send_notification" ? batchNotifyForm : undefined,
            });
            if (action === "remove") {
                const removedSet = new Set(selectedUids);
                setClientList((prev) => prev.filter((item) => !removedSet.has(item.uid)));
                if (inspectorClient && removedSet.has(inspectorClient.uid)) {
                    setInspectorClient(null);
                }
                setSelectedUids([]);
            } else if (action === "lock") {
                setClientList((prev) =>
                    prev.map((item) =>
                        selectedUids.includes(item.uid) ? { ...item, is_app_locked: true } : item
                    )
                );
                if (inspectorClient && selectedUids.includes(inspectorClient.uid)) {
                    setInspectorClient((prev) => (prev ? { ...prev, is_app_locked: true } : null));
                }
            } else if (action === "unlock") {
                setClientList((prev) =>
                    prev.map((item) =>
                        selectedUids.includes(item.uid) ? { ...item, is_app_locked: false } : item
                    )
                );
                if (inspectorClient && selectedUids.includes(inspectorClient.uid)) {
                    setInspectorClient((prev) => (prev ? { ...prev, is_app_locked: false } : null));
                }
            }
            setMsg({ type: "success", text: `已对 ${selectedUids.length} 台设备执行批量操作` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "批量操作失败" });
        }
        setBatchLoading(false);
    }

    async function handleQuickProfileSubmit(andSync: boolean) {
        if (!inspectorClient) return;
        setSavingDevice(true);
        try {
            await clients.config(accountId, inspectorClient.uid, editProfileForm);
            updateLocalClient(inspectorClient.uid, {
                profile_config: { ...editProfileForm },
                has_custom_profile: true,
            });
            if (andSync && inspectorClient.status === "online") {
                if (inspectorClient.extend_management_enabled) {
                    await clients.sendExtendCommand(accountId, inspectorClient.uid, "settings.sync_default", {}, 120);
                    await clients.sendExtendCommand(accountId, inspectorClient.uid, "profile.reload", {}, 120);
                    await clients.sendExtendCommand(accountId, inspectorClient.uid, "profile.components.reload", {}, 120);
                } else {
                    await clients.forceSync(accountId, inspectorClient.uid);
                }
            }
            setMsg({
                type: "success",
                text: andSync ? "配置已提交并下发更新指令" : "配置已提交",
            });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "提交配置失败" });
        }
        setSavingDevice(false);
    }

    const loadBoundClientAudits = useCallback(async (clientUid: string, eventFilter?: string) => {
        if (!accountId || !clientUid) return;
        setGlobalAuditsLoading(true);
        const targetEvent = eventFilter !== undefined ? eventFilter : auditFilterEvent;
        try {
            const logRes = await audit.list(accountId, {
                client_uid: clientUid,
                event_type: targetEvent !== "" ? Number(targetEvent) : undefined,
                limit: 100,
            });
            setGlobalAudits(Array.isArray(logRes) ? logRes : []);
        } catch {
            setGlobalAudits([]);
        }
        setGlobalAuditsLoading(false);
    }, [accountId, auditFilterEvent]);

    function openBoundAuditDialog(client: ClientDeviceOut) {
        setAuditTargetClient(client);
        setAuditFilterEvent("");
        setAuditDrawerOpen(true);
        void loadBoundClientAudits(client.uid, "");
    }

    function getAuditBadgeClass(eventType: number) {
        if (eventType === 2 || eventType === 9) return "badge-danger";
        if (eventType === 11 || eventType === 13) return "badge-warning";
        if (eventType === 1 || eventType === 10) return "badge-success";
        return "badge-info";
    }

    const onlineCount = clientList.filter((c) => c.status === "online").length;
    const disabledCount = clientList.filter((c) => c.is_disabled).length;
    const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const pagedClients = filteredClients.slice((safePage - 1) * pageSize, safePage * pageSize);

    return (
        <div className="fade-in">
            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 12 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="clients-master-detail">
                {/* 左侧/中间主面板 */}
                <div className="clients-main-pane">
                    {/* 顶部标题行 */}
                    <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12 }}>
                        <div className="flex items-center gap-12" style={{ flexWrap: "wrap" }}>
                            <h1 className="page-title" style={{ margin: 0 }}>已注册实例</h1>
                            <Button
                                appearance="outline"
                                size="medium"
                                onClick={() => router.push("/pre-registration")}
                            >
                                预注册管理
                            </Button>
                        </div>
                        <div className="flex items-center gap-8">
                            <Button
                                appearance="secondary"
                                size="small"
                                icon={<Settings24Regular />}
                                onClick={openDefaultProfileModal}
                            >
                                默认配置
                            </Button>
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<ArrowSync24Regular />}
                                onClick={loadData}
                            >
                                刷新
                            </Button>
                        </div>
                    </div>

                    {/* 筛选栏与统计摘要 */}
                    <div className="card" style={{ padding: "12px 16px", marginBottom: 0 }}>
                        <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                            <Input
                                placeholder="输入搜索关键词或状态筛选条件"
                                value={searchQuery}
                                onChange={(_, d) => {
                                    setSearchQuery(d.value);
                                    setCurrentPage(1);
                                }}
                                style={{ flex: 1, minWidth: 240 }}
                            />

                            <Popover withArrow positioning="below-end">
                                <PopoverTrigger disableButtonEnhancement>
                                    <Button appearance="outline" icon={<Filter16Regular />}>
                                        筛选
                                    </Button>
                                </PopoverTrigger>
                                <PopoverSurface style={{ padding: 12, width: 220 }}>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>状态筛选</div>
                                        <Select
                                            size="small"
                                            value={statusFilter}
                                            onChange={(_, d) => {
                                                setStatusFilter(d.value as typeof statusFilter);
                                                setCurrentPage(1);
                                            }}
                                        >
                                            <option value="all">全部实例 {clientList.length}</option>
                                            <option value="online">在线 {onlineCount}</option>
                                            <option value="offline">离线 {clientList.length - onlineCount}</option>
                                            <option value="disabled">已禁用 {disabledCount}</option>
                                        </Select>
                                    </div>
                                </PopoverSurface>
                            </Popover>

                            <Popover withArrow positioning="below-end">
                                <PopoverTrigger disableButtonEnhancement>
                                    <Button appearance="outline" disabled={batchLoading}>
                                        批量操作
                                    </Button>
                                </PopoverTrigger>
                                <PopoverSurface style={{ padding: 12, width: 220 }}>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                                            已选定 {selectedUids.length} 个实例
                                        </div>
                                        <Button
                                            size="small"
                                            appearance="secondary"
                                            disabled={selectedUids.length === 0 || batchLoading}
                                            onClick={() => handleBatchAction("restart")}
                                        >
                                            重启
                                        </Button>
                                        <ConfirmPopover
                                            message={`确定要移除选中的 ${selectedUids.length} 台设备吗？`}
                                            onConfirm={() => handleBatchAction("remove")}
                                            confirmText="移除"
                                            disabled={selectedUids.length === 0 || batchLoading}
                                        >
                                            <Button
                                                size="small"
                                                appearance="secondary"
                                                disabled={selectedUids.length === 0 || batchLoading}
                                                style={{ color: "var(--danger-color)" }}
                                            >
                                                移除
                                            </Button>
                                        </ConfirmPopover>
                                        <Button
                                            size="small"
                                            appearance="secondary"
                                            disabled={selectedUids.length === 0 || batchLoading}
                                            onClick={() => handleBatchAction("lock")}
                                        >
                                            锁定
                                        </Button>
                                        <Button
                                            size="small"
                                            appearance="secondary"
                                            disabled={selectedUids.length === 0 || batchLoading}
                                            onClick={() => handleBatchAction("unlock")}
                                        >
                                            解锁
                                        </Button>
                                        <Popover withArrow positioning="before">
                                            <PopoverTrigger disableButtonEnhancement>
                                                <Button
                                                    size="small"
                                                    appearance="secondary"
                                                    disabled={selectedUids.length === 0 || batchLoading}
                                                >
                                                    发送通知
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverSurface style={{ padding: 12, width: 260 }}>
                                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>发送批量通知</div>
                                                    <Input
                                                        size="small"
                                                        placeholder="标题"
                                                        value={batchNotifyForm.MessageMask || ""}
                                                        onChange={(_, d) =>
                                                            setBatchNotifyForm((prev) => ({
                                                                ...prev,
                                                                MessageMask: d.value,
                                                            }))
                                                        }
                                                    />
                                                    <Input
                                                        size="small"
                                                        placeholder="内容"
                                                        value={batchNotifyForm.MessageContent || ""}
                                                        onChange={(_, d) =>
                                                            setBatchNotifyForm((prev) => ({
                                                                ...prev,
                                                                MessageContent: d.value,
                                                            }))
                                                        }
                                                    />
                                                    <div className="flex items-center justify-between">
                                                        <span style={{ fontSize: 12 }}>持续秒数</span>
                                                        <Input
                                                            size="small"
                                                            type="number"
                                                            value={String(batchNotifyForm.DurationSeconds ?? 5)}
                                                            onChange={(_, d) =>
                                                                setBatchNotifyForm((prev) => ({
                                                                    ...prev,
                                                                    DurationSeconds: parseInt(d.value, 10) || 5,
                                                                }))
                                                            }
                                                            style={{ width: 80 }}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span style={{ fontSize: 12 }}>语音播报</span>
                                                        <Switch
                                                            checked={!!batchNotifyForm.IsSpeechEnabled}
                                                            onChange={(_, d) =>
                                                                setBatchNotifyForm((prev) => ({
                                                                    ...prev,
                                                                    IsSpeechEnabled: d.checked,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span style={{ fontSize: 12 }}>紧急遮罩</span>
                                                        <Switch
                                                            checked={!!batchNotifyForm.IsEmergency}
                                                            onChange={(_, d) =>
                                                                setBatchNotifyForm((prev) => ({
                                                                    ...prev,
                                                                    IsEmergency: d.checked,
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                    <Button
                                                        size="small"
                                                        appearance="primary"
                                                        disabled={batchLoading}
                                                        onClick={() => handleBatchAction("send_notification")}
                                                    >
                                                        发送
                                                    </Button>
                                                </div>
                                            </PopoverSurface>
                                        </Popover>
                                    </div>
                                </PopoverSurface>
                            </Popover>
                        </div>

                        <div
                            style={{
                                marginTop: 8,
                                fontSize: 12.5,
                                color: "var(--text-secondary)",
                                display: "flex",
                                gap: 14,
                            }}
                        >
                            <span>{clientList.length}个实例</span>
                            <span>{filteredClients.length}已筛选</span>
                            <span>{selectedUids.length}已选定</span>
                        </div>
                    </div>

                    {/* 实例数据表 */}
                    <div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
                        {loading ? (
                            <div className="empty-state">
                                <Spinner size="medium" />
                            </div>
                        ) : pagedClients.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-text">暂无符合筛选条件的实例</div>
                            </div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 38 }}>
                                            <input
                                                type="checkbox"
                                                checked={
                                                    filteredClients.length > 0 &&
                                                    selectedUids.length === filteredClients.length
                                                }
                                                onChange={(e) => toggleSelectAll(e.target.checked)}
                                            />
                                        </th>
                                        <th>名称</th>
                                        <th>ID</th>
                                        <th>状态</th>
                                        <th>当前时间状态</th>
                                        <th>标签</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedClients.map((c) => {
                                        const isSelectedRow = inspectorClient?.uid === c.uid;
                                        const tagItems: string[] = [];
                                        if (c.extend_management_enabled) tagItems.push("增强集控");
                                        if (c.is_app_locked) tagItems.push("已锁定");
                                        if (c.has_custom_profile) tagItems.push("专属配置");
                                        if (c.ip === "127.0.0.1" || c.ip === "::1" || c.ip?.startsWith("192.168.")) {
                                            tagItems.push("本地");
                                        }
                                        if (tagItems.length === 0) tagItems.push("默认");

                                        return (
                                            <tr
                                                key={c.uid}
                                                onClick={() => selectInspectorClient(c)}
                                                style={{
                                                    cursor: "pointer",
                                                    background: isSelectedRow
                                                        ? "var(--bg-accent-subtle)"
                                                        : undefined,
                                                }}
                                            >
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedUids.includes(c.uid)}
                                                        onChange={() => toggleSelectOne(c.uid)}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: 600 }}>
                                                    {c.display_name || c.client_id || "未命名实例"}
                                                </td>
                                                <td
                                                    className="mono-code"
                                                    style={{ fontSize: 12.5, color: "var(--text-secondary)" }}
                                                >
                                                    {c.client_id || "未设置"}
                                                </td>
                                                <td>
                                                    <span
                                                        className={`badge ${
                                                            c.status === "online"
                                                                ? "badge-success"
                                                                : "badge-danger"
                                                        }`}
                                                    >
                                                        {c.status === "online" ? "在线" : "离线"}
                                                    </span>
                                                    {c.is_disabled && (
                                                        <span
                                                            className="badge badge-warning"
                                                            style={{ marginLeft: 4 }}
                                                        >
                                                            已禁用
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ fontSize: 13 }}>
                                                    {c.status === "online"
                                                        ? `课表 ${c.profile_config?.ClassPlan || "default"}`
                                                        : "未连接"}
                                                </td>
                                                <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                                                    {tagItems.join(", ")}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* 底部分页栏 */}
                    <div className="clients-pagination-bar">
                        <div className="flex items-center gap-8">
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<ChevronLeft16Regular />}
                                disabled={safePage <= 1}
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            />
                            <span className="mono-code" style={{ fontWeight: 600 }}>
                                {safePage} / {totalPages}
                            </span>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<ChevronRight16Regular />}
                                disabled={safePage >= totalPages}
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            />
                            <span style={{ marginLeft: 6 }}>
                                {loading ? "正在加载" : "加载完毕"}
                            </span>
                        </div>

                        <div className="flex items-center gap-6">
                            <span>每页</span>
                            <Select
                                size="small"
                                value={String(pageSize)}
                                onChange={(_, d) => {
                                    setPageSize(Number(d.value) || 20);
                                    setCurrentPage(1);
                                }}
                                style={{ width: 72 }}
                            >
                                <option value="10">10</option>
                                <option value="20">20</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                            </Select>
                            <span>条</span>
                        </div>
                    </div>
                </div>

                {/* 右侧全高浮动客户端管理卡片 */}
                {inspectorClient && (
                    <aside className="clients-inspector-card">
                        {/* 标题行：主标题为显示名称，副标题为在线状态和 ID（不显示 UUID），右侧为信息按钮与关闭按钮 */}
                        <div>
                            <div className="flex items-center justify-between">
                                <span style={{ fontSize: 20, fontWeight: 700 }}>
                                    {inspectorClient.display_name ||
                                        inspectorClient.client_id ||
                                        "未命名实例"}
                                </span>
                                <div className="flex items-center gap-4">
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Info16Regular />}
                                        onClick={() => openDeviceInfoModal(inspectorClient)}
                                        title="设备信息"
                                    />
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Dismiss16Regular />}
                                        onClick={() => setInspectorClient(null)}
                                        title="关闭"
                                    />
                                </div>
                            </div>
                            <div
                                style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}
                            >
                                {inspectorClient.status === "online" ? "在线" : "离线"} ·{" "}
                                {inspectorClient.client_id || "未设置 ID"}
                            </div>
                        </div>

                        {/* 发送命令：右侧的 重启 和 锁定（解锁）两个按钮，锁定按钮仅在客户端增强集控激活时显示 */}
                        <div className="clients-inspector-section">
                            <div className="clients-inspector-sec-header">
                                <span>发送命令</span>
                                <div className="flex items-center gap-6">
                                    <Button
                                        size="small"
                                        appearance="outline"
                                        icon={<ArrowClockwise16Regular />}
                                        disabled={
                                            inspectorClient.status !== "online" ||
                                            actionLoading === inspectorClient.uid
                                        }
                                        onClick={() => handleRestart(inspectorClient.uid)}
                                    >
                                        重启
                                    </Button>
                                    {inspectorClient.extend_management_enabled && (
                                        <Button
                                            size="small"
                                            appearance="outline"
                                            icon={
                                                inspectorClient.is_app_locked ? (
                                                    <LockOpen16Regular />
                                                ) : (
                                                    <LockClosed16Regular />
                                                )
                                            }
                                            disabled={actionLoading === inspectorClient.uid}
                                            onClick={() => handleToggleLock(inspectorClient)}
                                        >
                                            {inspectorClient.is_app_locked ? "解锁" : "锁定"}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 推送提醒：保持不变 */}
                        <div className="clients-inspector-section">
                            <div className="clients-inspector-sec-header">
                                <span>推送提醒</span>
                            </div>
                            <div className="flex items-center gap-6">
                                <Input
                                    size="small"
                                    placeholder="标题"
                                    value={notifyForm.MessageMask || ""}
                                    onChange={(_, d) =>
                                        setNotifyForm((prev) => ({
                                            ...prev,
                                            MessageMask: d.value,
                                        }))
                                    }
                                    style={{ flex: 1 }}
                                />
                                <Popover withArrow positioning="below-end">
                                    <PopoverTrigger disableButtonEnhancement>
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Settings16Regular />}
                                            title="提醒参数"
                                        />
                                    </PopoverTrigger>
                                    <PopoverSurface style={{ padding: 12, width: 240 }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 8,
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span style={{ fontSize: 12 }}>持续秒数</span>
                                                <Input
                                                    size="small"
                                                    type="number"
                                                    value={String(notifyForm.DurationSeconds ?? 5)}
                                                    onChange={(_, d) =>
                                                        setNotifyForm((prev) => ({
                                                            ...prev,
                                                            DurationSeconds:
                                                                parseInt(d.value, 10) || 5,
                                                        }))
                                                    }
                                                    style={{ width: 80 }}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span style={{ fontSize: 12 }}>语音播报</span>
                                                <Switch
                                                    checked={!!notifyForm.IsSpeechEnabled}
                                                    onChange={(_, d) =>
                                                        setNotifyForm((prev) => ({
                                                            ...prev,
                                                            IsSpeechEnabled: d.checked,
                                                        }))
                                                    }
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span style={{ fontSize: 12 }}>紧急遮罩</span>
                                                <Switch
                                                    checked={!!notifyForm.IsEmergency}
                                                    onChange={(_, d) =>
                                                        setNotifyForm((prev) => ({
                                                            ...prev,
                                                            IsEmergency: d.checked,
                                                        }))
                                                    }
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span style={{ fontSize: 12 }}>窗口置顶</span>
                                                <Switch
                                                    checked={!!notifyForm.IsTopmost}
                                                    onChange={(_, d) =>
                                                        setNotifyForm((prev) => ({
                                                            ...prev,
                                                            IsTopmost: d.checked,
                                                        }))
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </PopoverSurface>
                                </Popover>
                                <Button
                                    size="small"
                                    appearance="outline"
                                    disabled={
                                        inspectorClient.status !== "online" || savingDevice
                                    }
                                    onClick={handleSendNotification}
                                >
                                    发送
                                </Button>
                            </div>
                            <Input
                                size="small"
                                placeholder="内容"
                                value={notifyForm.MessageContent || ""}
                                onChange={(_, d) =>
                                    setNotifyForm((prev) => ({
                                        ...prev,
                                        MessageContent: d.value,
                                    }))
                                }
                            />
                        </div>

                        {/* 配置控制：移除右上角跳转按钮，提交并更新在增强集控激活时使用增强集控更新指令流 */}
                        <div className="clients-inspector-section">
                            <div className="clients-inspector-sec-header">
                                <span>配置控制</span>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {(
                                    [
                                        {
                                            key: "DefaultSettings" as ResourceType,
                                            label: "设置",
                                            icon: <Settings16Regular />,
                                        },
                                        {
                                            key: "Policy" as ResourceType,
                                            label: "策略",
                                            icon: <ShieldTask16Regular />,
                                        },
                                        {
                                            key: "TimeLayout" as ResourceType,
                                            label: "时间",
                                            icon: <Clock16Regular />,
                                        },
                                        {
                                            key: "Subjects" as ResourceType,
                                            label: "课程",
                                            icon: <Book16Regular />,
                                        },
                                        {
                                            key: "Components" as ResourceType,
                                            label: "组件",
                                            icon: <Apps16Regular />,
                                        },
                                        {
                                            key: "ClassPlan" as ResourceType,
                                            label: "课表",
                                            icon: <Board16Regular />,
                                        },
                                    ] as const
                                ).map((row) => (
                                    <div key={row.key} className="clients-profile-row">
                                        <span className="clients-profile-label">
                                            {row.icon}
                                            <span>{row.label}</span>
                                        </span>
                                        <Select
                                            size="small"
                                            value={editProfileForm[row.key] ?? ""}
                                            onChange={(_, d) =>
                                                setEditProfileForm((prev) => ({
                                                    ...prev,
                                                    [row.key]: d.value,
                                                }))
                                            }
                                            style={{ width: "100%" }}
                                        >
                                            <option value="">跟随默认</option>
                                            {resourceOptions[row.key].map((name) => (
                                                <option key={name} value={name}>
                                                    {name}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end gap-6" style={{ marginTop: 4 }}>
                                <Button
                                    size="small"
                                    appearance="outline"
                                    disabled={savingDevice}
                                    onClick={() => handleQuickProfileSubmit(false)}
                                >
                                    仅提交
                                </Button>
                                <Button
                                    size="small"
                                    appearance="primary"
                                    disabled={savingDevice}
                                    onClick={() => handleQuickProfileSubmit(true)}
                                >
                                    提交并更新
                                </Button>
                            </div>
                        </div>

                        {/* 监控：三个按钮移动到标题右侧，只占用一行；发送指令点击后显示气泡 */}
                        <div className="clients-inspector-section">
                            <div className="clients-inspector-sec-header" style={{ flexWrap: "nowrap", gap: 6 }}>
                                <span style={{ flexShrink: 0 }}>监控</span>
                                <div className="flex items-center gap-4" style={{ flexWrap: "nowrap" }}>
                                    <Button
                                        size="small"
                                        appearance="outline"
                                        icon={<QuestionCircle16Regular />}
                                        disabled={inspectorClient.status !== "online" || extendBusy}
                                        onClick={handleFetchProcesses}
                                    >
                                        获取进程
                                    </Button>
                                    <Button
                                        size="small"
                                        appearance="outline"
                                        icon={<Image16Regular />}
                                        disabled={inspectorClient.status !== "online" || extendBusy}
                                        onClick={handleCaptureScreenshot}
                                    >
                                        获取截图
                                    </Button>
                                    <Popover withArrow positioning="below-end">
                                        <PopoverTrigger disableButtonEnhancement>
                                            <Button
                                                size="small"
                                                appearance="outline"
                                                icon={<ArrowUp16Regular />}
                                                disabled={inspectorClient.status !== "online" || extendBusy}
                                            >
                                                发送指令
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverSurface style={{ padding: 12, width: 300 }}>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                <div style={{ fontSize: 12.5, fontWeight: 600 }}>发送指令</div>
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
                                                <Textarea
                                                    rows={3}
                                                    placeholder="输入要执行的命令"
                                                    value={quickExecCmd}
                                                    onChange={(_, d) => setQuickExecCmd(d.value)}
                                                    style={{ fontFamily: "var(--font-mono)" }}
                                                />
                                                <Button
                                                    size="small"
                                                    appearance="primary"
                                                    disabled={
                                                        inspectorClient.status !== "online" ||
                                                        extendBusy ||
                                                        !quickExecCmd.trim()
                                                    }
                                                    onClick={() => {
                                                        if (!quickExecCmd.trim()) return;
                                                        void dispatchAndPollExtendCommand(
                                                            "remote.exec_code",
                                                            {
                                                                shell: execShell,
                                                                command: quickExecCmd.trim(),
                                                                workingDirectory: "",
                                                                timeoutSeconds: 15,
                                                            },
                                                            (res) => {
                                                                if (res) {
                                                                    setExecResultText(
                                                                        typeof res === "string"
                                                                            ? res
                                                                            : JSON.stringify(res, null, 2)
                                                                    );
                                                                }
                                                            }
                                                        );
                                                    }}
                                                >
                                                    执行
                                                </Button>
                                                {execResultText && (
                                                    <Textarea
                                                        readOnly
                                                        rows={3}
                                                        value={execResultText}
                                                        style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                                                    />
                                                )}
                                            </div>
                                        </PopoverSurface>
                                    </Popover>
                                </div>
                            </div>
                        </div>

                        {/* 审查、排障与安全：移除右上角跳转按钮，按钮移到右侧，移除强制更新 */}
                        <div className="clients-inspector-section">
                            <div className="clients-inspector-sec-header" style={{ flexWrap: "nowrap", gap: 6 }}>
                                <span style={{ flexShrink: 0 }}>审查、排障与安全</span>
                                <div className="flex items-center gap-4" style={{ flexWrap: "nowrap" }}>
                                    <Button
                                        size="small"
                                        appearance="outline"
                                        icon={<ArrowDownload16Regular />}
                                        disabled={inspectorClient.status !== "online"}
                                        onClick={async () => {
                                            try {
                                                await clients.getConfig(
                                                    accountId,
                                                    inspectorClient.uid,
                                                    5
                                                );
                                                setMsg({
                                                    type: "success",
                                                    text: "已请求终端上传诊断数据",
                                                });
                                            } catch (err: unknown) {
                                                setMsg({
                                                    type: "error",
                                                    text:
                                                        err instanceof Error
                                                            ? err.message
                                                            : "请求诊断数据失败",
                                                });
                                            }
                                        }}
                                    >
                                        请求诊断数据
                                    </Button>
                                    <Button
                                        size="small"
                                        appearance="outline"
                                        onClick={() => openBoundAuditDialog(inspectorClient)}
                                    >
                                        审计日志
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </aside>
                )}
            </div>

            {/* 账户默认下发档案配置弹窗 */}
            {defaultProfileOpen && (
                <Dialog open onOpenChange={(_, d) => setDefaultProfileOpen(d.open)}>
                    <DialogSurface style={{ minWidth: 540 }}>
                        <DialogBody>
                            <DialogTitle>默认配置</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    设置本账户下所有未单独绑定专属配置的客户端默认拉取的资源文件。
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
                                                <option value="">不下发此项</option>
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
                                    {savingDefaultProfile ? <Spinner size="tiny" /> : "保存"}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 优化的设备信息弹窗：查看增强引擎详细设备信息 + 编辑显示名称（不可编辑 ID） */}
            {infoDialogOpen && inspectorClient && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setInfoDialogOpen(false); }}>
                    <DialogSurface style={{ minWidth: 560, maxWidth: "90vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                <div className="flex items-center justify-between">
                                    <span>设备信息</span>
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Dismiss16Regular />}
                                        onClick={() => setInfoDialogOpen(false)}
                                    />
                                </div>
                            </DialogTitle>
                            <DialogContent>
                                <div className="grid-2 mb-16">
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">显示名称</label>
                                        <div className="flex gap-6">
                                            <Input
                                                value={editDisplayName}
                                                onChange={(_, d) => setEditDisplayName(d.value)}
                                                placeholder="输入显示名称"
                                                style={{ flex: 1 }}
                                            />
                                            <Button
                                                appearance="primary"
                                                onClick={handleSaveDeviceInfo}
                                                disabled={savingDevice}
                                            >
                                                保存
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">ID</label>
                                        <Input
                                            value={inspectorClient.client_id || "未设置"}
                                            readOnly
                                            disabled
                                            style={{ width: "100%" }}
                                        />
                                    </div>
                                </div>

                                <div className="card" style={{ background: "var(--bg-subtle)", marginBottom: 16 }}>
                                    <div className="grid-2" style={{ gap: 8, fontSize: 13 }}>
                                        <div><strong>在线状态：</strong>{inspectorClient.status === "online" ? "在线" : "离线"}</div>
                                        <div><strong>增强集控：</strong>{inspectorClient.extend_management_enabled ? `已启用 ${inspectorClient.extend_management_version || ""}` : "未启用"}</div>
                                        <div><strong>物理网卡地址：</strong>{inspectorClient.mac || "-"}</div>
                                        <div><strong>最近网络地址：</strong>{inspectorClient.ip || "-"}</div>
                                        <div>
                                            <strong>注册时间：</strong>
                                            {inspectorClient.registered_at ? new Date(inspectorClient.registered_at).toLocaleString("zh-CN") : "-"}
                                        </div>
                                        <div>
                                            <strong>最后活跃：</strong>
                                            {inspectorClient.last_seen_at ? new Date(inspectorClient.last_seen_at).toLocaleString("zh-CN") : "-"}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mb-12">
                                    <span style={{ fontSize: 14, fontWeight: 600 }}>硬件与系统详情</span>
                                    {inspectorClient.extend_management_enabled && (
                                        <Button
                                            size="small"
                                            appearance="secondary"
                                            icon={<ArrowSync24Regular />}
                                            disabled={extendBusy || inspectorClient.status !== "online"}
                                            onClick={() =>
                                                dispatchAndPollExtendCommand("hardware.get_info", {}, (res) => {
                                                    if (res && typeof res === "object") {
                                                        setHardwareData(res as HardwareSummary);
                                                        updateLocalClient(inspectorClient.uid, {
                                                            hardware_info: res as Record<string, unknown>,
                                                        });
                                                    }
                                                })
                                            }
                                        >
                                            刷新硬件信息
                                        </Button>
                                    )}
                                </div>

                                {hardwareData ? (
                                    <div className="grid-2">
                                        <div className="card" style={{ background: "var(--bg-subtle)" }}>
                                            <div className="card-title">系统与主板</div>
                                            <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
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
                                            <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
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
                                            <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
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
                                            <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
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
                                ) : (
                                    <div className="empty-state" style={{ padding: 24 }}>
                                        <div className="empty-state-text">暂无详细硬件数据</div>
                                    </div>
                                )}
                            </DialogContent>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 获取到的截图弹窗：标题“获取到的截图”，右侧“接管”、“刷新”与右上角“关闭” */}
            {screenshotModalOpen && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setScreenshotModalOpen(false); }}>
                    <DialogSurface style={{ minWidth: 620, maxWidth: "90vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                <div className="flex items-center justify-between">
                                    <span>获取到的截图</span>
                                    <div className="flex items-center gap-6">
                                        <Button
                                            size="small"
                                            appearance={screenshotTakeoverActive ? "primary" : "outline"}
                                            icon={<CursorClick24Regular />}
                                            disabled={extendBusy}
                                            onClick={() => setScreenshotTakeoverActive((prev) => !prev)}
                                        >
                                            接管
                                        </Button>
                                        <Button
                                            size="small"
                                            appearance="outline"
                                            icon={<ArrowSync24Regular />}
                                            disabled={extendBusy}
                                            onClick={handleCaptureScreenshot}
                                        >
                                            刷新
                                        </Button>
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Dismiss16Regular />}
                                            onClick={() => setScreenshotModalOpen(false)}
                                            title="关闭"
                                        />
                                    </div>
                                </div>
                            </DialogTitle>
                            <DialogContent>
                                {screenshotTakeoverActive && (
                                    <div style={{ fontSize: 12.5, color: "var(--accent-color)", marginBottom: 8 }}>
                                        已开启接管，点击下方画面对应位置即可发送一次点击指令
                                    </div>
                                )}
                                {screenshotBase64 ? (
                                    <div style={{ textAlign: "center", overflow: "auto" }}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={`data:${screenshotMime};base64,${screenshotBase64}`}
                                            alt="获取到的截图"
                                            onClick={handleScreenshotClick}
                                            style={{
                                                maxWidth: "100%",
                                                maxHeight: "70vh",
                                                borderRadius: 8,
                                                border: "1px solid var(--border-color)",
                                                cursor: screenshotTakeoverActive ? "crosshair" : "default",
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <div className="empty-state">
                                        <Spinner size="medium" />
                                    </div>
                                )}
                            </DialogContent>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 获取进程弹窗 */}
            {processDialogOpen && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setProcessDialogOpen(false); }}>
                    <DialogSurface style={{ minWidth: 580, maxWidth: "88vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                <div className="flex items-center justify-between">
                                    <span>运行进程</span>
                                    <div className="flex items-center gap-6">
                                        <Button
                                            size="small"
                                            appearance="outline"
                                            icon={<ArrowSync24Regular />}
                                            disabled={extendBusy}
                                            onClick={handleFetchProcesses}
                                        >
                                            刷新
                                        </Button>
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Dismiss16Regular />}
                                            onClick={() => setProcessDialogOpen(false)}
                                        />
                                    </div>
                                </div>
                            </DialogTitle>
                            <DialogContent>
                                <div className="table-container" style={{ maxHeight: "56vh", overflowY: "auto" }}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>进程编号</th>
                                                <th>进程名称</th>
                                                <th>窗口标题</th>
                                                <th>内存占用</th>
                                                <th>状态</th>
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
                            </DialogContent>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 重做的审计日志卡片：紧凑尺寸，绑定到触发客户端，不提供终端选择，无清空日志能力 */}
            {auditDrawerOpen && auditTargetClient && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setAuditDrawerOpen(false); }}>
                    <DialogSurface style={{ width: 640, maxWidth: "90vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                <div className="flex items-center justify-between">
                                    <span>
                                        审计日志 · {auditTargetClient.display_name || auditTargetClient.client_id || "实例"}
                                    </span>
                                    <div className="flex items-center gap-6">
                                        <Select
                                            size="small"
                                            value={auditFilterEvent}
                                            onChange={(_, d) => {
                                                setAuditFilterEvent(d.value);
                                                void loadBoundClientAudits(auditTargetClient.uid, d.value);
                                            }}
                                            style={{ width: 150 }}
                                        >
                                            <option value="">全部事件类型</option>
                                            {Object.entries(AUDIT_EVENT_LABELS).map(([code, label]) => (
                                                <option key={code} value={code}>{label}</option>
                                            ))}
                                        </Select>
                                        <Button
                                            size="small"
                                            appearance="secondary"
                                            icon={<ArrowSync24Regular />}
                                            onClick={() => void loadBoundClientAudits(auditTargetClient.uid, auditFilterEvent)}
                                        >
                                            刷新
                                        </Button>
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Dismiss16Regular />}
                                            onClick={() => setAuditDrawerOpen(false)}
                                        />
                                    </div>
                                </div>
                            </DialogTitle>
                            <DialogContent>
                                <div style={{ maxHeight: 420, overflowY: "auto" }}>
                                    {globalAuditsLoading ? (
                                        <div className="empty-state"><Spinner size="medium" /></div>
                                    ) : globalAudits.length === 0 ? (
                                        <div className="empty-state">
                                            <div className="empty-state-text">暂无审计日志记录</div>
                                        </div>
                                    ) : (
                                        <table className="data-table" style={{ minWidth: 0 }}>
                                            <thead>
                                                <tr>
                                                    <th>事件类型</th>
                                                    <th>载荷摘要</th>
                                                    <th>上报时间</th>
                                                    <th>详情</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {globalAudits.map((item) => (
                                                    <tr key={item.id}>
                                                        <td>
                                                            <span className={`badge ${getAuditBadgeClass(item.event_type)}`}>
                                                                {AUDIT_EVENT_LABELS[item.event_type] || item.event_name}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {Object.keys(item.decoded || {}).length > 0
                                                                ? JSON.stringify(item.decoded)
                                                                : "-"}
                                                        </td>
                                                        <td style={{ fontSize: 12 }}>
                                                            {item.logged_at ? new Date(item.logged_at).toLocaleString("zh-CN") : "-"}
                                                        </td>
                                                        <td>
                                                            <Button
                                                                size="small"
                                                                appearance="subtle"
                                                                icon={<DocumentSearch24Regular />}
                                                                onClick={() => setSelectedAuditLog(item)}
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </DialogContent>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {selectedAuditLog && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setSelectedAuditLog(null); }}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>审计事件详情 #{selectedAuditLog.id}</DialogTitle>
                            <DialogContent>
                                <div style={{ display: "grid", gap: 8, marginBottom: 12, fontSize: 13 }}>
                                    <div><strong>事件类型：</strong>{AUDIT_EVENT_LABELS[selectedAuditLog.event_type] || selectedAuditLog.event_name}</div>
                                    <div><strong>上报时间：</strong>{selectedAuditLog.logged_at ? new Date(selectedAuditLog.logged_at).toLocaleString("zh-CN") : "-"}</div>
                                </div>
                                <div className="json-editor">
                                    <textarea
                                        readOnly
                                        value={JSON.stringify(selectedAuditLog.decoded || {}, null, 2)}
                                        style={{ minHeight: 180 }}
                                    />
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setSelectedAuditLog(null)}>关闭</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
