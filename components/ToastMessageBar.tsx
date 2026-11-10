"use client";

import React, { useEffect, useState, useId } from "react";
import { createPortal } from "react-dom";
import {
    CheckmarkCircle20Regular,
    ErrorCircle20Regular,
    Warning20Regular,
    Info20Regular,
    Dismiss16Regular,
} from "@fluentui/react-icons";

export type ToastIntent = "info" | "warning" | "error" | "success";

export interface MessageBarProps {
    intent?: ToastIntent;
    children?: React.ReactNode;
    style?: React.CSSProperties;
    className?: string;
    autoHideMs?: number;
    onDismiss?: () => void;
    inline?: boolean;
}

const TOAST_ROOT_ID = "mci-toast-portal-root";

function getOrCreateToastRoot(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    let root = document.getElementById(TOAST_ROOT_ID);
    if (!root) {
        root = document.createElement("div");
        root.id = TOAST_ROOT_ID;
        root.className = "mci-toast-stack";
        document.body.appendChild(root);
    }
    return root;
}

function extractNodeSignature(node: React.ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractNodeSignature).join("|");
    if (React.isValidElement(node)) {
        const props = node.props as { children?: React.ReactNode };
        return extractNodeSignature(props?.children);
    }
    return "";
}

export function MessageBar({
    intent = "info",
    children,
    style,
    className = "",
    autoHideMs,
    onDismiss,
    inline = false,
}: MessageBarProps) {
    const id = useId();
    const [mounted, setMounted] = useState(false);
    const [dismissedSig, setDismissedSig] = useState<string | null>(null);

    const signature = `${intent}::${extractNodeSignature(children)}`;
    const visible = dismissedSig !== signature;

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!visible || inline) return;
        const duration = autoHideMs ?? (intent === "error" || intent === "warning" ? 6500 : 4500);
        if (duration <= 0) return;
        const timer = window.setTimeout(() => {
            setDismissedSig(signature);
            onDismiss?.();
        }, duration);
        return () => window.clearTimeout(timer);
    }, [visible, inline, signature, intent, autoHideMs, onDismiss]);

    if (!visible) return null;

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        setDismissedSig(signature);
        onDismiss?.();
    };

    const renderIcon = () => {
        switch (intent) {
            case "success":
                return <CheckmarkCircle20Regular className="mci-toast-icon is-success" />;
            case "error":
                return <ErrorCircle20Regular className="mci-toast-icon is-error" />;
            case "warning":
                return <Warning20Regular className="mci-toast-icon is-warning" />;
            default:
                return <Info20Regular className="mci-toast-icon is-info" />;
        }
    };

    if (inline) {
        return (
            <div
                key={id}
                role="status"
                aria-live="polite"
                style={style}
                className={`mci-toast-item is-inline is-${intent} ${className}`.trim()}
            >
                <div className="mci-toast-leading">{renderIcon()}</div>
                <div className="mci-toast-content">{children}</div>
                {onDismiss && (
                    <button
                        type="button"
                        className="mci-toast-close"
                        onClick={handleClose}
                        aria-label="关闭通知"
                        title="关闭"
                    >
                        <Dismiss16Regular />
                    </button>
                )}
            </div>
        );
    }

    if (!mounted) return null;

    const root = getOrCreateToastRoot();
    if (!root) return null;

    return createPortal(
        <div
            key={id}
            role="status"
            aria-live="polite"
            className={`mci-toast-item is-${intent} ${className}`.trim()}
        >
            <div className="mci-toast-leading">{renderIcon()}</div>
            <div className="mci-toast-content">{children}</div>
            <button
                type="button"
                className="mci-toast-close"
                onClick={handleClose}
                aria-label="关闭通知"
                title="关闭"
            >
                <Dismiss16Regular />
            </button>
        </div>,
        root,
    );
}

export function MessageBarBody({
    children,
    style,
    className = "",
}: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
    className?: string;
}) {
    return (
        <div className={`mci-toast-body ${className}`.trim()} style={style}>
            {children}
        </div>
    );
}
