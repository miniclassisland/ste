"use client";

import React, { useState, useEffect } from "react";
import { userInfo, accounts } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { RegistrationMode } from "@/lib/types";
import { REGISTRATION_MODE_LABELS } from "@/lib/types";
import {
  Button,
  Input,
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
  Key24Regular,
  Save24Regular,
  Copy24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";

export default function SecurityPage() {
  const { accountId, currentAccount, reloadAccounts } = useAccount();

  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // 集控基础信息与接入配置
  const [editName, setEditName] = useState(currentAccount?.name || "");
  const [editServerUrl, setEditServerUrl] = useState(currentAccount?.server_url || "");
  const [editRegMode, setEditRegMode] = useState<RegistrationMode>(
    currentAccount?.registration_mode || "pairing"
  );
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (currentAccount) {
      setEditName(currentAccount.name);
      setEditServerUrl(currentAccount.server_url || "");
      setEditRegMode(currentAccount.registration_mode || "pairing");
    }
  }, [currentAccount]);

  // 修改管理密码
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingConfig(true);
    setMsg(null);
    try {
      await accounts.update(accountId, {
        name: editName.trim(),
        registration_mode: editRegMode,
        server_url: editServerUrl.trim(),
      });
      await reloadAccounts();
      setMsg({ type: "success", text: "集控基础配置已保存" });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "保存失败",
      });
    }
    setSavingConfig(false);
  }

  async function handleRegenerateKey() {
    if (!confirm("确定要重置 API 密钥吗？旧密钥将立即失效。")) return;
    try {
      await accounts.regenerateKey(accountId);
      await reloadAccounts();
      setMsg({ type: "success", text: "API 密钥已重新生成" });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "重置失败",
      });
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setMsg({ type: "success", text: `已复制${label}` });
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setMsg({ type: "error", text: "两次输入的新密码不一致" });
      return;
    }
    if (newPassword.length < 4) {
      setMsg({ type: "error", text: "新密码长度不能少于 4 位" });
      return;
    }
    setChangingPwd(true);
    setMsg(null);
    try {
      await userInfo.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMsg({ type: "success", text: "管理密码已成功修改" });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "密码修改失败",
      });
    }
    setChangingPwd(false);
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">安全设置</h1>
          <p className="page-subtitle">配置集控基础信息、接入策略与管理密码</p>
        </div>
      </div>

      {msg && (
        <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
          <MessageBarBody>{msg.text}</MessageBarBody>
        </MessageBar>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span>集控基础信息与接入配置</span>
            <Settings24Regular style={{ color: "var(--accent-color)" }} />
          </div>
          <form onSubmit={handleSaveConfig}>
            <div className="form-group">
              <label className="form-label">集控组织名称</label>
              <Input
                value={editName}
                onChange={(_, d) => setEditName(d.value)}
                placeholder="例如：第一中学高一年级部"
                style={{ width: "100%" }}
                required
              />
              <div className="form-hint">
                客户端接入集控后在设置页展示的组织名称
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">服务端外部访问地址</label>
              <Input
                value={editServerUrl}
                onChange={(_, d) => setEditServerUrl(d.value)}
                placeholder={
                  currentAccount?.urls?.grpc || "http://localhost:21196"
                }
                style={{ width: "100%" }}
              />
              <div className="form-hint">
                用于生成客户端引导文件中的集控服务器地址，留空则自动使用当前访问域名与端口
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">新终端默认准入策略</label>
              <Select
                value={editRegMode}
                onChange={(_, d) =>
                  setEditRegMode(d.value as RegistrationMode)
                }
                style={{ width: "100%" }}
              >
                {(
                  Object.keys(REGISTRATION_MODE_LABELS) as RegistrationMode[]
                ).map((m) => (
                  <option key={m} value={m}>
                    {REGISTRATION_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="form-group">
              <label className="form-label">集控 API 密钥</label>
              <div className="flex gap-8">
                <Input
                  value={currentAccount?.api_key || ""}
                  readOnly
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  appearance="secondary"
                  icon={<Copy24Regular />}
                  onClick={() =>
                    copyText(currentAccount?.api_key || "", " API 密钥")
                  }
                >
                  复制
                </Button>
                <Button
                  type="button"
                  appearance="subtle"
                  icon={<Key24Regular />}
                  onClick={handleRegenerateKey}
                >
                  重置
                </Button>
              </div>
            </div>

            <Button
              appearance="primary"
              type="submit"
              icon={<Save24Regular />}
              disabled={savingConfig}
            >
              {savingConfig ? <Spinner size="tiny" /> : "保存集控设置"}
            </Button>
          </form>
        </div>

        <div className="card">
          <div className="card-title">
            <span>修改管理密码</span>
            <Key24Regular style={{ color: "var(--accent-color)" }} />
          </div>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label className="form-label">当前密码</label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(_, d) => setOldPassword(d.value)}
                placeholder="输入当前正在使用的管理密码"
                style={{ width: "100%" }}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">新密码</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(_, d) => setNewPassword(d.value)}
                placeholder="至少 4 位字符"
                style={{ width: "100%" }}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">确认新密码</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(_, d) => setConfirmPassword(d.value)}
                placeholder="再次输入新密码"
                style={{ width: "100%" }}
                required
              />
            </div>
            <Button
              appearance="primary"
              type="submit"
              disabled={changingPwd || !oldPassword || !newPassword || !confirmPassword}
            >
              {changingPwd ? <Spinner size="tiny" /> : "更新密码"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
