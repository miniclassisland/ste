"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { ManagementPolicy } from "@/lib/types";
import {
    Button, Switch, Spinner,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Input,
} from "@fluentui/react-components";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular, Code24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

const POLICY_FIELDS: { key: keyof ManagementPolicy; label: string; hint: string }[] = [
    { key: "DisableProfileClassPlanEditing", label: "禁止编辑课表", hint: "阻止客户端本地用户修改课表与临时换课" },
    { key: "DisableProfileTimeLayoutEditing", label: "禁止编辑时间表", hint: "阻止客户端本地用户修改时间表节点" },
    { key: "DisableProfileSubjectsEditing", label: "禁止编辑科目", hint: "阻止客户端本地用户增删改科目列表" },
    { key: "DisableProfileEditing", label: "禁止编辑全部档案", hint: "完全锁定客户端档案编辑器" },
    { key: "DisableSettingsEditing", label: "禁止修改应用设置", hint: "阻止客户端本地用户修改应用设置页面" },
    { key: "DisableSplashCustomize", label: "禁止自定义启动画面", hint: "阻止客户端本地用户修改启动图与标语" },
    { key: "DisableDebugMenu", label: "禁止使用调试菜单", hint: "隐藏客户端开发者调试入口" },
    { key: "AllowExitManagement", label: "允许退出集控", hint: "是否允许终端用户在客户端设置中主动脱离集控管理" },
    { key: "DisableEasterEggs", label: "禁用彩蛋功能", hint: "关闭客户端内的趣味彩蛋功能" },
];

export default function PolicyPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [policy, setPolicy] = useState<ManagementPolicy>({});
    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
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
            const content = await data.read(accountId, "Policy", name);
            const parsed = (content as ManagementPolicy) || {};
            setPolicy(parsed);
            setJsonText(JSON.stringify(parsed, null, 2));
        } catch {
            setPolicy({});
            setJsonText("{}");
        }
        setDataLoading(false);
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const list = await data.list(accountId, "Policy");
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
            let payload = policy;
            if (jsonMode) {
                payload = JSON.parse(jsonText) as ManagementPolicy;
                setPolicy(payload);
            } else {
                setJsonText(JSON.stringify(policy, null, 2));
            }
            await data.write(accountId, "Policy", selectedFile, payload);
            setMsg({ type: "success", text: "策略配置已保存并递增版本号" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
        setSaving(false);
    }

    async function handleCreateFile(e: React.FormEvent) {
        e.preventDefault();
        const name = newFileName.trim();
        if (!name) return;
        try {
            await data.create(accountId, "Policy", name);
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
            await data.deleteData(accountId, "Policy", name);
            if (selectedFile === name) setSelectedFile(null);
            await loadFiles();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">策略管理</h1>
                    <p className="page-subtitle">管理 ClassIsland 客户端安全限制策略</p>
                </div>
                <div className="flex gap-8">
                    <Button appearance="primary" icon={<Add24Regular />} onClick={() => setShowCreate(true)}>新建文件</Button>
                    <Button appearance="secondary" icon={<ArrowSync24Regular />} onClick={loadFiles}>刷新</Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="profile-split-layout">
                <div className="profile-split-sidebar">
                    <div className="card">
                        <div className="card-title">策略文件</div>
                        {loading ? (
                            <Spinner size="small" />
                        ) : (
                            fileList.map((f) => (
                                <div
                                    key={f}
                                    className={`sidebar-link ${selectedFile === f ? "active" : ""}`}
                                    onClick={() => selectFile(f)}
                                >
                                    <span style={{ flex: 1 }}>{f}</span>
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

                <div style={{ flex: 1 }}>
                    {!selectedFile ? (
                        <div className="card"><div className="empty-state"><div className="empty-state-text">请选择策略文件</div></div></div>
                    ) : dataLoading ? (
                        <div className="card"><div className="empty-state"><Spinner size="medium" /></div></div>
                    ) : (
                        <div className="card">
                            <div className="flex items-center justify-between mb-16">
                                <div className="card-title" style={{ margin: 0 }}>编辑策略: {selectedFile}</div>
                                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                    <FileHistoryButton
                                        accountId={accountId}
                                        resourceType="Policy"
                                        fileName={selectedFile}
                                        onLoadVersion={(content, version, isCurrent) => {
                                            const parsed = (content as ManagementPolicy) || {};
                                            setPolicy(parsed);
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
                                        defaultFileName={`Policy-${selectedFile}.json`}
                                        suggestedNames={[
                                            { label: "具名区分文件", fileName: `Policy-${selectedFile}.json` },
                                            { label: "档案原名", fileName: `${selectedFile}.json` },
                                            { label: "客户端标准资源名", fileName: "Policy.json" },
                                        ]}
                                        onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : policy)}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <Button
                                        appearance="subtle"
                                        icon={<Code24Regular />}
                                        onClick={() => {
                                            if (!jsonMode) setJsonText(JSON.stringify(policy, null, 2));
                                            else {
                                                try { setPolicy(JSON.parse(jsonText)); } catch { /* ignore */ }
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
                                    <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} style={{ minHeight: 360 }} />
                                </div>
                            ) : (
                                POLICY_FIELDS.map(({ key, label, hint }) => (
                                    <div key={key} className="settings-item">
                                        <div className="settings-item-info">
                                            <div className="settings-item-label">{label}</div>
                                            <div className="settings-item-hint">{hint}</div>
                                        </div>
                                        <Switch
                                            checked={!!policy[key]}
                                            onChange={(_, d) => {
                                                const next = { ...policy, [key]: d.checked };
                                                setPolicy(next);
                                                setJsonText(JSON.stringify(next, null, 2));
                                            }}
                                        />
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showCreate && (
                <Dialog open onOpenChange={() => setShowCreate(false)}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>新建策略文件</DialogTitle>
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
