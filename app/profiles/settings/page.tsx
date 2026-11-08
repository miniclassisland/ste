"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { data, accounts } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { AppDefaultSettings } from "@/lib/types";
import {
    Button, Input, Switch, Spinner,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular,
    Code24Regular, ArrowUpload24Regular, Desktop16Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

type SettingsTabKey =
    | "general"
    | "clock"
    | "storage"
    | "privacy"
    | "refreshing"
    | "advanced"
    | "components"
    | "appearance"
    | "window"
    | "notification"
    | "weather"
    | "automation"
    | "update"
    | "plugins"
    | "debug";

interface SettingsHierarchyGroup {
    groupKey: string;
    groupLabel: string;
    items: Array<{ key: SettingsTabKey; label: string }>;
}

/**
 * 严格对齐上游 ClassIsland (App.Services.xaml.cs & SettingsWindowNew) 的二级设置导航层级：
 * 1. 通用: 基本、时钟、存储、隐私、翻新与迎新、高级
 * 2. 主界面: 组件、外观、窗口
 * 3. 独立设置页: 提醒(含语音合成)、天气、自动化、更新、插件、调试
 */
const SETTINGS_HIERARCHY: SettingsHierarchyGroup[] = [
    {
        groupKey: "classisland.general",
        groupLabel: "通用",
        items: [
            { key: "general", label: "基本" },
            { key: "clock", label: "时钟" },
            { key: "storage", label: "存储" },
            { key: "privacy", label: "隐私" },
            { key: "refreshing", label: "翻新与迎新" },
            { key: "advanced", label: "高级" },
        ],
    },
    {
        groupKey: "classisland.mainwindow",
        groupLabel: "主界面",
        items: [
            { key: "components", label: "组件" },
            { key: "appearance", label: "外观" },
            { key: "window", label: "窗口" },
        ],
    },
    {
        groupKey: "classisland.standalone",
        groupLabel: "功能与系统",
        items: [
            { key: "notification", label: "提醒" },
            { key: "weather", label: "天气" },
            { key: "automation", label: "自动化" },
            { key: "update", label: "更新" },
            { key: "plugins", label: "插件" },
            { key: "debug", label: "调试" },
        ],
    },
];

export default function SettingsPage() {
    const { accountId, currentAccount } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [settings, setSettings] = useState<AppDefaultSettings>({});
    const [activeTab, setActiveTab] = useState<SettingsTabKey>("general");
    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const fileUploadRef = useRef<HTMLInputElement>(null);

    // 引导文件生成参数
    const [presetIdentity, setPresetIdentity] = useState("");

    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");

    const selectFile = useCallback(async (name: string) => {
        if (!accountId) return;
        setSelectedFile(name);
        setDataLoading(true);
        setMsg(null);
        try {
            const content = await data.read(accountId, "DefaultSettings", name);
            const parsed = (content as AppDefaultSettings) || {};
            setSettings(parsed);
            setJsonText(JSON.stringify(parsed, null, 2));
        } catch {
            setSettings({});
            setJsonText("{}");
        }
        setDataLoading(false);
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const list = await data.list(accountId, "DefaultSettings");
            const arr = Array.isArray(list) ? list : [];
            setFileList(arr);
            if (arr.length > 0 && !selectedFile) {
                selectFile(arr[0]);
            }
        } catch {
            setFileList([]);
        }
        setLoading(false);
    }, [accountId, selectedFile, selectFile]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave = settings;
            if (jsonMode) {
                payloadToSave = JSON.parse(jsonText) as AppDefaultSettings;
                setSettings(payloadToSave);
            } else {
                setJsonText(JSON.stringify(settings, null, 2));
            }
            await data.write(accountId, "DefaultSettings", selectedFile, payloadToSave);
            setMsg({ type: "success", text: "客户端默认应用设置 已保存并递增版本号" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
        setSaving(false);
    }

    function handleUploadLocalSettings(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || "{}"));
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                    throw new Error("Settings.json 必须是 JSON 对象");
                }
                setSettings(parsed as AppDefaultSettings);
                setJsonText(JSON.stringify(parsed, null, 2));
                setMsg({
                    type: "success",
                    text: `已从本地文件「${file.name}」导入 ${Object.keys(parsed).length} 项客户端设置，请点击「保存」以写入集控服务端`,
                });
            } catch (err: unknown) {
                setMsg({
                    type: "error",
                    text: err instanceof Error ? `导入本地设置文件失败: ${err.message}` : "导入本地设置文件失败",
                });
            }
        };
        reader.readAsText(file, "utf-8");
        e.target.value = "";
    }

    async function handleCreateFile(e: React.FormEvent) {
        e.preventDefault();
        const name = newFileName.trim();
        if (!name) return;
        try {
            await data.create(accountId, "DefaultSettings", name);
            setShowCreate(false);
            setNewFileName("");
            await loadFiles();
            selectFile(name);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDeleteFile(name: string) {
        if (!confirm(`确定删除 "${name}"？`)) return;
        try {
            await data.deleteData(accountId, "DefaultSettings", name);
            if (selectedFile === name) setSelectedFile(null);
            await loadFiles();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    function update<K extends keyof AppDefaultSettings>(key: K, value: AppDefaultSettings[K]) {
        const next = { ...settings, [key]: value };
        setSettings(next);
        setJsonText(JSON.stringify(next, null, 2));
    }

    const slugName = currentAccount?.slug || "account";

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">默认设置管理</h1>
                    <p className="page-subtitle">
                        管理下发至 ClassIsland 客户端的全量应用设置
                    </p>
                </div>
                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                    <Button appearance="primary" icon={<Add24Regular />} onClick={() => setShowCreate(true)}>新建文件</Button>
                    <Button appearance="secondary" icon={<ArrowSync24Regular />} onClick={loadFiles}>刷新</Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            {/* 快速生成客户端集控接入引导文件 */}
            <div className="card" style={{ padding: "14px 20px" }}>
                <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>客户端集控接入引导文件</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            点击下载按钮可在气泡中选择保存为具名区分文件或客户端默认加载名。
                        </div>
                    </div>
                    <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                        <DownloadPresetPopoverButton
                            buttonText="下载通用配置"
                            appearance="primary"
                            defaultFileName={`ManagementPreset-${slugName}-generic.json`}
                            onFetchData={() => accounts.downloadPreset(accountId, "")}
                            onError={(text) => setMsg({ type: "error", text })}
                        />
                        <Input
                            placeholder="预设班级标识（可选）"
                            value={presetIdentity}
                            onChange={(_, d) => setPresetIdentity(d.value)}
                            style={{ width: 220 }}
                        />
                        <DownloadPresetPopoverButton
                            buttonText="下载带标识配置"
                            appearance="secondary"
                            defaultFileName={`ManagementPreset-${slugName}-${presetIdentity.trim() || "custom"}.json`}
                            onFetchData={() => accounts.downloadPreset(accountId, presetIdentity.trim())}
                            onError={(text) => setMsg({ type: "error", text })}
                        />
                    </div>
                </div>
            </div>

            <div className="profile-split-layout">
                <div className="profile-split-sidebar">
                    <div className="card">
                        <div className="card-title">默认设置文件</div>
                        {loading ? (
                            <Spinner size="small" />
                        ) : (
                            fileList.map((f) => (
                                <div
                                    key={f}
                                    className={`sidebar-link ${selectedFile === f ? "active" : ""}`}
                                    onClick={() => selectFile(f)}
                                >
                                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f}</span>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<Delete24Regular />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteFile(f);
                                        }}
                                        style={{ color: "var(--danger-color)", minWidth: 24, padding: 2 }}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    {!selectedFile ? (
                        <div className="card"><div className="empty-state"><div className="empty-state-text">请选择默认设置文件</div></div></div>
                    ) : dataLoading ? (
                        <div className="card"><div className="empty-state"><Spinner size="medium" /></div></div>
                    ) : (
                        <div className="card">
                            <div className="flex items-center justify-between mb-16" style={{ flexWrap: "wrap", gap: 8 }}>
                                <div className="card-title" style={{ margin: 0 }}>编辑默认设置: {selectedFile}</div>
                                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                    <input
                                        ref={fileUploadRef}
                                        type="file"
                                        accept=".json,application/json"
                                        style={{ display: "none" }}
                                        onChange={handleUploadLocalSettings}
                                    />
                                    <Button
                                        appearance="secondary"
                                        icon={<ArrowUpload24Regular />}
                                        onClick={() => fileUploadRef.current?.click()}
                                    >
                                        导入本地 Settings.json
                                    </Button>
                                    <FileHistoryButton
                                        accountId={accountId}
                                        resourceType="DefaultSettings"
                                        fileName={selectedFile}
                                        onLoadVersion={(content, version, isCurrent) => {
                                            const parsed = (content as AppDefaultSettings) || {};
                                            setSettings(parsed);
                                            setJsonText(JSON.stringify(parsed, null, 2));
                                            setMsg({
                                                type: "success",
                                                text: isCurrent
                                                    ? `已加载当前最新版本 v${version}`
                                                    : `已加载历史版本 v${version} 到编辑器（点击「保存」将创建一个新版本，不会覆盖历史版本）`,
                                            });
                                        }}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <DownloadPresetPopoverButton
                                        buttonText="导出 JSON"
                                        appearance="secondary"
                                        defaultFileName={`DefaultSettings-${selectedFile}.json`}
                                        suggestedNames={[
                                            { label: "具名区分文件", fileName: `DefaultSettings-${selectedFile}.json` },
                                            { label: "档案原名", fileName: `${selectedFile}.json` },
                                            { label: "客户端标准资源名", fileName: "DefaultSettings.json" },
                                            { label: "单机版设置文件名", fileName: "Settings.json" },
                                        ]}
                                        onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : settings)}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <Button
                                        appearance="subtle"
                                        icon={<Code24Regular />}
                                        onClick={() => {
                                            if (!jsonMode) setJsonText(JSON.stringify(settings, null, 2));
                                            else {
                                                try { setSettings(JSON.parse(jsonText)); } catch { /* ignore */ }
                                            }
                                            setJsonMode(!jsonMode);
                                        }}
                                    >
                                        {jsonMode ? "切换可视化编辑" : "JSON 源码"}
                                    </Button>
                                    <Button appearance="primary" icon={<Save24Regular />} onClick={handleSave} disabled={saving}>
                                        {saving ? <Spinner size="tiny" /> : "保存"}
                                    </Button>
                                </div>
                            </div>

                            {jsonMode ? (
                                <div className="json-editor">
                                    <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} style={{ minHeight: 520 }} />
                                </div>
                            ) : (
                                <>
                                    {/* 对齐上游 ClassIsland SettingsWindowNew 的二级分组导航栏 */}
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 10,
                                            padding: "12px 14px",
                                            marginBottom: 20,
                                            background: "var(--bg-subtle)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: 8,
                                        }}
                                    >
                                        {SETTINGS_HIERARCHY.map((grp) => (
                                            <div
                                                key={grp.groupKey}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                    flexWrap: "wrap",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: 12,
                                                        fontWeight: 600,
                                                        color: "var(--text-secondary)",
                                                        minWidth: 76,
                                                    }}
                                                >
                                                    {grp.groupLabel}
                                                </span>
                                                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                                    {grp.items.map((t) => (
                                                        <button
                                                            key={t.key}
                                                            type="button"
                                                            className={`theme-segment-btn ${activeTab === t.key ? "active" : ""}`}
                                                            onClick={() => setActiveTab(t.key)}
                                                            style={{ padding: "5px 12px", fontSize: 12.5 }}
                                                        >
                                                            {t.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 通用 -> 基本 */}
                                    {activeTab === "general" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">通用 · 基本</div>
                                            <div className="grid-3">
                                                <div className="form-group">
                                                    <label className="form-label">选定的本地档案文件名</label>
                                                    <Input
                                                        value={settings.SelectedProfile ?? "Default.json"}
                                                        onChange={(_, d) => update("SelectedProfile", d.value)}
                                                        placeholder="Default.json"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">多周轮换最大周期数</label>
                                                    <Input
                                                        type="number"
                                                        min={2}
                                                        max={16}
                                                        value={String(settings.MultiWeekRotationMaxCycle ?? 2)}
                                                        onChange={(_, d) => update("MultiWeekRotationMaxCycle", parseInt(d.value, 10) || 2)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">开学首周起始日期</label>
                                                    <Input
                                                        value={settings.SingleWeekStartTime ?? ""}
                                                        onChange={(_, d) => update("SingleWeekStartTime", d.value)}
                                                        placeholder="例如 2026-09-01T00:00:00"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">启动画面自定义文字</label>
                                                    <Input
                                                        value={settings.SplashCustomText ?? ""}
                                                        onChange={(_, d) => update("SplashCustomText", d.value)}
                                                        placeholder="留空显示默认 ClassIsland 标志"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">启动画面自定义 Logo 路径</label>
                                                    <Input
                                                        value={settings.SplashCustomLogoSource ?? ""}
                                                        onChange={(_, d) => update("SplashCustomLogoSource", d.value)}
                                                        placeholder="留空使用默认图标"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">默认上课时长(分钟)</label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={String(settings.DefaultOnClassTimePointMinutes ?? 40)}
                                                        onChange={(_, d) => update("DefaultOnClassTimePointMinutes", parseInt(d.value, 10) || 40)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">默认课间时长(分钟)</label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={String(settings.DefaultBreakingTimePointMinutes ?? 10)}
                                                        onChange={(_, d) => update("DefaultBreakingTimePointMinutes", parseInt(d.value, 10) || 10)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">显示应用启动画面</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsSplashEnabled !== false}
                                                    onChange={(_, d) => update("IsSplashEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">在启动画面上显示详细加载进度</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.ShowDetailedStatusOnSplash}
                                                    onChange={(_, d) => update("ShowDetailedStatusOnSplash", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">快速换课默认采用互换模式</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsSwapMode !== false}
                                                    onChange={(_, d) => update("IsSwapMode", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">档案编辑器录入科目后自动跳到下一节</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsProfileEditorClassInfoSubjectAutoMoveNextEnabled !== false}
                                                    onChange={(_, d) => update("IsProfileEditorClassInfoSubjectAutoMoveNextEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">允许直接编辑当前已激活的时间表</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.ExpAllowEditingActivatedTimeLayout}
                                                    onChange={(_, d) => update("ExpAllowEditingActivatedTimeLayout", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">自动禁用导致崩溃的损坏插件</div>
                                                </div>
                                                <Switch
                                                    checked={settings.AutoDisableCorruptPlugins !== false}
                                                    onChange={(_, d) => update("AutoDisableCorruptPlugins", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 通用 -> 时钟 */}
                                    {activeTab === "clock" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">通用 · 时钟</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用 NTP 网络精确时间同步</div>
                                                    <div className="settings-item-hint">开启后客户端自动从指定 NTP 服务器同步标准时间，消除主板时钟误差</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsExactTimeEnabled !== false}
                                                    onChange={(_, d) => update("IsExactTimeEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用每日定时时间自动微调</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsTimeAutoAdjustEnabled}
                                                    onChange={(_, d) => update("IsTimeAutoAdjustEnabled", d.checked)}
                                                />
                                            </div>

                                            <div className="grid-3 mt-16">
                                                <div className="form-group">
                                                    <label className="form-label">NTP 时间服务器地址</label>
                                                    <Input
                                                        value={settings.ExactTimeServer ?? "ntp.aliyun.com"}
                                                        onChange={(_, d) => update("ExactTimeServer", d.value)}
                                                        placeholder="ntp.aliyun.com"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">固定时间偏移秒数</label>
                                                    <Input
                                                        type="number"
                                                        step={0.5}
                                                        value={String(settings.TimeOffsetSeconds ?? 0)}
                                                        onChange={(_, d) => update("TimeOffsetSeconds", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">每日自动调整秒数</label>
                                                    <Input
                                                        type="number"
                                                        step={0.1}
                                                        value={String(settings.TimeAutoAdjustSeconds ?? 0)}
                                                        onChange={(_, d) => update("TimeAutoAdjustSeconds", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* 通用 -> 存储 */}
                                    {activeTab === "storage" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">通用 · 存储与自动备份</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用配置自动定期备份</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsAutoBackupEnabled !== false}
                                                    onChange={(_, d) => update("IsAutoBackupEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="grid-2 mt-16">
                                                <div className="form-group">
                                                    <label className="form-label">自动备份间隔天数</label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={String(settings.AutoBackupIntervalDays ?? 7)}
                                                        onChange={(_, d) => update("AutoBackupIntervalDays", parseInt(d.value, 10) || 7)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">保留自动备份数量上限</label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={String(settings.AutoBackupLimit ?? 16)}
                                                        onChange={(_, d) => update("AutoBackupLimit", parseInt(d.value, 10) || 16)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* 通用 -> 隐私 */}
                                    {activeTab === "privacy" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">通用 · 隐私与诊断遥测</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用崩溃与诊断遥测上报</div>
                                                    <div className="settings-item-hint">控制客户端是否允许上报诊断与崩溃分析信息</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsReportingEnabled !== false}
                                                    onChange={(_, d) => update("IsReportingEnabled", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 通用 -> 翻新与迎新 */}
                                    {activeTab === "refreshing" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">通用 · 翻新与迎新</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">已完成欢迎引导</div>
                                                    <div className="settings-item-hint">开启后客户端首次启动不再弹出单机欢迎向导</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsWelcomeWindowShowed !== false}
                                                    onChange={(_, d) => update("IsWelcomeWindowShowed", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用久未重启翻新提示横幅</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsRefreshingToastEnabled !== false}
                                                    onChange={(_, d) => update("IsRefreshingToastEnabled", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 通用 -> 高级 */}
                                    {activeTab === "advanced" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">通用 · 高级与兼容性</div>
                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">动画等级</label>
                                                    <Select
                                                        value={String(settings.AnimationLevel ?? 1)}
                                                        onChange={(_, d) => update("AnimationLevel", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>关闭动画</option>
                                                        <option value={1}>标准动画</option>
                                                        <option value={2}>完整流畅动画</option>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">使用 RawInput 检测鼠标坐标</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.UseRawInput}
                                                    onChange={(_, d) => update("UseRawInput", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用兼容窗口透明模式</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsCompatibleWindowTransparentEnabled}
                                                    onChange={(_, d) => update("IsCompatibleWindowTransparentEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">录屏模式优化</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsScreenRecordingModeEnabled}
                                                    onChange={(_, d) => update("IsScreenRecordingModeEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">防截屏/录屏捕获保护</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsWindowCaptureBlockingEnabled}
                                                    onChange={(_, d) => update("IsWindowCaptureBlockingEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">降低进度条刷新精度以节省希沃白板 CPU 占用</div>
                                                </div>
                                                <Switch
                                                    checked={settings.ReduceProgressAccuracy !== false}
                                                    onChange={(_, d) => update("ReduceProgressAccuracy", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 主界面 -> 组件 */}
                                    {activeTab === "components" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">主界面 · 组件与课程显示</div>
                                            <div className="grid-3">
                                                <div className="form-group">
                                                    <label className="form-label">当前组件配置方案名</label>
                                                    <Input
                                                        value={settings.CurrentComponentConfig ?? "Default"}
                                                        onChange={(_, d) => update("CurrentComponentConfig", d.value)}
                                                        placeholder="Default"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">课程表项间距</label>
                                                    <Input
                                                        type="number"
                                                        step={0.5}
                                                        value={String(settings.ScheduleSpacing ?? 1.0)}
                                                        onChange={(_, d) => update("ScheduleSpacing", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">时间点附加信息类型</label>
                                                    <Select
                                                        value={String(settings.ExtraInfoType ?? 0)}
                                                        onChange={(_, d) => update("ExtraInfoType", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>不显示 / 默认</option>
                                                        <option value={1}>显示已进行时间</option>
                                                        <option value={2}>显示倒计时百分比</option>
                                                        <option value={3}>显示倒计时分/秒</option>
                                                        <option value={4}>倒计时最后显示秒数</option>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">上课倒计时触发阈值(秒)</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.CountdownSeconds ?? 60)}
                                                        onChange={(_, d) => update("CountdownSeconds", parseInt(d.value, 10) || 60)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">精确秒数显示阈值(秒)</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.ExtraInfo4ShowSecondsSeconds ?? 60)}
                                                        onChange={(_, d) => update("ExtraInfo4ShowSecondsSeconds", parseInt(d.value, 10) || 60)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">上课时仅显示当前课程</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.ShowCurrentLessonOnlyOnClass}
                                                    onChange={(_, d) => update("ShowCurrentLessonOnlyOnClass", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">在时间点上显示附加信息</div>
                                                </div>
                                                <Switch
                                                    checked={settings.ShowExtraInfoOnTimePoint !== false}
                                                    onChange={(_, d) => update("ShowExtraInfoOnTimePoint", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用上课前倒计时显示</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsCountdownEnabled !== false}
                                                    onChange={(_, d) => update("IsCountdownEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用模糊倒计时模式</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsNonExactCountdownEnabled}
                                                    onChange={(_, d) => update("IsNonExactCountdownEnabled", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 主界面 -> 窗口 */}
                                    {activeTab === "window" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">主界面 · 窗口、停靠与避让</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">显示主窗口</div>
                                                    <div className="settings-item-hint">控制客户端主界面默认是否可见</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsMainWindowVisible !== false}
                                                    onChange={(_, d) => update("IsMainWindowVisible", d.checked)}
                                                />
                                            </div>

                                            {/* 原位复刻上游 WindowSettingsPage 屏幕 6 停靠点可视化选择器 */}
                                            <div style={{ marginTop: 14, marginBottom: 16, padding: 16, borderRadius: 10, border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.18)" }}>
                                                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                                                    窗口停靠位置可视化预览
                                                </div>
                                                <div
                                                    style={{
                                                        width: "100%",
                                                        maxWidth: 460,
                                                        height: 150,
                                                        margin: "0 auto",
                                                        borderRadius: 10,
                                                        border: "2px solid var(--border-color)",
                                                        background: "rgba(255,255,255,0.03)",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        justifyContent: "space-between",
                                                        padding: 14,
                                                    }}
                                                >
                                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                                        {[
                                                            { idx: 0, label: "左上角" },
                                                            { idx: 1, label: "顶部居中" },
                                                            { idx: 2, label: "右上角" },
                                                        ].map((pos) => {
                                                            const active = (settings.WindowDockingLocation ?? 1) === pos.idx;
                                                            return (
                                                                <button
                                                                    key={pos.idx}
                                                                    type="button"
                                                                    onClick={() => update("WindowDockingLocation", pos.idx)}
                                                                    style={{
                                                                        padding: "7px 8px",
                                                                        borderRadius: 6,
                                                                        border: active ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                                        background: active ? "var(--accent-color)" : "var(--bg-card)",
                                                                        color: active ? "#fff" : "var(--text-primary)",
                                                                        fontSize: 11.5,
                                                                        fontWeight: active ? 700 : 500,
                                                                        cursor: "pointer",
                                                                    }}
                                                                >
                                                                    {pos.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
                                                        <Desktop16Regular />
                                                        <span>显示器 #{settings.WindowDockingMonitorIndex ?? 0} · 偏移 ({settings.WindowDockingOffsetX ?? 0}, {settings.WindowDockingOffsetY ?? 0})</span>
                                                    </div>
                                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                                        {[
                                                            { idx: 3, label: "左下角" },
                                                            { idx: 4, label: "底部居中" },
                                                            { idx: 5, label: "右下角" },
                                                        ].map((pos) => {
                                                            const active = (settings.WindowDockingLocation ?? 1) === pos.idx;
                                                            return (
                                                                <button
                                                                    key={pos.idx}
                                                                    type="button"
                                                                    onClick={() => update("WindowDockingLocation", pos.idx)}
                                                                    style={{
                                                                        padding: "7px 8px",
                                                                        borderRadius: 6,
                                                                        border: active ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                                        background: active ? "var(--accent-color)" : "var(--bg-card)",
                                                                        color: active ? "#fff" : "var(--text-primary)",
                                                                        fontSize: 11.5,
                                                                        fontWeight: active ? 700 : 500,
                                                                        cursor: "pointer",
                                                                    }}
                                                                >
                                                                    {pos.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid-3 mt-16">
                                                <div className="form-group">
                                                    <label className="form-label">窗口停靠位置</label>
                                                    <Select
                                                        value={String(settings.WindowDockingLocation ?? 1)}
                                                        onChange={(_, d) => update("WindowDockingLocation", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>左上角</option>
                                                        <option value={1}>中上侧</option>
                                                        <option value={2}>右上角</option>
                                                        <option value={3}>左下角</option>
                                                        <option value={4}>中下侧</option>
                                                        <option value={5}>右下角</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">窗口层级</label>
                                                    <Select
                                                        value={String(settings.WindowLayer ?? 1)}
                                                        onChange={(_, d) => update("WindowLayer", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>置底</option>
                                                        <option value={1}>置顶</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">停靠显示器索引</label>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={String(settings.WindowDockingMonitorIndex ?? 0)}
                                                        onChange={(_, d) => update("WindowDockingMonitorIndex", Math.max(0, parseInt(d.value, 10) || 0))}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-3">
                                                <div className="form-group">
                                                    <label className="form-label">窗口向右偏移 X</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.WindowDockingOffsetX ?? 0)}
                                                        onChange={(_, d) => update("WindowDockingOffsetX", parseInt(d.value, 10) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">窗口向下偏移 Y</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.WindowDockingOffsetY ?? 0)}
                                                        onChange={(_, d) => update("WindowDockingOffsetY", parseInt(d.value, 10) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">点击托盘图标行为</label>
                                                    <Select
                                                        value={String(settings.TaskBarIconClickBehavior ?? 0)}
                                                        onChange={(_, d) => update("TaskBarIconClickBehavior", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>打开主菜单</option>
                                                        <option value={1}>打开档案编辑窗口</option>
                                                        <option value={2}>显示/隐藏主界面</option>
                                                        <option value={3}>打开换课窗口</option>
                                                        <option value={4}>打开设置窗口</option>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">界面隐藏模式</label>
                                                    <Select
                                                        value={String(settings.HideMode ?? 0)}
                                                        onChange={(_, d) => update("HideMode", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>按基础条件自动隐藏</option>
                                                        <option value={1}>使用高级规则集隐藏</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">触控渐隐持续毫秒</label>
                                                    <Input
                                                        type="number"
                                                        step={100}
                                                        value={String(settings.TouchInFadingDurationMs ?? 0)}
                                                        onChange={(_, d) => update("TouchInFadingDurationMs", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">上课时自动隐藏主界面</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.HideOnClass}
                                                    onChange={(_, d) => update("HideOnClass", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">前景全屏程序时隐藏主界面</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.HideOnFullscreen}
                                                    onChange={(_, d) => update("HideOnFullscreen", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">前景窗口最大化时隐藏主界面</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.HideOnMaxWindow}
                                                    onChange={(_, d) => update("HideOnMaxWindow", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">忽略桌面工作区限制 / 贴边停靠</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsIgnoreWorkAreaEnabled}
                                                    onChange={(_, d) => update("IsIgnoreWorkAreaEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">允许主界面响应鼠标点击交互</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsMouseClickingEnabled}
                                                    onChange={(_, d) => update("IsMouseClickingEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">鼠标移入主窗口时渐隐穿透</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsMouseInFadingEnabled !== false}
                                                    onChange={(_, d) => update("IsMouseInFadingEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">反转鼠标移入渐隐（移入时显现、移出时半透明）</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsMouseInFadingReversed}
                                                    onChange={(_, d) => update("IsMouseInFadingReversed", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 主界面 -> 外观 */}
                                    {activeTab === "appearance" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">主界面 · 外观、主题与字体</div>
                                            <div className="grid-3">
                                                <div className="form-group">
                                                    <label className="form-label">应用明暗主题</label>
                                                    <Select
                                                        value={String(settings.Theme ?? 0)}
                                                        onChange={(_, d) => update("Theme", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>跟随系统</option>
                                                        <option value={1}>明亮模式</option>
                                                        <option value={2}>黑暗模式</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">主题色来源</label>
                                                    <Select
                                                        value={String(settings.ColorSource ?? 0)}
                                                        onChange={(_, d) => update("ColorSource", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>自定义色彩</option>
                                                        <option value={1}>壁纸主题色提取</option>
                                                        <option value={2}>系统强调色</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">界面缩放比例</label>
                                                    <Input
                                                        type="number"
                                                        step={0.05}
                                                        min={0.5}
                                                        max={3.0}
                                                        value={String(settings.Scale ?? 1.0)}
                                                        onChange={(_, d) => update("Scale", parseFloat(d.value) || 1.0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">主强调色</label>
                                                    <div className="flex items-center gap-8">
                                                        <input
                                                            type="color"
                                                            value={settings.PrimaryColor || "#0078D4"}
                                                            onChange={(e) => update("PrimaryColor", e.target.value)}
                                                            style={{ width: 40, height: 32, border: "1px solid var(--border-color)", borderRadius: 4 }}
                                                        />
                                                        <Input
                                                            value={settings.PrimaryColor || "#0078D4"}
                                                            onChange={(_, d) => update("PrimaryColor", d.value)}
                                                            style={{ flex: 1 }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">次强调色</label>
                                                    <div className="flex items-center gap-8">
                                                        <input
                                                            type="color"
                                                            value={settings.SecondaryColor || "#005A9E"}
                                                            onChange={(e) => update("SecondaryColor", e.target.value)}
                                                            style={{ width: 40, height: 32, border: "1px solid var(--border-color)", borderRadius: 4 }}
                                                        />
                                                        <Input
                                                            value={settings.SecondaryColor || "#005A9E"}
                                                            onChange={(_, d) => update("SecondaryColor", d.value)}
                                                            style={{ flex: 1 }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid-4">
                                                <div className="form-group">
                                                    <label className="form-label">背景不透明度</label>
                                                    <Input
                                                        type="number"
                                                        step={0.05}
                                                        min={0}
                                                        max={1}
                                                        value={String(settings.Opacity ?? 0.5)}
                                                        onChange={(_, d) => update("Opacity", parseFloat(d.value) || 0.5)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">圆角半径 X</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.RadiusX ?? 8)}
                                                        onChange={(_, d) => update("RadiusX", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">圆角半径 Y</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.RadiusY ?? 8)}
                                                        onChange={(_, d) => update("RadiusY", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">行间垂直间距</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.MainWindowLineVerticalMargin ?? 0)}
                                                        onChange={(_, d) => update("MainWindowLineVerticalMargin", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">主界面字体名称</label>
                                                    <Input
                                                        value={settings.MainWindowFont ?? "HarmonyOS Sans SC"}
                                                        onChange={(_, d) => update("MainWindowFont", d.value)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">主界面字重</label>
                                                    <Input
                                                        type="number"
                                                        step={100}
                                                        min={100}
                                                        max={900}
                                                        value={String(settings.MainWindowFontWeight2 ?? 400)}
                                                        onChange={(_, d) => update("MainWindowFontWeight2", parseInt(d.value, 10) || 400)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-4">
                                                <div className="form-group">
                                                    <label className="form-label">次要字号</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.MainWindowSecondaryFontSize ?? 14)}
                                                        onChange={(_, d) => update("MainWindowSecondaryFontSize", parseFloat(d.value) || 14)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">正文字号</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.MainWindowBodyFontSize ?? 16)}
                                                        onChange={(_, d) => update("MainWindowBodyFontSize", parseFloat(d.value) || 16)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">强调字号</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.MainWindowEmphasizedFontSize ?? 18)}
                                                        onChange={(_, d) => update("MainWindowEmphasizedFontSize", parseFloat(d.value) || 18)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">大号字号</label>
                                                    <Input
                                                        type="number"
                                                        value={String(settings.MainWindowLargeFontSize ?? 20)}
                                                        onChange={(_, d) => update("MainWindowLargeFontSize", parseFloat(d.value) || 20)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用分体主界面模式</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsIslandSeperated}
                                                    onChange={(_, d) => update("IsIslandSeperated", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用自定义背景色</div>
                                                </div>
                                                <div className="flex items-center gap-8">
                                                    {settings.IsCustomBackgroundColorEnabled && (
                                                        <input
                                                            type="color"
                                                            value={settings.BackgroundColor || "#000000"}
                                                            onChange={(e) => update("BackgroundColor", e.target.value)}
                                                            style={{ width: 36, height: 28, border: "1px solid var(--border-color)", borderRadius: 4 }}
                                                        />
                                                    )}
                                                    <Switch
                                                        checked={!!settings.IsCustomBackgroundColorEnabled}
                                                        onChange={(_, d) => update("IsCustomBackgroundColorEnabled", d.checked)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用自定义前景色/文字颜色</div>
                                                </div>
                                                <div className="flex items-center gap-8">
                                                    {settings.IsCustomForegroundColorEnabled && (
                                                        <input
                                                            type="color"
                                                            value={settings.CustomForegroundColor || "#FFFFFF"}
                                                            onChange={(e) => update("CustomForegroundColor", e.target.value)}
                                                            style={{ width: 36, height: 28, border: "1px solid var(--border-color)", borderRadius: 4 }}
                                                        />
                                                    )}
                                                    <Switch
                                                        checked={!!settings.IsCustomForegroundColorEnabled}
                                                        onChange={(_, d) => update("IsCustomForegroundColorEnabled", d.checked)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">定时自动更新壁纸主题色</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsWallpaperAutoUpdateEnabled}
                                                    onChange={(_, d) => update("IsWallpaperAutoUpdateEnabled", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 功能与系统 -> 提醒与语音合成 */}
                                    {activeTab === "notification" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">功能与系统 · 提醒、全屏波纹特效与语音合成</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用提醒功能总开关</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsNotificationEnabled !== false}
                                                    onChange={(_, d) => update("IsNotificationEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用提醒醒目全屏视觉特效</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsNotificationEffectEnabled !== false}
                                                    onChange={(_, d) => update("IsNotificationEffectEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用提醒音效</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsNotificationSoundEnabled !== false}
                                                    onChange={(_, d) => update("IsNotificationSoundEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">提醒时强制窗口置顶</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsNotificationTopmostEnabled !== false}
                                                    onChange={(_, d) => update("IsNotificationTopmostEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">使用独立 UI 线程渲染全屏提醒特效</div>
                                                </div>
                                                <Switch
                                                    checked={settings.NotificationUseStandaloneEffectUiThread !== false}
                                                    onChange={(_, d) => update("NotificationUseStandaloneEffectUiThread", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">允许提醒请求启用语音播报</div>
                                                </div>
                                                <Switch
                                                    checked={settings.AllowNotificationSpeech !== false}
                                                    onChange={(_, d) => update("AllowNotificationSpeech", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">允许提醒请求启用全屏特效</div>
                                                </div>
                                                <Switch
                                                    checked={settings.AllowNotificationEffect !== false}
                                                    onChange={(_, d) => update("AllowNotificationEffect", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">允许提醒请求播放音效</div>
                                                </div>
                                                <Switch
                                                    checked={settings.AllowNotificationSound !== false}
                                                    onChange={(_, d) => update("AllowNotificationSound", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">允许提醒请求强制置顶</div>
                                                </div>
                                                <Switch
                                                    checked={settings.AllowNotificationTopmost !== false}
                                                    onChange={(_, d) => update("AllowNotificationTopmost", d.checked)}
                                                />
                                            </div>

                                            <div className="grid-3 mt-16">
                                                <div className="form-group">
                                                    <label className="form-label">提醒音效音量</label>
                                                    <Input
                                                        type="number"
                                                        step={0.05}
                                                        min={0}
                                                        max={1}
                                                        value={String(settings.NotificationSoundVolume ?? 1.0)}
                                                        onChange={(_, d) => update("NotificationSoundVolume", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">自定义提醒音效路径</label>
                                                    <Input
                                                        value={settings.NotificationSoundPath ?? ""}
                                                        onChange={(_, d) => update("NotificationSoundPath", d.value)}
                                                        placeholder="留空使用内置默认音效"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">特效渲染精度缩放</label>
                                                    <Input
                                                        type="number"
                                                        step={0.1}
                                                        min={0.25}
                                                        max={2.0}
                                                        value={String(settings.NotificationEffectRenderingScale ?? 1.0)}
                                                        onChange={(_, d) => update("NotificationEffectRenderingScale", parseFloat(d.value) || 1.0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-section-title mt-16">语音合成引擎</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用 TTS 语音合成播报</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsSpeechEnabled !== false}
                                                    onChange={(_, d) => update("IsSpeechEnabled", d.checked)}
                                                />
                                            </div>

                                            <div className="grid-2 mt-16">
                                                <div className="form-group">
                                                    <label className="form-label">语音合成源</label>
                                                    <Select
                                                        value={String(settings.SpeechSource ?? 1)}
                                                        onChange={(_, d) => update("SpeechSource", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>系统内置 TTS</option>
                                                        <option value={1}>微软 EdgeTTS 在线神经网络语音</option>
                                                        <option value={2}>GPT-SoVITS 自定义语音服务</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">语音服务提供商标识</label>
                                                    <Select
                                                        value={settings.SelectedSpeechProvider ?? "classisland.speech.edgeTts"}
                                                        onChange={(_, d) => update("SelectedSpeechProvider", d.value)}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value="classisland.speech.system">系统内置语音</option>
                                                        <option value="classisland.speech.edgeTts">微软 EdgeTTS</option>
                                                        <option value="classisland.speech.gptSoVits">GPT-SoVITS</option>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="grid-2">
                                                <div className="form-group">
                                                    <label className="form-label">语音播报音量</label>
                                                    <Input
                                                        type="number"
                                                        step={0.05}
                                                        min={0}
                                                        max={1}
                                                        value={String(settings.SpeechVolume ?? 1.0)}
                                                        onChange={(_, d) => update("SpeechVolume", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">EdgeTTS 发音人名称</label>
                                                    <Input
                                                        value={settings.EdgeTtsVoiceName ?? "zh-CN-XiaoxiaoNeural"}
                                                        onChange={(_, d) => update("EdgeTtsVoiceName", d.value)}
                                                        placeholder="zh-CN-XiaoxiaoNeural"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* 功能与系统 -> 天气 */}
                                    {activeTab === "weather" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">功能与系统 · 天气数据源与城市定位</div>
                                            <div className="grid-3">
                                                <div className="form-group">
                                                    <label className="form-label">定位方式</label>
                                                    <Select
                                                        value={String(settings.WeatherLocationSource ?? 0)}
                                                        onChange={(_, d) => update("WeatherLocationSource", parseInt(d.value, 10))}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <option value={0}>按城市/区县名称搜索</option>
                                                        <option value={1}>按经纬度坐标定位</option>
                                                        <option value={2}>系统自动定位</option>
                                                    </Select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">城市编码</label>
                                                    <Input
                                                        value={settings.CityId ?? "101010100"}
                                                        onChange={(_, d) => update("CityId", d.value)}
                                                        placeholder="例如 101010100"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">城市显示名称</label>
                                                    <Input
                                                        value={settings.CityName ?? "北京 (北京, 中国)"}
                                                        onChange={(_, d) => update("CityName", d.value)}
                                                        placeholder="例如 北京 (北京, 中国)"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid-3">
                                                <div className="form-group">
                                                    <label className="form-label">经度</label>
                                                    <Input
                                                        type="number"
                                                        step={0.0001}
                                                        value={String(settings.WeatherLongitude ?? 0)}
                                                        onChange={(_, d) => update("WeatherLongitude", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">纬度</label>
                                                    <Input
                                                        type="number"
                                                        step={0.0001}
                                                        value={String(settings.WeatherLatitude ?? 0)}
                                                        onChange={(_, d) => update("WeatherLatitude", parseFloat(d.value) || 0)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">天气图标方案</label>
                                                    <Input
                                                        value={settings.WeatherIconId ?? "classisland.weatherIcons.lucide"}
                                                        onChange={(_, d) => update("WeatherIconId", d.value)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启动时自动刷新定位位置</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.AutoRefreshWeatherLocation}
                                                    onChange={(_, d) => update("AutoRefreshWeatherLocation", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">使用无 TLS 请求获取天气数据以兼容老旧根证书系统</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.NoTLSWeatherRequests}
                                                    onChange={(_, d) => update("NoTLSWeatherRequests", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 功能与系统 -> 自动化 */}
                                    {activeTab === "automation" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">功能与系统 · 自动化工作流引擎</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用自动化工作流引擎</div>
                                                    <div className="settings-item-hint">开启后客户端将按照当前自动化方案响应上下课、全屏、天气预警等触发器</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsAutomationEnabled !== false}
                                                    onChange={(_, d) => update("IsAutomationEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="form-group mt-16">
                                                <label className="form-label">当前自动化配置方案名称</label>
                                                <Input
                                                    value={settings.CurrentAutomationConfig ?? "Default"}
                                                    onChange={(_, d) => update("CurrentAutomationConfig", d.value)}
                                                    placeholder="Default"
                                                    style={{ width: "100%" }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 功能与系统 -> 更新 */}
                                    {activeTab === "update" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">功能与系统 · 应用自动更新策略</div>
                                            <div className="form-group">
                                                <label className="form-label">客户端应用更新模式</label>
                                                <Select
                                                    value={String(settings.UpdateMode ?? 0)}
                                                    onChange={(_, d) => update("UpdateMode", parseInt(d.value, 10))}
                                                    style={{ width: "100%" }}
                                                >
                                                    <option value={0}>不自动检查更新</option>
                                                    <option value={1}>自动检查更新并通知</option>
                                                    <option value={2}>自动检查并下载更新</option>
                                                    <option value={3}>自动下载并在重启时安装</option>
                                                </Select>
                                            </div>
                                        </div>
                                    )}

                                    {/* 功能与系统 -> 插件 */}
                                    {activeTab === "plugins" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">功能与系统 · 插件与插件市场管理</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">自动更新已安装插件</div>
                                                </div>
                                                <Switch
                                                    checked={settings.IsPluginsAutoUpdateEnabled !== false}
                                                    onChange={(_, d) => update("IsPluginsAutoUpdateEnabled", d.checked)}
                                                />
                                            </div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">自动禁用导致崩溃的损坏插件</div>
                                                </div>
                                                <Switch
                                                    checked={settings.AutoDisableCorruptPlugins !== false}
                                                    onChange={(_, d) => update("AutoDisableCorruptPlugins", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 功能与系统 -> 调试 */}
                                    {activeTab === "debug" && (
                                        <div className="settings-section">
                                            <div className="settings-section-title">功能与系统 · 调试与开发者选项</div>
                                            <div className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">启用调试模式</div>
                                                    <div className="settings-item-hint">开启调试菜单、诊断浮层与详细日志输出</div>
                                                </div>
                                                <Switch
                                                    checked={!!settings.IsDebugEnabled}
                                                    onChange={(_, d) => update("IsDebugEnabled", d.checked)}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showCreate && (
                <Dialog open onOpenChange={() => setShowCreate(false)}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>新建默认设置文件</DialogTitle>
                            <DialogContent>
                                <div className="form-group">
                                    <label className="form-label">文件名</label>
                                    <Input
                                        value={newFileName}
                                        onChange={(_, d) => setNewFileName(d.value)}
                                        placeholder="如 default"
                                        style={{ width: "100%" }}
                                    />
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setShowCreate(false)}>取消</Button>
                                <Button appearance="primary" onClick={handleCreateFile} disabled={!newFileName.trim()}>创建</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
