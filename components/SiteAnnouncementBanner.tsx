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
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import { site } from "@/lib/api";

export default function SiteAnnouncementBanner() {
    const [announcement, setAnnouncement] = useState<{ title: string; subtitle: string } | null>(null);
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);

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

    if (!announcement || dismissed) return null;

    const displayTitle = announcement.title || "站内公告";

    return (
        <>
            <MessageBar
                inline
                intent="info"
                className="site-announcement-banner"
                onDismiss={() => setDismissed(true)}
            >
                <MessageBarBody>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontWeight: 600 }}>{displayTitle}</span>
                        <Button
                            size="small"
                            appearance="subtle"
                            onClick={() => setOpen(true)}
                            style={{ flexShrink: 0, color: "var(--accent-color)" }}
                        >
                            查看详情
                        </Button>
                    </div>
                </MessageBarBody>
            </MessageBar>

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
