"use client";

import React, { useState, useEffect } from "react";
import { MessageBar, MessageBarBody, Button } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";

export interface RateLimitEventDetail {
    message: string;
    retryAfter: number;
    code?: string;
    path?: string;
}

/**
 * 全局 429 请求限流 / IP 临时保护横幅提示组件。
 * 监听 `miniclassisland:rate-limited` 事件并展示倒计时恢复提示。
 */
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
        <div
            style={{
                position: "fixed",
                top: 16,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 2500,
                maxWidth: "min(680px, 92vw)",
                width: "100%",
                boxShadow: "0 8px 28px rgba(0, 0, 0, 0.22)",
                borderRadius: 8,
            }}
            role="alert"
        >
            <MessageBar intent="warning" style={{ borderRadius: 8, padding: "8px 14px" }}>
                <MessageBarBody>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                            <strong>请求受限：</strong>
                            <span>{message}</span>
                            {remaining > 0 && (
                                <span style={{ marginLeft: 8, fontWeight: 600 }}>
                                    (建议等待 {remaining} 秒后重试)
                                </span>
                            )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Button
                                size="small"
                                appearance="secondary"
                                disabled={remaining > 0}
                                onClick={() => window.location.reload()}
                            >
                                {remaining > 0 ? `请等待 (${remaining}s)` : "立即刷新重试"}
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Dismiss16Regular />}
                                onClick={() => setActive(false)}
                                aria-label="关闭限流提示"
                            />
                        </div>
                    </div>
                </MessageBarBody>
            </MessageBar>
        </div>
    );
}
