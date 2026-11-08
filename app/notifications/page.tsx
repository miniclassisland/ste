"use client";

import React, { useState, useEffect, useCallback } from "react";
import { clients } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { NotificationPayload, ClientDeviceOut } from "@/lib/types";
import {
    Button, Input, Spinner, Switch, Textarea,
    MessageBar, MessageBarBody,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import { Send24Regular } from "@fluentui/react-icons";

export default function NotificationsPage() {
    const { accountId } = useAccount();
    const [clientList, setClientList] = useState<ClientDeviceOut[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedClient, setSelectedClient] = useState("");
    const [sending, setSending] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [form, setForm] = useState<NotificationPayload>({
        MessageMask: "集控通知",
        MessageContent: "",
        OverlayIconLeft: 0,
        OverlayIconRight: 0,
        IsEmergency: false,
        IsSpeechEnabled: true,
        IsEffectEnabled: true,
        IsSoundEnabled: true,
        IsTopmost: true,
        DurationSeconds: 5,
        RepeatCounts: 1,
    });

    const load = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const list = await clients.list(accountId);
            setClientList(Array.isArray(list) ? list : []);
        } catch {
            setClientList([]);
        }
        setLoading(false);
    }, [accountId]);

    useEffect(() => {
        load();
    }, [load]);

    async function handleSend(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedClient) return;
        setSending(true);
        setMsg(null);
        try {
            await clients.sendNotification(accountId, selectedClient, form);
            setMsg({ type: "success", text: `通知已成功推送至终端 ${selectedClient}` });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "推送失败" });
        }
        setSending(false);
    }

    async function handleBroadcast() {
        if (!confirm("确定要向所有当前在线客户端广播此通知吗？")) return;
        setSending(true);
        setMsg(null);
        try {
            const res = await clients.broadcastNotification(accountId, form);
            setMsg({
                type: "success",
                text: `广播完成：已向 ${res.sent_count} / ${res.total_targets} 台在线终端推送通知`,
            });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "广播推送失败" });
        }
        setSending(false);
    }

    const onlineClients = clientList.filter((c) => c.status === "online");

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">通知推送</h1>
                    <p className="page-subtitle">
                        向指定客户端或全部在线终端实时推送 ClassIsland 顶栏横幅与语音提醒
                    </p>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            {/* 实时预览横幅 */}
            <div className={`card notification-preview-banner ${form.IsEmergency ? "is-emergency" : ""}`}>
                <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>ClassIsland 提醒横幅预览</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{form.MessageMask || "（遮罩标题）"}</div>
                <div style={{ fontSize: 14, marginTop: 4, opacity: 0.9 }}>{form.MessageContent || "（正文内容将在此滚动或居中展示）"}</div>
            </div>

            <div className="card">
                {loading ? (
                    <Spinner size="small" />
                ) : (
                    <form onSubmit={handleSend}>
                        <div className="grid-2">
                            <div className="form-group">
                                <label className="form-label">目标客户端（单发时必选）</label>
                                <Select
                                    value={selectedClient}
                                    onChange={(_, d) => setSelectedClient(d.value)}
                                    style={{ width: "100%" }}
                                >
                                    <option value="">-- 选择单个目标客户端 --</option>
                                    {clientList.map((c) => (
                                        <option key={c.uid} value={c.uid}>
                                            [{c.status === "online" ? "在线" : "离线"}] {c.display_name || c.client_id || c.uid} 
                                        </option>
                                    ))}
                                </Select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">持续时间（秒）</label>
                                <Input
                                    type="number"
                                    value={String(form.DurationSeconds || 5)}
                                    onChange={(_, d) =>
                                        setForm({ ...form, DurationSeconds: parseFloat(d.value) || 5 })
                                    }
                                    style={{ width: "100%" }}
                                />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">遮罩标题</label>
                            <Input
                                value={form.MessageMask || ""}
                                onChange={(_, d) => setForm({ ...form, MessageMask: d.value })}
                                style={{ width: "100%" }}
                                placeholder="第一阶段遮罩大字标题"
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">详细通知正文</label>
                            <Textarea
                                value={form.MessageContent || ""}
                                onChange={(_, d) => setForm({ ...form, MessageContent: d.value })}
                                style={{ width: "100%" }}
                                rows={4}
                                placeholder="第二阶段展示并语音朗读的通知详情内容"
                            />
                        </div>
                        <div className="grid-2 mb-16">
                            <div className="form-group">
                                <label className="form-label">重复播报次数</label>
                                <Input
                                    type="number"
                                    value={String(form.RepeatCounts || 1)}
                                    onChange={(_, d) =>
                                        setForm({ ...form, RepeatCounts: parseInt(d.value) || 1 })
                                    }
                                    style={{ width: "100%" }}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">左右侧图标编号</label>
                                <div className="flex gap-8">
                                    <Input
                                        type="number"
                                        value={String(form.OverlayIconLeft || 0)}
                                        placeholder="左图标"
                                        onChange={(_, d) =>
                                            setForm({ ...form, OverlayIconLeft: parseInt(d.value) || 0 })
                                        }
                                        style={{ flex: 1 }}
                                    />
                                    <Input
                                        type="number"
                                        value={String(form.OverlayIconRight || 0)}
                                        placeholder="右图标"
                                        onChange={(_, d) =>
                                            setForm({ ...form, OverlayIconRight: parseInt(d.value) || 0 })
                                        }
                                        style={{ flex: 1 }}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-16 mb-16" style={{ flexWrap: "wrap" }}>
                            <Switch
                                checked={form.IsEmergency || false}
                                onChange={(_, d) => setForm({ ...form, IsEmergency: d.checked })}
                                label="紧急通知样式"
                            />
                            <Switch
                                checked={form.IsSpeechEnabled || false}
                                onChange={(_, d) => setForm({ ...form, IsSpeechEnabled: d.checked })}
                                label="启用 TTS 语音播报"
                            />
                            <Switch
                                checked={form.IsSoundEnabled || false}
                                onChange={(_, d) => setForm({ ...form, IsSoundEnabled: d.checked })}
                                label="播放提醒音效"
                            />
                            <Switch
                                checked={form.IsEffectEnabled || false}
                                onChange={(_, d) => setForm({ ...form, IsEffectEnabled: d.checked })}
                                label="启用醒目视觉特效"
                            />
                            <Switch
                                checked={form.IsTopmost || false}
                                onChange={(_, d) => setForm({ ...form, IsTopmost: d.checked })}
                                label="强制窗口置顶"
                            />
                        </div>
                        <div className="flex gap-12">
                            <Button
                                appearance="primary"
                                type="submit"
                                icon={<Send24Regular />}
                                disabled={sending || !selectedClient}
                            >
                                {sending ? <Spinner size="tiny" /> : "发送至指定客户端"}
                            </Button>
                            <Button
                                appearance="secondary"
                                type="button"
                                onClick={handleBroadcast}
                                disabled={sending || onlineClients.length === 0}
                            >
                                广播至所有在线客户端 ({onlineClients.length} 台)
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
