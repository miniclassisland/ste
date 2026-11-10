"use client";

import React, { useEffect, useState } from "react";
import {
    Button,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from "@fluentui/react-components";
import { site } from "@/lib/api";

export default function SiteAnnouncementBanner() {
    const [announcement, setAnnouncement] = useState<{ title: string; subtitle: string } | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        site.getAnnouncement()
            .then((data) => {
                if (cancelled) return;
                const title = (data?.title || "").trim();
                const subtitle = (data?.subtitle || "").trim();
                if (title || subtitle) {
                    setAnnouncement({ title, subtitle });
                }
            })
            .catch(() => {
                /* Announcements are optional; hide on failure. */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!announcement) return null;

    const displayTitle = announcement.title || "站内公告";

    return (
        <>
            <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
                style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    border: "none",
                    borderBottom: "1px solid var(--border-color)",
                    background: "var(--bg-accent-subtle)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                    font: "inherit",
                }}
            >
                <span
                    style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        fontWeight: 600,
                    }}
                >
                    {displayTitle}
                </span>
                <span style={{ flexShrink: 0, fontSize: 11, color: "var(--accent-color)" }}>
                    查看详情
                </span>
            </button>

            <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
                <DialogSurface style={{ maxWidth: 520 }}>
                    <DialogBody>
                        <DialogTitle>{displayTitle}</DialogTitle>
                        <DialogContent>
                            <div
                                style={{
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    lineHeight: 1.7,
                                    fontSize: 14,
                                    color: "var(--text-primary)",
                                }}
                            >
                                {announcement.subtitle || "暂无详细内容"}
                            </div>
                        </DialogContent>
                        <DialogActions style={{ marginTop: 16, justifyContent: "flex-end" }}>
                            <Button
                                appearance="secondary"
                                onClick={() => setOpen(false)}
                            >
                                关闭
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
}
