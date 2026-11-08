"use client";

import React, { useState, useEffect, useCallback } from "react";
import { pairing, data, accounts } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    PairingCodeOut,
    RegistrationMode,
    ClientProfileConfig,
    ResourceType,
} from "@/lib/types";
import {
    REGISTRATION_MODE_LABELS,
    RESOURCE_TYPES,
    RESOURCE_TYPE_LABELS,
} from "@/lib/types";
import {
    Button, Spinner,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Checkmark24Regular, Dismiss24Regular, ArrowSync24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";

export default function PairingPage() {
    const { accountId, currentAccount } = useAccount();
    const [codes, setCodes] = useState<PairingCodeOut[]>([]);
    const [regMode, setRegMode] = useState<RegistrationMode>("pairing");
    const [loading, setLoading] = useState(true);
    const [savingMode, setSavingMode] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // 审批并指定初始档案弹窗
    const [approvingItem, setApprovingItem] = useState<PairingCodeOut | null>(null);
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
            const [codeList, statusRes] = await Promise.all([
                pairing.listCodes(accountId),
                pairing.getStatus(accountId),
            ]);
            setCodes(Array.isArray(codeList) ? codeList : []);
            if (statusRes?.registration_mode) {
                setRegMode(statusRes.registration_mode);
            }
        } catch {
            /* ignore */
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
                    const list = await data.list(accountId, rt);
                    nextOpts[rt] = Array.isArray(list) ? list : [];
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

    async function handleModeChange(nextMode: RegistrationMode) {
        setSavingMode(true);
        try {
            await pairing.setMode(accountId, nextMode);
            setRegMode(nextMode);
            setMsg({ type: "success", text: `设备接入策略已切换为：${REGISTRATION_MODE_LABELS[nextMode]}` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "修改接入策略失败" });
        }
        setSavingMode(false);
    }

    function openApproveDialog(item: PairingCodeOut) {
        setApprovingItem(item);
        setPresetProfile({});
    }

    async function handleConfirmApprove() {
        if (!approvingItem) return;
        try {
            const hasCustom = Object.values(presetProfile).some((v) => v && v.trim() !== "");
            await pairing.approve(accountId, approvingItem.id, hasCustom ? presetProfile : undefined);
            setMsg({ type: "success", text: `配对码 ${approvingItem.code} 已批准` });
            setApprovingItem(null);
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "审批失败" });
        }
    }

    async function handleReject(pairingId: string) {
        if (!confirm("确定要拒绝此配对请求吗？")) return;
        try {
            await pairing.reject(accountId, pairingId);
            setMsg({ type: "success", text: "配对请求已拒绝" });
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "操作失败" });
        }
    }

    const slugName = currentAccount?.slug || "account";

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">配对码与接入审批</h1>
                    <p className="page-subtitle">配置账户终端接入安全策略，并审批新终端的配对请求</p>
                </div>
                <div className="flex gap-8">
                    <DownloadPresetPopoverButton
                        buttonText="下载通用配置"
                        appearance="secondary"
                        defaultFileName={`ManagementPreset-${slugName}-generic.json`}
                        onFetchData={() => accounts.downloadPreset(accountId)}
                        onError={(text) => setMsg({ type: "error", text })}
                    />
                    <Button appearance="secondary" icon={<ArrowSync24Regular />} onClick={loadData}>
                        刷新列表
                    </Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            {/* 终端接入策略切换卡片 */}
            <div className="card">
                <div className="card-title">终端接入安全策略</div>
                <div className="flex items-center justify-between" style={{ gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                            决定新 ClassIsland 客户端首次连接本账户 gRPC 注册服务时的准入规则。无论选择何种模式，只要设备已在「预注册客户端」白名单中匹配（班级标识或物理 MAC），均可直接放行并自动绑定预设档案。
                        </p>
                    </div>
                    <div className="flex items-center gap-8">
                        <Select
                            value={regMode}
                            disabled={savingMode}
                            onChange={(_, d) => handleModeChange(d.value as RegistrationMode)}
                            style={{ minWidth: 280 }}
                        >
                            {(Object.keys(REGISTRATION_MODE_LABELS) as RegistrationMode[]).map((m) => (
                                <option key={m} value={m}>{REGISTRATION_MODE_LABELS[m]}</option>
                            ))}
                        </Select>
                    </div>
                </div>
            </div>

            {/* 配对码列表 */}
            <div className="card">
                <div className="card-title">配对请求列表</div>
                {loading ? (
                    <div className="empty-state"><Spinner size="medium" /></div>
                ) : codes.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-text">暂无配对请求记录</div>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>6位配对码</th>
                                <th>请求班级标识</th>
                                <th>客户端 UID</th>
                                <th>物理 MAC / IP</th>
                                <th>状态</th>
                                <th>请求时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {codes.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        <span className="badge badge-info" style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
                                            {c.code}
                                        </span>
                                    </td>
                                    <td style={{ fontWeight: 500 }}>{c.client_id || "-"}</td>
                                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.client_uid || "-"}</td>
                                    <td style={{ fontSize: 12 }}>
                                        <div>MAC: {c.client_mac || "-"}</div>
                                        <div style={{ color: "var(--text-secondary)" }}>IP: {c.client_ip || "-"}</div>
                                    </td>
                                    <td>
                                        {c.status === "rejected" ? (
                                            <span className="badge badge-danger">已拒绝</span>
                                        ) : c.used ? (
                                            <span className="badge badge-info">已完成注册</span>
                                        ) : c.approved ? (
                                            <span className="badge badge-success">已批准</span>
                                        ) : (
                                            <span className="badge badge-warning">待管理员审批</span>
                                        )}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {c.created_at ? new Date(c.created_at).toLocaleString("zh-CN") : "-"}
                                    </td>
                                    <td>
                                        <div className="flex gap-4">
                                            {!c.approved && !c.used && c.status !== "rejected" && (
                                                <Button
                                                    appearance="primary"
                                                    size="small"
                                                    icon={<Checkmark24Regular />}
                                                    onClick={() => openApproveDialog(c)}
                                                >
                                                    批准并配发档案
                                                </Button>
                                            )}
                                            {!c.used && c.status !== "rejected" && (
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    icon={<Dismiss24Regular />}
                                                    onClick={() => handleReject(c.id)}
                                                    style={{ color: "var(--danger-color)" }}
                                                >
                                                    拒绝
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* 审批并分配预设档案对话框 */}
            {approvingItem && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setApprovingItem(null); }}>
                    <DialogSurface style={{ minWidth: 520 }}>
                        <DialogBody>
                            <DialogTitle>批准配对请求 — 配对码 {approvingItem.code}</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    批准客户端 <strong>{approvingItem.client_id || approvingItem.client_uid}</strong> 接入。您可在此预先为其指定专属档案（留空则默认继承账户全局配置）：
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
                                <Button appearance="secondary" onClick={() => setApprovingItem(null)}>取消</Button>
                                <Button appearance="primary" onClick={handleConfirmApprove}>
                                    确认批准
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
