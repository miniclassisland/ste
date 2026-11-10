"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { audit, clients } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { AuditLogItem, ClientDeviceOut } from "@/lib/types";
import { AUDIT_EVENT_LABELS } from "@/lib/types";
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
    ArrowSync24Regular, Delete24Regular, DocumentSearch24Regular,
    Search24Regular, Filter16Regular, ChevronLeft16Regular, ChevronRight16Regular,
} from "@fluentui/react-icons";

export default function AuditPage() {
    const { accountId } = useAccount();
    const [logs, setLogs] = useState<AuditLogItem[]>([]);
    const [devices, setDevices] = useState<ClientDeviceOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterClient, setFilterClient] = useState("");
    const [filterEvent, setFilterEvent] = useState("");
    const [pageSize, setPageSize] = useState<number>(20);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const loadData = useCallback(async () => {
        if (!accountId) return;
        setLoading(true);
        try {
            const [logRes, devRes] = await Promise.all([
                audit.list(accountId, {
                    client_uid: filterClient || undefined,
                    event_type: filterEvent !== "" ? Number(filterEvent) : undefined,
                    limit: 500,
                }),
                clients.list(accountId),
            ]);
            setLogs(Array.isArray(logRes) ? logRes : []);
            setDevices(Array.isArray(devRes) ? devRes : []);
        } catch {
            setLogs([]);
        }
        setLoading(false);
    }, [accountId, filterClient, filterEvent]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    async function handleClear() {
        try {
            await audit.clear(accountId, filterClient || undefined);
            setMsg({ type: "success", text: "审计日志已清空" });
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "清空失败" });
        }
    }

    const getDeviceLabel = useCallback((uid: string) => {
        const d = devices.find((item) => item.uid === uid);
        if (d) {
            return d.display_name || d.client_id || d.uid;
        }
        return uid;
    }, [devices]);

    function getAuditBadgeClass(eventType: number) {
        if (eventType === 2 || eventType === 9) return "badge-danger";
        if (eventType === 11 || eventType === 13) return "badge-warning";
        if (eventType === 1 || eventType === 10) return "badge-success";
        return "badge-info";
    }

    const filteredLogs = useMemo(() => {
        return logs.filter((item) =>
            matchAdvancedQuery(item, searchQuery, {
                fields: {
                    client: (l) => [l.client_uid, getDeviceLabel(l.client_uid)],
                    uid: (l) => l.client_uid,
                    event: (l) => [String(l.event_type), l.event_name, AUDIT_EVENT_LABELS[l.event_type] || ""],
                    id: (l) => String(l.id),
                },
                freeText: (l) => [
                    String(l.id),
                    l.client_uid,
                    getDeviceLabel(l.client_uid),
                    l.event_name,
                    AUDIT_EVENT_LABELS[l.event_type] || "",
                    JSON.stringify(l.decoded || {}),
                ],
            })
        );
    }, [logs, searchQuery, getDeviceLabel]);

    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const pagedLogs = filteredLogs.slice((safePage - 1) * pageSize, safePage * pageSize);

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">审计日志</h1>
                    <p className="page-subtitle">
                        查看各终端上报的授权验证、应用启停、异常崩溃、插件变更与换课记录
                    </p>
                </div>
                <div className="flex gap-8">
                    <Button appearance="secondary" icon={<ArrowSync24Regular />} onClick={loadData}>
                        刷新日志
                    </Button>
                    <ConfirmPopover
                        message="确定要清空当前筛选范围内的审计日志吗？"
                        onConfirm={handleClear}
                        confirmText="清空日志"
                        disabled={logs.length === 0}
                    >
                        <Button
                            appearance="subtle"
                            icon={<Delete24Regular />}
                            style={{ color: "var(--danger-color)" }}
                            disabled={logs.length === 0}
                        >
                            清空日志
                        </Button>
                    </ConfirmPopover>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="clients-main-pane">
                <div className="card" style={{ padding: "12px 16px", marginBottom: 0 }}>
                    <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                        <Input
                            placeholder="搜索终端、事件类型、载荷内容或高级过滤表达式"
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
                            <PopoverSurface style={{ padding: 12, width: 290 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600 }}>按终端筛选</div>
                                    <Select
                                        size="small"
                                        value={filterClient}
                                        onChange={(_, d) => {
                                            setFilterClient(d.value);
                                            setCurrentPage(1);
                                        }}
                                    >
                                        <option value="">全部终端设备</option>
                                        {devices.map((d) => (
                                            <option key={d.uid} value={d.uid}>
                                                {d.display_name || d.client_id || d.uid}
                                            </option>
                                        ))}
                                    </Select>

                                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>按事件类型</div>
                                    <Select
                                        size="small"
                                        value={filterEvent}
                                        onChange={(_, d) => {
                                            setFilterEvent(d.value);
                                            setCurrentPage(1);
                                        }}
                                    >
                                        <option value="">全部事件类型</option>
                                        {Object.entries(AUDIT_EVENT_LABELS).map(([code, label]) => (
                                            <option key={code} value={code}>{label}</option>
                                        ))}
                                    </Select>

                                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>快捷表达式</div>
                                    <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
                                        {[
                                            "event:1",
                                            "event:2",
                                            "event:9",
                                            "event:10",
                                            "event:11",
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
                                                setFilterClient("");
                                                setFilterEvent("");
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
                        <span>{logs.length}条审计日志</span>
                        <span>{filteredLogs.length}已筛选</span>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: 0, padding: 0, overflow: "hidden" }}>
                    {loading ? (
                        <div className="empty-state"><Spinner size="medium" /></div>
                    ) : pagedLogs.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-text">暂无符合筛选条件的审计日志记录</div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>终端设备</th>
                                    <th>事件类型</th>
                                    <th>载荷摘要</th>
                                    <th>上报时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagedLogs.map((item) => (
                                    <tr key={item.id}>
                                        <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>#{item.id}</td>
                                        <td style={{ fontWeight: 500 }}>{getDeviceLabel(item.client_uid)}</td>
                                        <td>
                                            <span className={`badge ${getAuditBadgeClass(item.event_type)}`}>
                                                {AUDIT_EVENT_LABELS[item.event_type] || item.event_name}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {Object.keys(item.decoded || {}).length > 0
                                                ? JSON.stringify(item.decoded)
                                                : "无附加载荷"}
                                        </td>
                                        <td style={{ fontSize: 12 }}>
                                            {item.logged_at ? new Date(item.logged_at).toLocaleString("zh-CN") : "-"}
                                        </td>
                                        <td>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<DocumentSearch24Regular />}
                                                onClick={() => setSelectedLog(item)}
                                            >
                                                详情
                                            </Button>
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

            {selectedLog && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setSelectedLog(null); }}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>
                                审计事件详情 #{selectedLog.id}
                            </DialogTitle>
                            <DialogContent>
                                <div style={{ display: "grid", gap: 8, marginBottom: 12, fontSize: 13 }}>
                                    <div><strong>终端 UID：</strong>{selectedLog.client_uid}</div>
                                    <div><strong>事件类型：</strong>{AUDIT_EVENT_LABELS[selectedLog.event_type] || selectedLog.event_name}</div>
                                    <div><strong>客户端时间戳：</strong>{selectedLog.timestamp_utc}</div>
                                    <div><strong>入库时间：</strong>{selectedLog.logged_at ? new Date(selectedLog.logged_at).toLocaleString("zh-CN") : "-"}</div>
                                </div>
                                <div className="json-editor">
                                    <textarea
                                        readOnly
                                        value={JSON.stringify(selectedLog.decoded || {}, null, 2)}
                                        style={{ minHeight: 180 }}
                                    />
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setSelectedLog(null)}>关闭</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
