"use client";

/**
 * 配置文件历史版本查看器与版本载入组件。
 * 支持查看当前选中配置文件的所有历史版本列表、预览任意版本的 JSON 内容，
 * 或将任意历史版本载入当前编辑器中进行修改（保存时将作为新版本发布，不会覆盖原历史记录）。
 */

import React, { useState } from "react";
import { data } from "@/lib/api";
import type { ResourceType, ResourceHistoryItem } from "@/lib/types";
import {
    Button,
    Spinner,
    Badge,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import {
    History24Regular,
    Eye24Regular,
    ArrowClockwise24Regular,
} from "@fluentui/react-icons";

export interface FileHistoryButtonProps {
    accountId: string;
    resourceType: ResourceType;
    fileName: string | null;
    onLoadVersion: (content: unknown, version: number, isCurrent: boolean) => void;
    onError?: (message: string) => void;
}

export default function FileHistoryButton({
    accountId,
    resourceType,
    fileName,
    onLoadVersion,
    onError,
}: FileHistoryButtonProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [historyList, setHistoryList] = useState<ResourceHistoryItem[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [previewContent, setPreviewContent] = useState<string>("");
    const [previewRaw, setPreviewRaw] = useState<unknown>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    async function loadVersionDetail(ver: number, listSnapshot?: ResourceHistoryItem[]) {
        if (!accountId || !fileName) return;
        setSelectedVersion(ver);
        setPreviewLoading(true);
        setLocalError(null);
        try {
            const detail = await data.readHistoryVersion(accountId, resourceType, fileName, ver);
            setPreviewRaw(detail.content);
            setPreviewContent(JSON.stringify(detail.content ?? {}, null, 2));
            if (listSnapshot && listSnapshot.length === 0) {
                setHistoryList([
                    {
                        version: detail.version,
                        name: detail.name,
                        resource_type: detail.resource_type,
                        updated_at: detail.updated_at,
                        size_bytes: JSON.stringify(detail.content ?? {}).length,
                        is_current: true,
                    },
                ]);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "读取历史版本内容失败";
            setLocalError(msg);
            if (onError) onError(msg);
        } finally {
            setPreviewLoading(false);
        }
    }

    async function handleOpen() {
        if (!accountId || !fileName) return;
        setOpen(true);
        setLoading(true);
        setLocalError(null);
        setPreviewContent("");
        setPreviewRaw(null);
        setSelectedVersion(null);
        try {
            const list = await data.listHistory(accountId, resourceType, fileName);
            const arr = Array.isArray(list) ? list : [];
            setHistoryList(arr);
            if (arr.length > 0) {
                await loadVersionDetail(arr[0].version, arr);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "获取历史版本列表失败";
            setLocalError(msg);
            if (onError) onError(msg);
        } finally {
            setLoading(false);
        }
    }

    function handleApplyVersion() {
        if (selectedVersion === null || previewRaw === null) return;
        const item = historyList.find((h) => h.version === selectedVersion);
        const isCurrent = item ? item.is_current : false;
        onLoadVersion(previewRaw, selectedVersion, isCurrent);
        setOpen(false);
    }

    function formatTime(iso: string) {
        if (!iso) return "-";
        try {
            return new Date(iso).toLocaleString("zh-CN", { hour12: false });
        } catch {
            return iso;
        }
    }

    function formatSize(bytes: number) {
        if (bytes < 1024) return `${bytes} B`;
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return (
        <>
            <Button
                appearance="secondary"
                icon={<History24Regular />}
                disabled={!fileName}
                onClick={handleOpen}
            >
                历史版本
            </Button>

            {open && (
                <Dialog open onOpenChange={(_, d) => { if (!d.open) setOpen(false); }}>
                    <DialogSurface style={{ maxWidth: 860, width: "92vw" }}>
                        <DialogBody>
                            <DialogTitle>
                                配置文件历史版本 — {resourceType} / {fileName}
                            </DialogTitle>
                            <DialogContent>
                                <MessageBar intent="info" style={{ marginBottom: 12 }}>
                                    <MessageBarBody>
                                        您可以随时查看任意历史版本的配置内容。点击「载入到编辑器」可基于所选历史版本进行修改；点击页面的「保存」按钮时将<strong>自动创建一个全新的最新版本</strong>，不会覆盖原有的历史版本记录。
                                    </MessageBarBody>
                                </MessageBar>

                                {localError && (
                                    <MessageBar intent="error" style={{ marginBottom: 12 }}>
                                        <MessageBarBody>{localError}</MessageBarBody>
                                    </MessageBar>
                                )}

                                {loading ? (
                                    <div className="flex items-center justify-center" style={{ height: 260 }}>
                                        <Spinner size="medium" label="正在加载版本历史..." />
                                    </div>
                                ) : historyList.length === 0 ? (
                                    <div className="empty-state" style={{ padding: "32px 0" }}>
                                        <div className="empty-state-text">暂无历史版本记录</div>
                                    </div>
                                ) : (
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
                                            gap: 16,
                                            minHeight: 360,
                                        }}
                                    >
                                        <div
                                            style={{
                                                border: "1px solid var(--border-color)",
                                                borderRadius: 8,
                                                padding: 8,
                                                maxHeight: 400,
                                                overflowY: "auto",
                                                background: "var(--bg-secondary)",
                                            }}
                                        >
                                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", padding: "4px 8px 8px" }}>
                                                共 {historyList.length} 个历史版本
                                            </div>
                                            {historyList.map((item) => {
                                                const active = selectedVersion === item.version;
                                                return (
                                                    <div
                                                        key={item.version}
                                                        onClick={() => loadVersionDetail(item.version)}
                                                        style={{
                                                            padding: "8px 10px",
                                                            borderRadius: 6,
                                                            cursor: "pointer",
                                                            marginBottom: 4,
                                                            background: active ? "var(--bg-hover)" : "transparent",
                                                            border: active ? "1px solid var(--accent-color)" : "1px solid transparent",
                                                        }}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                                                                版本 v{item.version}
                                                            </span>
                                                            {item.is_current ? (
                                                                <Badge appearance="filled" color="success" size="small">
                                                                    当前最新
                                                                </Badge>
                                                            ) : (
                                                                <Badge appearance="outline" color="informative" size="small">
                                                                    历史快照
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4 }}>
                                                            {formatTime(item.updated_at)} · {formatSize(item.size_bytes)}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                border: "1px solid var(--border-color)",
                                                borderRadius: 8,
                                                overflow: "hidden",
                                            }}
                                        >
                                            <div
                                                className="flex items-center justify-between"
                                                style={{
                                                    padding: "8px 12px",
                                                    borderBottom: "1px solid var(--border-color)",
                                                    background: "var(--bg-secondary)",
                                                    fontSize: 12.5,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                <span className="flex items-center gap-4">
                                                    <Eye24Regular style={{ fontSize: 16 }} />
                                                    {selectedVersion !== null ? `版本 v${selectedVersion} JSON 快照预览` : "选择左侧版本查看详情"}
                                                </span>
                                            </div>
                                            {previewLoading ? (
                                                <div className="flex items-center justify-center" style={{ flex: 1, minHeight: 280 }}>
                                                    <Spinner size="small" label="正在读取版本内容..." />
                                                </div>
                                            ) : (
                                                <textarea
                                                    readOnly
                                                    value={previewContent}
                                                    style={{
                                                        flex: 1,
                                                        width: "100%",
                                                        minHeight: 300,
                                                        maxHeight: 360,
                                                        padding: 12,
                                                        border: "none",
                                                        outline: "none",
                                                        resize: "none",
                                                        fontFamily: "var(--font-mono)",
                                                        fontSize: 12,
                                                        background: "var(--bg-input)",
                                                        color: "var(--text-primary)",
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setOpen(false)}>
                                    关闭
                                </Button>
                                <Button
                                    appearance="primary"
                                    icon={<ArrowClockwise24Regular />}
                                    disabled={selectedVersion === null || previewLoading || previewRaw === null}
                                    onClick={handleApplyVersion}
                                >
                                    {selectedVersion !== null ? `载入 v${selectedVersion} 到编辑器` : "载入到编辑器"}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </>
    );
}
