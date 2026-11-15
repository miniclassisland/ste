"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { clients, editSessions, realtime } from "@/lib/api";
import type {
    ClientDeviceOut,
    EditSessionInitialView,
    EditSessionSummary,
    ResourceType,
} from "@/lib/types";
import {
    Badge,
    Button,
    Spinner,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import { Desktop20Regular, ArrowSync24Regular } from "@fluentui/react-icons";

export interface RemoteEditLauncherButtonProps {
    accountId: string;
    initialView: EditSessionInitialView;
    resourceType: ResourceType;
    selectedFile?: string | null;
    extraResourceTargets?: Record<string, string>;
    disabled?: boolean;
    size?: "small" | "medium" | "large";
    onMessage?: (msg: { type: "success" | "error"; text: string }) => void;
    onRemoteUpdated?: () => void;
}

const VIEW_LABELS: Record<EditSessionInitialView, string> = {
    profile: "档案",
    classplan: "课表",
    timelayout: "时间表",
    subjects: "科目",
    settings: "设置",
    components: "组件",
    policy: "策略",
    credentials: "凭据",
};

function sessionTargetsResource(
    session: Partial<EditSessionSummary>,
    resourceType: ResourceType,
    selectedFile: string,
): boolean {
    if (session.mode && session.mode !== "RemoteEdit") return false;
    const targets = session.resource_targets;
    if (targets && Object.keys(targets).length > 0) {
        return targets[resourceType] === selectedFile;
    }
    return (
        selectedFile === "default" &&
        Array.isArray(session.allowed_scopes) &&
        session.allowed_scopes.includes(resourceType)
    );
}

export default function RemoteEditLauncherButton({
    accountId,
    initialView,
    resourceType,
    selectedFile,
    extraResourceTargets,
    disabled = false,
    size = "medium",
    onMessage,
    onRemoteUpdated,
}: RemoteEditLauncherButtonProps) {
    const [open, setOpen] = useState(false);
    const [loadingClients, setLoadingClients] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [eligibleClients, setEligibleClients] = useState<ClientDeviceOut[]>([]);
    const [selectedEditorUid, setSelectedEditorUid] = useState("");
    const [modalError, setModalError] = useState<string | null>(null);
    const [activeSessionEditor, setActiveSessionEditor] = useState<string | null>(null);

    const onRemoteUpdatedRef = useRef(onRemoteUpdated);
    useEffect(() => {
        onRemoteUpdatedRef.current = onRemoteUpdated;
    }, [onRemoteUpdated]);

    const loadEligibleClients = useCallback(async () => {
        if (!accountId) return;
        setLoadingClients(true);
        setModalError(null);
        try {
            const list = await clients.list(accountId);
            const eligible = (list || []).filter(
                (c) => c.status === "online" && !!c.extend_management_enabled && !c.is_disabled,
            );
            setEligibleClients(eligible);
            setSelectedEditorUid((prev) =>
                eligible.some((c) => c.uid === prev) ? prev : eligible[0]?.uid || "",
            );
        } catch (err: unknown) {
            setModalError(err instanceof Error ? err.message : "加载在线增强客户端失败");
        } finally {
            setLoadingClients(false);
        }
    }, [accountId]);

    useEffect(() => {
        if (open) {
            void loadEligibleClients();
        }
    }, [open, loadEligibleClients]);

    useEffect(() => {
        if (!accountId || !selectedFile) {
            setActiveSessionEditor(null);
            return;
        }
        let cancelled = false;
        let reloadTimer: ReturnType<typeof setTimeout> | null = null;

        const scheduleRemoteUpdate = () => {
            if (!onRemoteUpdatedRef.current) return;
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                reloadTimer = null;
                onRemoteUpdatedRef.current?.();
            }, 250);
        };

        const refreshActiveSession = async () => {
            try {
                const res = await editSessions.list(accountId);
                if (cancelled) return;
                const sessions = Array.isArray(res?.sessions) ? res.sessions : [];
                const match = sessions.find((s) =>
                    sessionTargetsResource(s, resourceType, selectedFile),
                );
                setActiveSessionEditor(
                    match ? match.editor_display_name || match.editor_client_uid || "在线终端" : null,
                );
            } catch {
                // Ignore transient errors during background session check
            }
        };

        void refreshActiveSession();

        const unsubscribe = realtime.subscribe(accountId, {
            onEvent: (evt) => {
                const d = evt.data || {};
                if (evt.event === "edit_session.updated") {
                    const action = String(d.action || "");
                    if (action === "created" || action === "closed" || action === "expired") {
                        void refreshActiveSession();
                    }
                    if (action === "synced") {
                        const updated = d.updated_resources;
                        const targets =
                            d.resource_targets && typeof d.resource_targets === "object"
                                ? (d.resource_targets as Record<string, string>)
                                : null;
                        const matchesTarget =
                            !targets || !targets[resourceType] || targets[resourceType] === selectedFile;
                        if (
                            Array.isArray(updated) &&
                            updated.includes(resourceType) &&
                            matchesTarget
                        ) {
                            scheduleRemoteUpdate();
                        }
                    }
                } else if (evt.event === "resource.updated") {
                    if (
                        String(d.resource_type || "") === resourceType &&
                        String(d.name || "") === selectedFile &&
                        String(d.action || "") !== "deleted"
                    ) {
                        scheduleRemoteUpdate();
                    }
                }
            },
        });

        return () => {
            cancelled = true;
            if (reloadTimer) {
                clearTimeout(reloadTimer);
                reloadTimer = null;
            }
            unsubscribe();
        };
    }, [accountId, resourceType, selectedFile]);

    async function handleLaunch() {
        if (!selectedEditorUid || submitting) return;
        setSubmitting(true);
        setModalError(null);
        try {
            const resourceTargets: Record<string, string> = {};
            if (extraResourceTargets) {
                for (const [k, v] of Object.entries(extraResourceTargets)) {
                    const trimmed = typeof v === "string" ? v.trim() : "";
                    if (trimmed) {
                        resourceTargets[k] = trimmed;
                    }
                }
            }
            if (selectedFile) {
                resourceTargets[resourceType] = selectedFile;
            }
            const res = await editSessions.create(accountId, {
                mode: "RemoteEdit",
                editor_client_uid: selectedEditorUid,
                initial_view: initialView,
                resource_targets: Object.keys(resourceTargets).length > 0 ? resourceTargets : null,
            });
            setActiveSessionEditor(res.session.editor_display_name || selectedEditorUid);
            setOpen(false);
            onMessage?.({
                type: "success",
                text: `已在客户端「${res.session.editor_display_name || selectedEditorUid}」发起远程编辑会话`,
            });
        } catch (err: unknown) {
            setModalError(err instanceof Error ? err.message : "启动客户端远程编辑失败");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Button
                    appearance="outline"
                    size={size}
                    icon={<Desktop20Regular />}
                    disabled={disabled || !accountId}
                    onClick={() => {
                        setModalError(null);
                        setOpen(true);
                    }}
                >
                    在客户端编辑
                </Button>
                {activeSessionEditor && (
                    <Badge appearance="tint" color="brand" size="medium">
                        客户端编辑中 · {activeSessionEditor}
                    </Badge>
                )}
            </span>

            {open && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open && !submitting) setOpen(false); }}>
                    <DialogSurface style={{ minWidth: 440, maxWidth: "92vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                在客户端编辑 {VIEW_LABELS[initialView]}{selectedFile ? `: ${selectedFile}` : ""}
                            </DialogTitle>
                            <DialogContent>
                                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
                                    {selectedFile && (
                                        <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                                            当前锁定目标资源：<strong>{resourceType}</strong> / <code>{selectedFile}</code>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>选择在线增强客户端</span>
                                        <Button
                                            appearance="subtle"
                                            size="small"
                                            icon={<ArrowSync24Regular />}
                                            disabled={loadingClients || submitting}
                                            onClick={() => void loadEligibleClients()}
                                        >
                                            刷新列表
                                        </Button>
                                    </div>

                                    {loadingClients ? (
                                        <div style={{ padding: "16px 0", display: "flex", justifyContent: "center" }}>
                                            <Spinner size="small" label="正在检索在线增强客户端..." />
                                        </div>
                                    ) : eligibleClients.length === 0 ? (
                                        <div
                                            style={{
                                                padding: 12,
                                                borderRadius: 6,
                                                background: "var(--bg-subtle)",
                                                fontSize: 13,
                                                lineHeight: 1.6,
                                            }}
                                        >
                                            <div>当前账户下没有在线且已安装增强引擎 (MEE) 的可用客户端。</div>
                                            <a
                                                href="https://miniclassisland.com/"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    color: "var(--brand-color, #0078d4)",
                                                    textDecoration: "underline",
                                                    fontWeight: 500,
                                                }}
                                            >
                                                前往下载增强插件
                                            </a>
                                        </div>
                                    ) : (
                                        <Select
                                            value={selectedEditorUid}
                                            onChange={(_, d) => setSelectedEditorUid(d.value)}
                                            disabled={submitting}
                                            style={{ width: "100%" }}
                                        >
                                            {eligibleClients.map((c) => (
                                                <option key={c.uid} value={c.uid}>
                                                    {(c.display_name || c.client_id || c.uid)}
                                                    {c.ip ? ` (${c.ip})` : ""}
                                                    {c.extend_management_version ? ` · v${c.extend_management_version}` : ""}
                                                </option>
                                            ))}
                                        </Select>
                                    )}

                                    {modalError && (
                                        <div
                                            style={{
                                                padding: "8px 10px",
                                                borderRadius: 6,
                                                background: "rgba(209, 52, 56, 0.1)",
                                                color: "var(--danger-color, #c42b1c)",
                                                fontSize: 12.5,
                                            }}
                                        >
                                            {modalError}
                                        </div>
                                    )}
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button
                                    appearance="secondary"
                                    disabled={submitting}
                                    onClick={() => setOpen(false)}
                                >
                                    取消
                                </Button>
                                <Button
                                    appearance="primary"
                                    disabled={submitting || loadingClients || !selectedEditorUid}
                                    onClick={() => void handleLaunch()}
                                >
                                    {submitting ? <Spinner size="tiny" /> : "发起客户端编辑"}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </>
    );
}
