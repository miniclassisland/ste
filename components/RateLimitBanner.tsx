"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";

export interface RateLimitEventDetail {
    message: string;
    retryAfter: number;
    code?: string;
    path?: string;
}

export default function RateLimitBanner() {
    const [active, setActive] = useState(false);
    const [message, setMessage] = useState("");
    const [remaining, setRemaining] = useState(0);

    useEffect(() => {
        function handleRateLimit(e: Event) {
            const custom = e as CustomEvent<RateLimitEventDetail>;
            const detail = custom.detail || {
                message: "请求过于频繁，已被安全限流保护拦截，请稍后再试。",
                retryAfter: 30,
            };
            setMessage(detail.message);
            setRemaining(detail.retryAfter > 0 ? detail.retryAfter : 30);
            setActive(true);
        }

        window.addEventListener("miniclassisland:rate-limited", handleRateLimit);
        return () => window.removeEventListener("miniclassisland:rate-limited", handleRateLimit);
    }, []);

    useEffect(() => {
        if (!active || remaining <= 0) return;
        const timer = setInterval(() => {
            setRemaining((prev) => {
                if (prev <= 1) {
                    setActive(false);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [active, remaining]);

    if (!active) return null;

    return (
        <MessageBar intent="warning" autoHideMs={0} onDismiss={() => setActive(false)}>
            <MessageBarBody>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                        <strong>请求受限：</strong>
                        <span>{message}</span>
                        {remaining > 0 && (
                            <span style={{ marginLeft: 8, fontWeight: 600 }}>
                                建议等待 {remaining} 秒后重试
                            </span>
                        )}
                    </div>
                    <Button
                        size="small"
                        appearance="secondary"
                        disabled={remaining > 0}
                        onClick={() => window.location.reload()}
                    >
                        {remaining > 0 ? `请等待 ${remaining} 秒` : "立即刷新重试"}
                    </Button>
                </div>
            </MessageBarBody>
        </MessageBar>
    );
}
