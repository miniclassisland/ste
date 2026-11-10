"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { matchAdvancedQuery } from "@/lib/search-engine";
import {
    Button, Spinner, Input,
    Popover, PopoverTrigger, PopoverSurface,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import { Select } from "@/components/CustomSelect";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import {
    Checkmark24Regular, Dismiss24Regular, ArrowSync24Regular,
    Search24Regular, Filter16Regular, ChevronLeft16Regular, ChevronRight16Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";

function getPairingStatusCode(c: PairingCodeOut): "pending" | "approved" | "used" | "rejected" {
    if (c.status === "rejected") return "rejected";
    if (c.used) return "used";
    if (c.approved) return "approved";
    return "pending";
}

export default function PairingPage() {
    const { accountId, currentAccount } = useAccount();
    const [codes, setCodes] = useState<PairingCodeOut[]>([]);
    const [regMode, setRegMode] = useState<RegistrationMode>("pairing");
    const [loading, setLoading] = useState(true);
    const [savingMode, setSavingMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "used" | "rejected">("all");
    const [pageSize, setPageSize] = useState<number>(20);
    const [currentPage, setCurrentPage] = useState<number>(1);
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
        try {
            await pairing.reject(accountId, pairingId);
            setMsg({ type: "success", text: "配对请求已拒绝" });
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "操作失败" });
        }
    }

    const filteredCodes = useMemo(() => {
        return codes.filter((c) => {
            const st = getPairingStatusCode(c);
            if (statusFilter !== "all" && st !== statusFilter) return false;
            return matchAdvancedQuery(c, searchQuery, {
                fields: {
                    status: (item) => getPairingStatusCode(item),
                    code: (item) => item.code,
                    id: (item) => item.client_id || "",
                    uid: (item) => item.client_uid || "",
                    mac: (item) => item.client_mac || "",
                    ip: (item) => item.client_ip || "",
                },
                freeText: (item) => [
                    item.code,
                    item.client_id,
                    item.client_uid,
                    item.client_mac,
                    item.client_ip,
                    getPairingStatusCode(item),
                ],
            });
        });
    }, [codes, statusFilter, searchQuery]);

    const totalPages = Math.max(1, Math.ceil(filteredCodes.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const pagedCodes = filteredCodes.slice((safePage - 1) * pageSize, safePage * pageSize);

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
                            决定新终端首次连接本账户时的准入规则。无论选择何种模式，只要设备已在预注册客户端白名单中匹配班级标识或物理网卡地址，均可直接放行并自动绑定预设档案。
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
            <div className="clients-main-pane">
                <div className="card" style={{ padding: "12px 16px", marginBottom: 0 }}>
                    <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                        <Input
                            placeholder="搜索配对码、班级标识、设备标识、网络地址或高级过滤表达式"
                            value={searchQuery}
                            onChange={(_, d) => {
                                setSearchQuery(d.value);
                                setCurrentPage(1);
                            }}
                            contentBefore={<Search24Regular />}
                            style={{ flex: 1, minWidth: 240, fontFamily: "var(--font-mono)" }}
                        />

                        <Popover withArrow positioning="below-end">
                            <PopoverTrigger disableButtonEnhancement>
                                <Button appearance="outline" icon={<Filter16Regular />}>
                                    筛选
                                </Button>
                            </PopoverTrigger>
                            <PopoverSurface style={{ padding: 12, width: 280 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600 }}>状态快速过滤</div>
                                    <Select
                                        size="small"
                                        value={statusFilter}
                                        onChange={(_, d) => {
                                            setStatusFilter(d.value as typeof statusFilter);
                                            setCurrentPage(1);
                                        }}
                                    >
                                        <option value="all">全部请求</option>
                                        <option value="pending">待管理员审批</option>
                                        <option value="approved">已批准</option>
                                        <option value="used">已完成注册</option>
                                        <option value="rejected">已拒绝</option>
                                    </Select>

                                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>快捷表达式</div>
                                    <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
                                        {[
                                            "status:pending",
                                            "status:approved",
                                            "status:used",
                                            "status:rejected",
                                        ].map((expr) => (
                                            <Button
                                                key={expr}
                                                size="small"
                                                appearance="secondary"
                                                onClick={() => {
                                                    setSearchQuery((prev) => `${prev} ${expr}`.trim());
                                                    setCurrentPage(1);
                                                }}
                                            >
                                                {expr}
                                            </Button>
                                        ))}
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            onClick={() => {
                                                setSearchQuery("");
                                                setStatusFilter("all");
                                                setCurrentPage(1);
                                            }}
                                        >
                                            重置
                                        </Button>
                                    </div>
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
                        <span>{codes.length}个配对请求</span>
                        <span>{filteredCodes.length}已筛选</span>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
                    {loading ? (
                        <div className="empty-state"><Spinner size="medium" /></div>
                    ) : pagedCodes.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-text">暂无符合筛选条件的配对请求记录</div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>6位配对码</th>
                                    <th>请求班级标识</th>
                                    <th>设备标识码</th>
                                    <th>网络地址</th>
                                    <th>状态</th>
                                    <th>请求时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagedCodes.map((c) => (
                                    <tr key={c.id}>
                                        <td>
                                            <span className="badge badge-info" style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
                                                {c.code}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 500 }}>{c.client_id || "-"}</td>
                                        <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.client_uid || "-"}</td>
                                        <td style={{ fontSize: 12 }}>
                                            <div>物理地址: {c.client_mac || "-"}</div>
                                            <div style={{ color: "var(--text-secondary)" }}>网络地址: {c.client_ip || "-"}</div>
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
                                                    <ConfirmPopover
                                                        message="确定要拒绝此配对请求吗？"
                                                        onConfirm={() => handleReject(c.id)}
                                                        confirmText="拒绝"
                                                    >
                                                        <Button
                                                            appearance="subtle"
                                                            size="small"
                                                            icon={<Dismiss24Regular />}
                                                            style={{ color: "var(--danger-color)" }}
                                                        >
                                                            拒绝
                                                        </Button>
                                                    </ConfirmPopover>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

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

            {/* 审批并分配预设档案对话框 */}
            {approvingItem && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setApprovingItem(null); }}>
                    <DialogSurface style={{ minWidth: 520 }}>
                        <DialogBody>
                            <DialogTitle>批准配对请求 — 配对码 {approvingItem.code}</DialogTitle>
                            <DialogContent>
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                                    批准客户端 <strong>{approvingItem.client_id || approvingItem.client_uid}</strong> 接入。您可在此预先为其指定专属档案，留空则默认继承账户全局配置：
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
