"use client";

import React, { useState, useEffect, useCallback } from "react";
import { preRegistration, data, accounts } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    PreRegOut,
    PreRegCreate,
    ClientProfileConfig,
    ResourceType,
} from "@/lib/types";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "@/lib/types";
import {
    Button, Input, Spinner, Switch, Textarea,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Add24Regular, Delete24Regular,
    Edit24Regular, Settings24Regular, DocumentAdd24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";

export default function PreRegistrationPage() {
    const { accountId, currentAccount } = useAccount();
    const [list, setList] = useState<PreRegOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // 新增预注册对话框
    const [dialogOpen, setDialogOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState<PreRegCreate>({
        label: "",
        class_identity: "",
        mac_address: "",
    });

    // 批量导入对话框
    const [batchOpen, setBatchOpen] = useState(false);
    const [batchText, setBatchText] = useState("");
    const [batchSaving, setBatchSaving] = useState(false);

    // 编辑预注册信息对话框
    const [editingItem, setEditingItem] = useState<PreRegOut | null>(null);
    const [editLabel, setEditLabel] = useState("");
    const [editIdentity, setEditIdentity] = useState("");
    const [editMac, setEditMac] = useState("");

    // 预设档案绑定对话框
    const [configItem, setConfigItem] = useState<PreRegOut | null>(null);
    const [presetProfile, setPresetProfile] = useState<ClientProfileConfig>({});
    const [resourceOptions, setResourceOptions] = useState<Record<ResourceType, string[]>>({
        Subjects: [],
        TimeLayout: [],
        ClassPlan: [],
        Policy: [],
        Credentials: [],
        Components: [],
        DefaultSettings: [],
    });

    const loadData = useCallback(async () => {
        if (!accountId) return;
        setLoading(true);
        try {
            setList(await preRegistration.list(accountId));
        } catch {
            setList([]);
        }
        setLoading(false);
    }, [accountId]);

    const loadResources = useCallback(async () => {
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
                    const r = await data.list(accountId, rt);
                    nextOpts[rt] = Array.isArray(r) ? r : [];
                } catch {
                    nextOpts[rt] = [];
                }
            })
        );
        setResourceOptions(nextOpts);
    }, [accountId]);

    useEffect(() => {
        loadData();
        loadResources();
    }, [loadData, loadResources]);

    async function handleCreate() {
        if (!form.label.trim() || (!form.class_identity.trim() && !form.mac_address?.trim())) return;
        setCreating(true);
        try {
            await preRegistration.create(accountId, {
                label: form.label.trim(),
                class_identity: form.class_identity.trim(),
                mac_address: form.mac_address?.trim() || "",
            });
            setMsg({ type: "success", text: "预注册客户端已创建" });
            setDialogOpen(false);
            setForm({ label: "", class_identity: "", mac_address: "" });
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
        setCreating(false);
    }

    async function handleBatchCreate() {
        const lines = batchText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length === 0) return;

        const items: PreRegCreate[] = [];
        for (const line of lines) {
            const parts = line.split(",").map((p) => p.trim());
            if (parts.length >= 2 && parts[0] && (parts[1] || parts[2])) {
                items.push({
                    label: parts[0],
                    class_identity: parts[1] || "",
                    mac_address: parts[2] || "",
                });
            }
        }
        if (items.length === 0) {
            setMsg({ type: "error", text: "格式错误，请按「标签名称,班级标识,MAC地址(可选)」每行一条输入" });
            return;
        }
        setBatchSaving(true);
        try {
            const created = await preRegistration.batchCreate(accountId, items);
            setMsg({ type: "success", text: `成功批量导入 ${created.length} 台预注册设备` });
            setBatchOpen(false);
            setBatchText("");
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "批量导入失败" });
        }
        setBatchSaving(false);
    }

    async function handleSaveEdit() {
        if (!editingItem) return;
        try {
            await preRegistration.rename(accountId, editingItem.id, {
                label: editLabel.trim(),
                class_identity: editIdentity.trim(),
                mac_address: editMac.trim(),
            });
            setMsg({ type: "success", text: "预注册信息已更新" });
            setEditingItem(null);
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "更新失败" });
        }
    }

    async function handleToggleEnable(item: PreRegOut) {
        try {
            if (item.is_enabled === false) {
                await preRegistration.enable(accountId, item.id);
                setMsg({ type: "success", text: `已启用预注册项 ${item.label}` });
            } else {
                await preRegistration.disable(accountId, item.id);
                setMsg({ type: "success", text: `已禁用预注册项 ${item.label}` });
            }
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "操作失败" });
        }
    }

    async function handleSavePresetProfile() {
        if (!configItem) return;
        try {
            await preRegistration.config(accountId, configItem.id, presetProfile);
            setMsg({ type: "success", text: "预设档案配置已保存" });
            setConfigItem(null);
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
        }
    }

    async function handleDelete(preRegId: string) {
        if (!confirm("确定要删除此预注册客户端吗？")) return;
        try {
            await preRegistration.delete(accountId, preRegId);
            setMsg({ type: "success", text: "已删除" });
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    const slugName = currentAccount?.slug || "account";

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">预注册客户端</h1>
                    <p className="page-subtitle">
                        预先登记班级标识与物理 MAC 白名单、分配预设档案并生成免配对引导文件 ManagementPreset.json
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
                    <Button appearance="secondary" icon={<DocumentAdd24Regular />} onClick={() => setBatchOpen(true)}>
                        批量导入
                    </Button>
                    <Button appearance="primary" icon={<Add24Regular />} onClick={() => setDialogOpen(true)}>
                        新增预注册
                    </Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="card">
                {loading ? (
                    <div className="empty-state"><Spinner size="medium" /></div>
                ) : list.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-text">暂无预注册客户端</div>
                        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>
                            点击「新增预注册」或「批量导入」添加客户端白名单
                        </p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>标签名称</th>
                                <th>班级标识</th>
                                <th>绑定 MAC 地址</th>
                                <th>状态 / 已关联终端</th>
                                <th>预设档案</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((item) => (
                                <tr key={item.id}>
                                    <td style={{ fontWeight: 600 }}>{item.label}</td>
                                    <td>{item.class_identity}</td>
                                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                        {item.mac_address || "不限 MAC"}
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-8">
                                            <Switch
                                                checked={item.is_enabled !== false}
                                                onChange={() => handleToggleEnable(item)}
                                            />
                                            {item.bound_client_uid ? (
                                                <span className="badge badge-success" title={item.bound_client_uid}>
                                                    已接入
                                                </span>
                                            ) : (
                                                <span className="badge badge-info">待终端接入</span>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        {item.preset_profile && Object.keys(item.preset_profile).length > 0 ? (
                                            <span className="badge badge-info">已配置专属档案</span>
                                        ) : (
                                            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>账户默认</span>
                                        )}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {new Date(item.created_at).toLocaleString("zh-CN")}
                                    </td>
                                    <td>
                                        <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
                                            <DownloadPresetPopoverButton
                                                buttonText="下载引导配置"
                                                appearance="subtle"
                                                size="small"
                                                defaultFileName={`ManagementPreset-${slugName}-${item.class_identity || item.label || item.id.slice(0, 6)}.json`}
                                                onFetchData={() => preRegistration.downloadPreset(accountId, item.id)}
                                                onError={(text) => setMsg({ type: "error", text })}
                                            />
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<Settings24Regular />}
                                                onClick={() => {
                                                    setConfigItem(item);
                                                    setPresetProfile(item.preset_profile || {});
                                                }}
                                            >
                                                预设档案
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<Edit24Regular />}
                                                onClick={() => {
                                                    setEditingItem(item);
                                                    setEditLabel(item.label);
                                                    setEditIdentity(item.class_identity);
                                                    setEditMac(item.mac_address || "");
                                                }}
                                            >
                                                编辑
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<Delete24Regular />}
                                                onClick={() => handleDelete(item.id)}
                                                style={{ color: "var(--danger-color)" }}
                                            >
                                                删除
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* 新增预注册对话框 */}
            <Dialog open={dialogOpen} onOpenChange={(_, d) => setDialogOpen(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>新增预注册客户端</DialogTitle>
                        <DialogContent>
                            <div style={{ display: "grid", gap: 16, paddingTop: 8 }}>
                                <div>
                                    <label className="form-label">标签名称</label>
                                    <Input
                                        placeholder="例如：高一(1)班讲台电脑"
                                        value={form.label}
                                        onChange={(_, d) => setForm((f) => ({ ...f, label: d.value }))}
                                        style={{ width: "100%" }}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">班级标识</label>
                                    <Input
                                        placeholder="例如：class-101"
                                        value={form.class_identity}
                                        onChange={(_, d) => setForm((f) => ({ ...f, class_identity: d.value }))}
                                        style={{ width: "100%" }}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">绑定物理 MAC 地址（可选）</label>
                                    <Input
                                        placeholder="例如：AA-BB-CC-DD-EE-FF"
                                        value={form.mac_address || ""}
                                        onChange={(_, d) => setForm((f) => ({ ...f, mac_address: d.value }))}
                                        style={{ width: "100%" }}
                                    />
                                </div>
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setDialogOpen(false)}>取消</Button>
                            <Button
                                appearance="primary"
                                onClick={handleCreate}
                                disabled={creating || !form.label.trim() || (!form.class_identity.trim() && !form.mac_address?.trim())}
                            >
                                {creating ? <Spinner size="tiny" /> : "创建"}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* 批量导入对话框 */}
            <Dialog open={batchOpen} onOpenChange={(_, d) => setBatchOpen(d.open)}>
                <DialogSurface style={{ minWidth: 520 }}>
                    <DialogBody>
                        <DialogTitle>批量导入预注册客户端</DialogTitle>
                        <DialogContent>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                                每行输入一条记录，格式为：<strong>标签名称,班级标识,MAC地址(可选)</strong>
                            </p>
                            <Textarea
                                rows={8}
                                value={batchText}
                                onChange={(_, d) => setBatchText(d.value)}
                                placeholder={"高一1班,class-101,AA-BB-CC-DD-EE-01\n高一2班,class-102,AA-BB-CC-DD-EE-02\n高一3班,class-103"}
                                style={{ width: "100%" }}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setBatchOpen(false)}>取消</Button>
                            <Button appearance="primary" onClick={handleBatchCreate} disabled={batchSaving || !batchText.trim()}>
                                {batchSaving ? <Spinner size="tiny" /> : "开始导入"}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* 编辑对话框 */}
            {editingItem && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setEditingItem(null); }}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>编辑预注册客户端</DialogTitle>
                            <DialogContent>
                                <div style={{ display: "grid", gap: 16, paddingTop: 8 }}>
                                    <div>
                                        <label className="form-label">标签名称</label>
                                        <Input value={editLabel} onChange={(_, d) => setEditLabel(d.value)} style={{ width: "100%" }} />
                                    </div>
                                    <div>
                                        <label className="form-label">班级标识</label>
                                        <Input value={editIdentity} onChange={(_, d) => setEditIdentity(d.value)} style={{ width: "100%" }} />
                                    </div>
                                    <div>
                                        <label className="form-label">物理 MAC 地址（可选）</label>
                                        <Input value={editMac} onChange={(_, d) => setEditMac(d.value)} style={{ width: "100%" }} />
                                    </div>
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setEditingItem(null)}>取消</Button>
                                <Button appearance="primary" onClick={handleSaveEdit}>保存修改</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 预设档案配置对话框 */}
            {configItem && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setConfigItem(null); }}>
                    <DialogSurface style={{ minWidth: 520 }}>
                        <DialogBody>
                            <DialogTitle>预设下发档案 — {configItem.label}</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    当终端以此预注册身份接入集控时，将自动为其绑定以下 7 类资源档案（留空则继承账户默认配置）：
                                </p>
                                <div className="grid-2">
                                    {RESOURCE_TYPES.map((rt) => (
                                        <div key={rt} className="form-group">
                                            <label className="form-label">{RESOURCE_TYPE_LABELS[rt]}</label>
                                            <Select
                                                value={presetProfile[rt] ?? ""}
                                                onChange={(_, d) =>
                                                    setPresetProfile((prev) => ({ ...prev, [rt]: d.value }))
                                                }
                                                style={{ width: "100%" }}
                                            >
                                                <option value="">-- 跟随账户默认 --</option>
                                                {resourceOptions[rt].map((name) => (
                                                    <option key={name} value={name}>{name}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setConfigItem(null)}>取消</Button>
                                <Button appearance="primary" onClick={handleSavePresetProfile}>保存预设档案</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
