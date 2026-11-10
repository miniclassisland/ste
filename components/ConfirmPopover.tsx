"use client";

import React, { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Button,
} from "@fluentui/react-components";

interface ConfirmPopoverProps {
  message: string;
  onConfirm: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactElement;
}

export function ConfirmPopover({
  message,
  onConfirm,
  confirmText = "确认",
  cancelText = "取消",
  danger = true,
  disabled = false,
  children,
}: ConfirmPopoverProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (disabled) {
    return children;
  }

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(e, data) => {
        e.stopPropagation();
        setOpen(data.open);
      }}
      withArrow
      positioning="below-end"
    >
      <PopoverTrigger disableButtonEnhancement>
        {React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          },
        })}
      </PopoverTrigger>
      <PopoverSurface
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: "12px 14px",
          maxWidth: 280,
          borderRadius: "var(--radius)",
          border: "1px solid var(--border-color)",
          background: "var(--bg-card)",
          boxShadow: "var(--shadow)",
          zIndex: 2000,
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: "var(--text-primary)",
            lineHeight: 1.5,
            marginBottom: 12,
            wordBreak: "break-word",
          }}
        >
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button
            size="small"
            appearance="secondary"
            onClick={handleCancel}
            disabled={busy}
          >
            {cancelText}
          </Button>
          <Button
            size="small"
            appearance="primary"
            onClick={handleConfirm}
            disabled={busy}
            style={
              danger
                ? {
                    backgroundColor: "var(--danger-color)",
                    borderColor: "var(--danger-color)",
                    color: "#fff",
                  }
                : undefined
            }
          >
            {confirmText}
          </Button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
