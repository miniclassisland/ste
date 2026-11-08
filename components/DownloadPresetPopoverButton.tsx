"use client";

import React, { useState, useEffect } from "react";
import {
    Button,
    Input,
    Popover,
    PopoverTrigger,
    PopoverSurface,
    Spinner,
} from "@fluentui/react-components";
import { ArrowDownload24Regular } from "@fluentui/react-icons";

function sanitizeFileName(raw: string): string {
    return raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
}

function ensureJsonExt(name: string): string {
    const trimmed = sanitizeFileName(name) || "ManagementPreset.json";
    return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

export interface DownloadPresetPopoverButtonProps {
    /** 按钮文案 */
    buttonText?: string;
    /** 按钮样式 */
    appearance?: "primary" | "secondary" | "subtle" | "outline";
    /** 按钮尺寸 */
    size?: "small" | "medium" | "large";
    /** 默认推荐的具名文件名（更易区分，如 miniclassisland-school-101.json） */
    defaultFileName: string;
    /** 候选快捷文件名列表 */
    suggestedNames?: { label: string; fileName: string }[];
    /** 点击确认下载时获取 JSON 数据的回调 */
    onFetchData: () => Promise<unknown>;
    /** 错误回调 */
    onError?: (errMsg: string) => void;
    disabled?: boolean;
}

export default function DownloadPresetPopoverButton({
    buttonText = "下载引导配置",
    appearance = "secondary",
    size = "medium",
    defaultFileName,
    suggestedNames,
    onFetchData,
    onError,
    disabled = false,
}: DownloadPresetPopoverButtonProps) {
    const [open, setOpen] = useState(false);
    const [fileName, setFileName] = useState(ensureJsonExt(defaultFileName));
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        if (open) {
            setFileName(ensureJsonExt(defaultFileName));
        }
    }, [open, defaultFileName]);

    const presets = suggestedNames && suggestedNames.length > 0
        ? suggestedNames
        : [
            { label: "具名区分文件", fileName: ensureJsonExt(defaultFileName) },
            { label: "客户端自动加载名", fileName: "ManagementPreset.json" },
            { label: "服务端标准配置名", fileName: "ManagementServer.json" },
        ];

    async function handleConfirmDownload(e?: React.FormEvent) {
        if (e) e.preventDefault();
        const finalName = ensureJsonExt(fileName);
        setDownloading(true);
        try {
            const payload = await onFetchData();
            const blob = new Blob([JSON.stringify(payload, null, 2)], {
                type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = finalName;
            a.click();
            URL.revokeObjectURL(url);
            setOpen(false);
        } catch (err: unknown) {
            if (onError) {
                onError(err instanceof Error ? err.message : "下载配置文件失败");
            }
        }
        setDownloading(false);
    }

    return (
        <Popover
            open={open}
            onOpenChange={(_, data) => setOpen(data.open)}
            positioning="below-end"
            withArrow
        >
            <PopoverTrigger disableButtonEnhancement>
                <Button
                    appearance={appearance}
                    size={size}
                    icon={<ArrowDownload24Regular />}
                    disabled={disabled}
                >
                    {buttonText}
                </Button>
            </PopoverTrigger>
            <PopoverSurface style={{ width: 340, padding: 16 }}>
                <form onSubmit={handleConfirmDownload} style={{ display: "grid", gap: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                        选择或自定义保存文件名
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {presets.map((p) => {
                            const normalized = ensureJsonExt(p.fileName);
                            const isSelected = fileName === normalized;
                            return (
                                <button
                                    key={normalized}
                                    type="button"
                                    onClick={() => setFileName(normalized)}
                                    style={{
                                        fontSize: 11,
                                        padding: "4px 8px",
                                        borderRadius: 4,
                                        border: isSelected
                                            ? "1px solid var(--accent-color)"
                                            : "1px solid var(--border-color)",
                                        background: isSelected ? "var(--bg-accent-subtle)" : "var(--bg-card)",
                                        color: isSelected ? "var(--accent-color)" : "var(--text-secondary)",
                                        cursor: "pointer",
                                        textAlign: "left",
                                    }}
                                >
                                    <div style={{ fontWeight: 600 }}>{normalized}</div>
                                    <div style={{ fontSize: 10, opacity: 0.85 }}>{p.label}</div>
                                </button>
                            );
                        })}
                    </div>
                    <div>
                        <Input
                            size="small"
                            value={fileName}
                            onChange={(_, d) => setFileName(d.value)}
                            placeholder="输入文件名"
                            style={{ width: "100%" }}
                        />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <Button
                            size="small"
                            appearance="secondary"
                            type="button"
                            onClick={() => setOpen(false)}
                        >
                            取消
                        </Button>
                        <Button
                            size="small"
                            appearance="primary"
                            type="submit"
                            icon={<ArrowDownload24Regular />}
                            disabled={downloading || !fileName.trim()}
                        >
                            {downloading ? <Spinner size="tiny" /> : "确认下载"}
                        </Button>
                    </div>
                </form>
            </PopoverSurface>
        </Popover>
    );
}
