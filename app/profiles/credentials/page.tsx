"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data, credentials as credApi } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { ManagementCredentialConfig, AuthorizeLevel } from "@/lib/types";
import { AUTHORIZE_LEVEL_LABELS } from "@/lib/types";
import {
    Button, Input, Spinner,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular,
    Key24Regular, Code24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

const AUTH_LEVEL_FIELDS: { key: keyof ManagementCredentialConfig; label: string; hint: string }[] = [
    { key: "EditAuthorizeSettingsAuthorizeLevel", label: "编辑授权设置", hint: "修改认证与授权配置所需的权限等级" },
    { key: "EditPolicyAuthorizeLevel", label: "编辑集控策略", hint: "修改限制策略所需的权限等级" },
    { key: "ExitManagementAuthorizeLevel", label: "退出集控管理", hint: "脱离集控管理模式所需的权限等级" },
    { key: "EditProfileAuthorizeLevel", label: "编辑本地档案", hint: "打开档案编辑器所需的权限等级" },
    { key: "EditSettingsAuthorizeLevel", label: "修改应用设置", hint: "进入应用设置页面所需的权限等级" },
    { key: "ExitApplicationAuthorizeLevel", label: "关闭/退出应用", hint: "退出或重启 ClassIsland 应用所需的权限等级" },
    { key: "EditComponentsAuthorizeLevel", label: "编辑组件布局", hint: "修改主界面组件配置所需的权限等级" },
    { key: "PluginManagementAuthorizeLevel", label: "管理插件市场", hint: "安装、启用或卸载插件所需的权限等级" },
    { key: "ChangeLessonsAuthorizeLevel", label: "临时换课操作", hint: "在主界面执行临时换课所需的权限等级" },
];

export default function CredentialsPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [cred, setCred] = useState<ManagementCredentialConfig>({});
    const [newUserPwd, setNewUserPwd] = useState("");
    const [newAdminPwd, setNewAdminPwd] = useState("");
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
        setNewUserPwd("");
        setNewAdminPwd("");
        try {
            const content = await data.read(accountId, "Credentials", name);
            const parsed = (content as ManagementCredentialConfig) || {};
            setCred(parsed);
            setJsonText(JSON.stringify(parsed, null, 2));
        } catch {
            setCred({});
            setJsonText("{}");
        }
        setDataLoading(false);
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const list = await data.list(accountId, "Credentials");
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

    async function handleEncodePassword(target: "UserCredential" | "AdminCredential", plain: string) {
        if (!plain.trim()) return;
        try {
            const res = await credApi.encode(accountId, plain.trim());
            const next = { ...cred, [target]: res.credential };
            setCred(next);
            setJsonText(JSON.stringify(next, null, 2));
            if (target === "UserCredential") setNewUserPwd("");
            else setNewAdminPwd("");
            setMsg({
                type: "success",
                text: `${target === "UserCredential" ? "用户" : "管理员"}密码已生成上游兼容 Salted SHA-256 凭据，请点击保存生效`,
            });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "密码编码失败" });
        }
    }

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave = { ...cred };
            if (jsonMode) {
                payloadToSave = JSON.parse(jsonText) as ManagementCredentialConfig;
            } else {
                // 如果输入框中填写了未点击生成的明文密码，也在保存时直接写入（后端会自动编码为 ClassIsland Credential）
                if (newUserPwd.trim()) {
                    const encoded = await credApi.encode(accountId, newUserPwd.trim());
                    payloadToSave.UserCredential = encoded.credential;
                    setNewUserPwd("");
                }
                if (newAdminPwd.trim()) {
                    const encoded = await credApi.encode(accountId, newAdminPwd.trim());
                    payloadToSave.AdminCredential = encoded.credential;
                    setNewAdminPwd("");
                }
            }
            await data.write(accountId, "Credentials", selectedFile, payloadToSave);
            setCred(payloadToSave);
            setJsonText(JSON.stringify(payloadToSave, null, 2));
            setMsg({ type: "success", text: "凭据配置已保存并递增版本号" });
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
            await data.create(accountId, "Credentials", name);
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
            await data.deleteData(accountId, "Credentials", name);
            if (selectedFile === name) setSelectedFile(null);
            await loadFiles();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    function update<K extends keyof ManagementCredentialConfig>(key: K, value: ManagementCredentialConfig[K]) {
        const next = { ...cred, [key]: value };
        setCred(next);
        setJsonText(JSON.stringify(next, null, 2));
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">凭据管理</h1>
                    <p className="page-subtitle">管理 ClassIsland 客户端密码凭据与敏感操作授权等级</p>
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
                        <div className="card-title">凭据文件</div>
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
                        <div className="card"><div className="empty-state"><div className="empty-state-text">请选择凭据文件</div></div></div>
                    ) : dataLoading ? (
                        <div className="card"><div className="empty-state"><Spinner size="medium" /></div></div>
                    ) : (
                        <div className="card">
                            <div className="flex items-center justify-between mb-16">
                                <div className="card-title" style={{ margin: 0 }}>编辑凭据: {selectedFile}</div>
                                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                    <FileHistoryButton
                                        accountId={accountId}
                                        resourceType="Credentials"
                                        fileName={selectedFile}
                                        onLoadVersion={(content, version, isCurrent) => {
                                            const parsed = (content as ManagementCredentialConfig) || {};
                                            setCred(parsed);
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
                                        defaultFileName={`Credentials-${selectedFile}.json`}
                                        suggestedNames={[
                                            { label: "具名区分文件", fileName: `Credentials-${selectedFile}.json` },
                                            { label: "档案原名", fileName: `${selectedFile}.json` },
                                            { label: "客户端标准资源名", fileName: "Credentials.json" },
                                        ]}
                                        onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : cred)}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <Button
                                        appearance="subtle"
                                        icon={<Code24Regular />}
                                        onClick={() => {
                                            if (!jsonMode) setJsonText(JSON.stringify(cred, null, 2));
                                            else {
                                                try { setCred(JSON.parse(jsonText)); } catch { /* ignore */ }
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
                                    <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} style={{ minHeight: 400 }} />
                                </div>
                            ) : (
                                <>
                                    <div className="settings-section">
                                        <div className="settings-section-title">客户端解锁密码凭据</div>
                                        <div className="grid-2">
                                            <div className="form-group">
                                                <div className="flex items-center justify-between mb-8">
                                                    <label className="form-label" style={{ margin: 0 }}>用户凭据</label>
                                                    <span className={`badge ${cred.UserCredential ? "badge-success" : "badge-warning"}`}>
                                                        {cred.UserCredential ? "已配置加密凭据" : "未设置密码"}
                                                    </span>
                                                </div>
                                                <div className="flex gap-8">
                                                    <Input
                                                        type="password"
                                                        value={newUserPwd}
                                                        onChange={(_, d) => setNewUserPwd(d.value)}
                                                        placeholder="输入新用户密码以覆盖..."
                                                        style={{ flex: 1 }}
                                                    />
                                                    <Button
                                                        appearance="secondary"
                                                        icon={<Key24Regular />}
                                                        disabled={!newUserPwd.trim()}
                                                        onClick={() => handleEncodePassword("UserCredential", newUserPwd)}
                                                    >
                                                        生成
                                                    </Button>
                                                    {cred.UserCredential && (
                                                        <Button
                                                            appearance="subtle"
                                                            onClick={() => update("UserCredential", "")}
                                                            style={{ color: "var(--danger-color)" }}
                                                        >
                                                            清除
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className="form-hint">用于「用户认证」等级操作时在终端验证</div>
                                            </div>

                                            <div className="form-group">
                                                <div className="flex items-center justify-between mb-8">
                                                    <label className="form-label" style={{ margin: 0 }}>管理员凭据</label>
                                                    <span className={`badge ${cred.AdminCredential ? "badge-success" : "badge-warning"}`}>
                                                        {cred.AdminCredential ? "已配置加密凭据" : "未设置密码"}
                                                    </span>
                                                </div>
                                                <div className="flex gap-8">
                                                    <Input
                                                        type="password"
                                                        value={newAdminPwd}
                                                        onChange={(_, d) => setNewAdminPwd(d.value)}
                                                        placeholder="输入新管理员密码以覆盖..."
                                                        style={{ flex: 1 }}
                                                    />
                                                    <Button
                                                        appearance="secondary"
                                                        icon={<Key24Regular />}
                                                        disabled={!newAdminPwd.trim()}
                                                        onClick={() => handleEncodePassword("AdminCredential", newAdminPwd)}
                                                    >
                                                        生成
                                                    </Button>
                                                    {cred.AdminCredential && (
                                                        <Button
                                                            appearance="subtle"
                                                            onClick={() => update("AdminCredential", "")}
                                                            style={{ color: "var(--danger-color)" }}
                                                        >
                                                            清除
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className="form-hint">用于「管理员认证」等级操作时在终端验证</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="settings-section">
                                        <div className="settings-section-title">各操作所需授权等级</div>
                                        {AUTH_LEVEL_FIELDS.map(({ key, label, hint }) => (
                                            <div key={key} className="settings-item">
                                                <div className="settings-item-info">
                                                    <div className="settings-item-label">{label}</div>
                                                    <div className="settings-item-hint">{hint}</div>
                                                </div>
                                                <Select
                                                    value={String((cred[key] as number) ?? 0)}
                                                    onChange={(_, d) => update(key, parseInt(d.value, 10) as AuthorizeLevel)}
                                                    style={{ minWidth: 180 }}
                                                >
                                                    {([0, 1, 2] as AuthorizeLevel[]).map((lv) => (
                                                        <option key={lv} value={lv}>{AUTHORIZE_LEVEL_LABELS[lv]}</option>
                                                    ))}
                                                </Select>
                                            </div>
                                        ))}
                                    </div>
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
                            <DialogTitle>新建凭据文件</DialogTitle>
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
