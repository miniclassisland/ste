"use client";

import React, { useState, useEffect, useCallback } from "react";
import { audit, clients } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { AuditLogItem, ClientDeviceOut } from "@/lib/types";
import { AUDIT_EVENT_LABELS } from "@/lib/types";
import {
    Button, Spinner,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    ArrowSync24Regular, Delete24Regular, DocumentSearch24Regular,
} from "@fluentui/react-icons";

export default function AuditPage() {
    const { accountId } = useAccount();
    const [logs, setLogs] = useState<AuditLogItem[]>([]);
    const [devices, setDevices] = useState<ClientDeviceOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterClient, setFilterClient] = useState("");
    const [filterEvent, setFilterEvent] = useState("");
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
                    limit: 200,
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
        if (!confirm("确定要清空当前筛选范围内的审计日志吗？")) return;
        try {
            await audit.clear(accountId, filterClient || undefined);
            setMsg({ type: "success", text: "审计日志已清空" });
            loadData();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "清空失败" });
        }
    }

    function getDeviceLabel(uid: string) {
        const d = devices.find((item) => item.uid === uid);
        if (d) {
            return d.display_name || d.client_id || d.uid;
        }
        return uid;
    }

    function getAuditBadgeClass(eventType: number) {
        if (eventType === 2 || eventType === 9) return "badge-danger";
        if (eventType === 11 || eventType === 13) return "badge-warning";
        if (eventType === 1 || eventType === 10) return "badge-success";
        return "badge-info";
    }

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
                    <Button
                        appearance="subtle"
                        icon={<Delete24Regular />}
                        style={{ color: "var(--danger-color)" }}
                        onClick={handleClear}
                        disabled={logs.length === 0}
                    >
                        清空日志
                    </Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="card" style={{ padding: "14px 20px" }}>
                <div className="flex items-center gap-16" style={{ flexWrap: "wrap" }}>
                    <div className="flex items-center gap-8">
                        <span style={{ fontSize: 13, fontWeight: 500 }}>按终端筛选：</span>
                        <Select
                            value={filterClient}
                            onChange={(_, d) => setFilterClient(d.value)}
                            style={{ minWidth: 220 }}
                        >
                            <option value="">全部终端设备</option>
                            {devices.map((d) => (
                                <option key={d.uid} value={d.uid}>
                                    {d.display_name || d.client_id || d.uid}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="flex items-center gap-8">
                        <span style={{ fontSize: 13, fontWeight: 500 }}>按事件类型：</span>
                        <Select
                            value={filterEvent}
                            onChange={(_, d) => setFilterEvent(d.value)}
                            style={{ minWidth: 220 }}
                        >
                            <option value="">全部事件类型</option>
                            {Object.entries(AUDIT_EVENT_LABELS).map(([code, label]) => (
                                <option key={code} value={code}>{label}</option>
                            ))}
                        </Select>
                    </div>
                </div>
            </div>

            <div className="card">
                {loading ? (
                    <div className="empty-state"><Spinner size="medium" /></div>
                ) : logs.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-text">暂无审计日志记录</div>
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
                            {logs.map((item) => (
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
