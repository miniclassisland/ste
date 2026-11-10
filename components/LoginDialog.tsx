"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Input,
  Spinner,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";

interface LoginDialogProps {
  open: boolean;
  onClose?: () => void;
}

export default function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { loginWithPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await loginWithPassword(password);
      setPassword("");
      onClose?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "密码错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogSurface style={{ maxWidth: 420 }}>
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <DialogTitle style={{ textAlign: "center", fontSize: 20 }}>
              MINI ClassIsland STE
            </DialogTitle>
            <DialogContent>
              <p
                style={{
                  textAlign: "center",
                  color: "var(--text-secondary)",
                  marginBottom: 20,
                  fontSize: 13,
                }}
              >
                请输入管理密码以继续
              </p>

              {error && (
                <MessageBar intent="error" style={{ marginBottom: 12 }}>
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}

              <div className="form-group">
                <label className="form-label">管理密码</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(_, d) => setPassword(d.value)}
                  placeholder="请输入密码"
                  required
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                type="submit"
                disabled={loading || !password}
                style={{ width: "100%" }}
              >
                {loading ? <Spinner size="tiny" /> : "登录"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
