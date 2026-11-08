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
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";

type DetailTab = "info" | "profile" | "snapshots" | "audit" | "notify";

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

    // 账户默认下发档案弹窗 (__default__)
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
                // 清空自定义映射，恢复继承账户默认配置
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
            const res = await clients.getConfig(accountId, activeClient.uid, requestingConfigType);
            setMsg({
                type: "success",
                text: `已向终端下发抓取请求 (${res.config_type_name})，请稍候点击刷新查看上报结果`,
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
                        实时监控、编辑设备信息、分配 7 大集控资源档案并执行远程控制指令
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
                            placeholder="搜索名称、班级标识、UID、MAC 或 IP..."
                            value={searchQuery}
                            onChange={(_, d) => setSearchQuery(d.value)}
                            style={{ width: 320 }}
                        />
                        <Select
                            value={statusFilter}
                            onChange={(_, d) => setStatusFilter(d.value as typeof statusFilter)}
                        >
                            <option value="all">全部状态 ({clientList.length})</option>
                            <option value="online">仅在线 ({onlineCount})</option>
                            <option value="offline">仅离线 ({clientList.length - onlineCount})</option>
                            <option value="disabled">已禁用 ({disabledCount})</option>
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
                                <th>设备名称 / 班级标识</th>
                                <th>客户端 UID</th>
                                <th>网络信息</th>
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
                                        <div>IP: {c.ip || "-"}</div>
                                        <div style={{ color: "var(--text-secondary)" }}>MAC: {c.mac || "-"}</div>
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

            {/* 账户默认下发档案配置弹窗 (__default__) */}
            {defaultProfileOpen && (
                <Dialog open onOpenChange={(_, d) => setDefaultProfileOpen(d.open)}>
                    <DialogSurface style={{ minWidth: 540 }}>
                        <DialogBody>
                            <DialogTitle>账户默认下发档案配置</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    设置本账户下所有未单独绑定专属档案的客户端默认拉取的 7 类集控资源文件。
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
                            <DialogTitle>批量分配档案 ({selectedUids.length} 台设备)</DialogTitle>
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
                                                <option value="">-- 不下发 / 跟随默认 --</option>
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
                    <DialogSurface style={{ minWidth: 720, maxWidth: "92vw" }}>
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
                                                    placeholder="例如：高一(1)班讲台一体机"
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
                                                <div><strong>设备 UID：</strong>{activeClient.uid}</div>
                                                <div><strong>当前状态：</strong>{activeClient.status === "online" ? "在线" : "离线"}</div>
                                                <div><strong>物理 MAC：</strong>{activeClient.mac || "-"}</div>
                                                <div><strong>最近 IP：</strong>{activeClient.ip || "-"}</div>
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
                                                    关闭时，该设备将自动继承「账户默认下发档案配置」；开启后可单独指定 7 类集控资源文件。
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
                                                            <option value="">-- 不下发此项 / 跟随账户默认 --</option>
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
                                                保存后若客户端在线，将立即通过 gRPC 下发 DataUpdated 指令触发拉取。
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

                                {/* Tab 3: 远程配置抓取 */}
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
                                                    快照内容 ({CONFIG_TYPE_LABELS[activeSnapshot.config_type] || activeSnapshot.config_type_name})
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

                                {/* Tab 4: 设备审计日志 */}
                                {activeTab === "audit" && (
                                    <div>
                                        <div className="flex justify-between items-center mb-16">
                                            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                                展示该终端通过 gRPC Audit.LogEvent 上报的敏感行为与运行事件。
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

                                {/* Tab 5: 推送桌面通知 */}
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
                                                <label className="form-label">持续时间（秒）</label>
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
