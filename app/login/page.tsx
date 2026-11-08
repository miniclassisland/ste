"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  Button,
  Input,
  Label,
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";

export default function LoginPage() {
  const { loginWithPassword, passwordInitialized } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setError("");

    if (!passwordInitialized) {
      if (password.length < 4) {
        setError("密码长度不能少于 4 位");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
    }

    setLoading(true);
    try {
      await loginWithPassword(password);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "密码验证失败");
    }
    setLoading(false);
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt="MINI ClassIsland Logo"
            style={{ width: 64, height: 64, marginBottom: 12, display: "block" }}
          />
          <div className="login-title" style={{ margin: 0 }}>
            欢迎来到 MINI ClassIsland
          </div>
        </div>
        <div className="login-subtitle">
          {passwordInitialized ? "请输入密码以继续" : "首次使用，请设置管理密码"}
        </div>

        {error && (
          <MessageBar intent="error" style={{ marginBottom: 12 }}>
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <Label htmlFor="password">
              {passwordInitialized ? "密码" : "设置密码"}
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(_, d) => setPassword(d.value)}
              placeholder={passwordInitialized ? "请输入密码" : "请输入至少 4 位密码"}
              style={{ width: "100%" }}
              autoComplete="current-password"
              autoFocus
            />
          </div>

          {!passwordInitialized && (
            <div className="form-group">
              <Label htmlFor="confirm-password">确认密码</Label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(_, d) => setConfirmPassword(d.value)}
                placeholder="请再次输入密码"
                style={{ width: "100%" }}
                autoComplete="new-password"
              />
            </div>
          )}

          <Button
            appearance="primary"
            type="submit"
            disabled={loading || !password || (!passwordInitialized && !confirmPassword)}
            style={{ width: "100%", marginTop: 8 }}
          >
            {loading ? <Spinner size="tiny" /> : "登录"}
          </Button>
        </form>

        <div
          style={{
            marginTop: 32,
            paddingTop: 16,
            borderTop: "1px solid var(--border-color)",
            textAlign: "center",
            fontSize: 11,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <div>
            本项目与 ClassIsland 官方无关，ClassIsland 是由 ClassIsland 社区开发和维护的开源软件
          </div>
          <div>本项目由 MINIOpenSource 开发和维护，并开源在 GitHub</div>
        </div>
      </div>
    </div>
  );
}
