"use client";

import React, { useState, useRef } from "react";
import { accounts, data as dataApi, credentials as credApi } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { ManagementCredentialConfig } from "@/lib/types";
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
import {
  ArrowUpload24Regular,
  ArrowDownload24Regular,
  CheckmarkCircle24Regular,
  Document24Regular,
  Key24Regular,
} from "@fluentui/react-icons";

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  initialAccountId?: string;
}

type WizardStep = 1 | 2 | 3;

export default function OnboardingWizard({
  open,
  onClose,
}: OnboardingWizardProps) {
  const { accountId, currentAccount, reloadAccounts } = useAccount();

  const [step, setStep] = useState<WizardStep>(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Step 1: 上传并拆分客户端配置与档案
  const [profileImported, setProfileImported] = useState(false);
  const [profileStats, setProfileStats] = useState({
    subjects: 0,
    timelayouts: 0,
    classplans: 0,
  });
  const [settingsImported, setSettingsImported] = useState(false);
  const [componentsImported, setComponentsImported] = useState(false);

  const profileInputRef = useRef<HTMLInputElement>(null);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const componentsInputRef = useRef<HTMLInputElement>(null);

  // Step 2: 初始凭据密码配置
  const [userPassword, setUserPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Step 3: 生成并下载引导配置
  const [presetClassIdentity, setPresetClassIdentity] = useState("");

  const activeAccountId = accountId || "default";

  async function handleProfileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeAccountId) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;

      const subjectsMap =
        (parsed.Subjects as Record<string, unknown>) || {};
      const timeLayoutsMap =
        (parsed.TimeLayouts as Record<string, unknown>) || {};
      const classPlansMap =
        (parsed.ClassPlans as Record<string, unknown>) || {};
      const classPlanGroupsMap =
        (parsed.ClassPlanGroups as Record<string, unknown>) || undefined;

      await Promise.all([
        dataApi.write(activeAccountId, "Subjects", "default", {
          Name: (parsed.Name as string) || "导入科目",
          Subjects: subjectsMap,
        }),
        dataApi.write(activeAccountId, "TimeLayout", "default", {
          Name: (parsed.Name as string) || "导入时间表",
          TimeLayouts: timeLayoutsMap,
        }),
        dataApi.write(activeAccountId, "ClassPlan", "default", {
          Name: (parsed.Name as string) || "导入课表",
          ClassPlans: classPlansMap,
          ...(classPlanGroupsMap ? { ClassPlanGroups: classPlanGroupsMap } : {}),
        }),
      ]);

      setProfileStats({
        subjects: Object.keys(subjectsMap).length,
        timelayouts: Object.keys(timeLayoutsMap).length,
        classplans: Object.keys(classPlansMap).length,
      });
      setProfileImported(true);
      setMsg({
        type: "success",
        text: `已成功拆分并写入 Profile 档案：科目 ${Object.keys(subjectsMap).length} 门、时间表 ${Object.keys(timeLayoutsMap).length} 套、课表 ${Object.keys(classPlansMap).length} 张`,
      });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "解析或上传 Profile JSON 失败",
      });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleSettingsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeAccountId) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      await dataApi.write(activeAccountId, "DefaultSettings", "default", parsed);
      setSettingsImported(true);
      setMsg({
        type: "success",
        text: "Settings.json 已上传至默认应用设置",
      });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "解析或上传 Settings.json 失败",
      });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleComponentsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeAccountId) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      await dataApi.write(activeAccountId, "Components", "default", parsed);
      setComponentsImported(true);
      setMsg({
        type: "success",
        text: "Components.json 已上传至默认组件布局",
      });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "解析或上传 Components.json 失败",
      });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleSaveCredentialsAndNext() {
    if (!activeAccountId) {
      setStep(3);
      return;
    }
    if (!userPassword.trim() && !adminPassword.trim()) {
      setStep(3);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const currentCred = (await dataApi
        .read(activeAccountId, "Credentials", "default")
        .catch(() => ({}))) as ManagementCredentialConfig;
      const nextCred: ManagementCredentialConfig = { ...currentCred };

      if (userPassword.trim()) {
        const res = await credApi.encode(activeAccountId, userPassword.trim());
        nextCred.UserCredential = res.credential;
      }
      if (adminPassword.trim()) {
        const res = await credApi.encode(activeAccountId, adminPassword.trim());
        nextCred.AdminCredential = res.credential;
      }

      await dataApi.write(activeAccountId, "Credentials", "default", nextCred);
      setStep(3);
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "保存凭据失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadPreset() {
    if (!activeAccountId) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = await accounts.downloadPreset(
        activeAccountId,
        presetClassIdentity.trim() || undefined
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ManagementPreset.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg({
        type: "success",
        text: "ManagementPreset.json 已生成并开始下载",
      });
    } catch (err: unknown) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "下载引导文件失败",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      <DialogSurface style={{ minWidth: 620, maxWidth: 680 }}>
        <DialogBody>
          <DialogTitle>集控配置导入与引导向导</DialogTitle>
          <DialogContent>
            {/* 步骤进度条 */}
            <div className="wizard-steps">
              {[
                { num: 1, title: "导入客户端配置" },
                { num: 2, title: "安全与凭据" },
                { num: 3, title: "下载引导文件" },
              ].map((s) => (
                <div
                  key={s.num}
                  className={`wizard-step-item ${
                    step === s.num ? "active" : step > s.num ? "done" : ""
                  }`}
                >
                  <span className="wizard-step-badge">{s.num}</span>
                  <span>{s.title}</span>
                </div>
              ))}
            </div>

            {msg && (
              <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                <MessageBarBody>{msg.text}</MessageBarBody>
              </MessageBar>
            )}

            {/* Step 1: 导入客户端现有 Profile / Settings / Components */}
            {step === 1 && (
              <div className="fade-in">
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  您可以直接上传一台已配置好的 ClassIsland 客户端本地文件，系统将自动拆解并写入集控云端默认档案。也可直接跳过稍后在网页可视化编辑器中编写。
                </p>

                <input
                  ref={profileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleProfileUpload}
                />
                <input
                  ref={settingsInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleSettingsUpload}
                />
                <input
                  ref={componentsInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleComponentsUpload}
                />

                <div style={{ display: "grid", gap: 12 }}>
                  <div className="wizard-upload-row">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        1. 完整课表档案文件
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        位于客户端 Profiles/ 目录下的 .json 档案，上传后自动拆分为科目、时间表、课表三类云端资源
                      </div>
                      {profileImported && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--success-color)",
                            marginTop: 4,
                          }}
                        >
                          已导入：{profileStats.subjects} 门科目 / {profileStats.timelayouts} 套时间表 / {profileStats.classplans} 张课表
                        </div>
                      )}
                    </div>
                    <Button
                      appearance={profileImported ? "secondary" : "primary"}
                      icon={
                        profileImported ? (
                          <CheckmarkCircle24Regular />
                        ) : (
                          <ArrowUpload24Regular />
                        )
                      }
                      disabled={busy}
                      onClick={() => profileInputRef.current?.click()}
                    >
                      {profileImported ? "重新上传档案" : "上传 Profile.json"}
                    </Button>
                  </div>

                  <div className="wizard-upload-row">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        2. 应用全局设置文件
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        位于客户端根目录下的 Settings.json，包含窗口缩放、外观、天气与语音配置
                      </div>
                    </div>
                    <Button
                      appearance="secondary"
                      icon={
                        settingsImported ? (
                          <CheckmarkCircle24Regular />
                        ) : (
                          <Document24Regular />
                        )
                      }
                      disabled={busy}
                      onClick={() => settingsInputRef.current?.click()}
                    >
                      {settingsImported ? "已上传 Settings" : "上传 Settings.json"}
                    </Button>
                  </div>

                  <div className="wizard-upload-row">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        3. 主界面组件配置文件
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        位于客户端 Configs/Components/ 目录下的组件布局 JSON 文件
                      </div>
                    </div>
                    <Button
                      appearance="secondary"
                      icon={
                        componentsImported ? (
                          <CheckmarkCircle24Regular />
                        ) : (
                          <Document24Regular />
                        )
                      }
                      disabled={busy}
                      onClick={() => componentsInputRef.current?.click()}
                    >
                      {componentsImported ? "已上传组件配置" : "上传 Components.json"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: 安全凭据设置 */}
            {step === 2 && (
              <div className="fade-in">
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  设置下发给受控客户端的操作保护密码。当终端用户尝试修改本地课表、退出应用或脱离集控时将要求验证此密码。留空则默认不设密码保护。
                </p>
                <div className="form-group">
                  <label className="form-label">客户端普通用户密码</label>
                  <Input
                    type="password"
                    value={userPassword}
                    onChange={(_, d) => setUserPassword(d.value)}
                    placeholder="用于日常换课等普通授权验证"
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">客户端管理员密码</label>
                  <Input
                    type="password"
                    value={adminPassword}
                    onChange={(_, d) => setAdminPassword(d.value)}
                    placeholder="用于修改设置、退出集控等高权限验证"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            )}

            {/* Step 3: 下载引导文件 */}
            {step === 3 && (
              <div className="fade-in">
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  集控配置已准备就绪！请下载引导文件{" "}
                  <code className="mono-code">ManagementPreset.json</code>，将其放置在需要接入集控的 ClassIsland 客户端程序根目录（与 ClassIsland.exe 同级），启动客户端即可自动接入本集控中心。
                </p>

                <div className="form-group">
                  <label className="form-label">预设班级标识</label>
                  <Input
                    value={presetClassIdentity}
                    onChange={(_, d) => setPresetClassIdentity(d.value)}
                    placeholder="输入预设班级标识，留空生成通用引导文件"
                    style={{ width: "100%" }}
                  />
                  <div className="form-hint">
                    当前组织名称：{currentAccount?.name || "MINI ClassIsland 集控中心"}
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <Button
                    appearance="primary"
                    size="large"
                    icon={<ArrowDownload24Regular />}
                    disabled={busy}
                    onClick={handleDownloadPreset}
                  >
                    下载 ManagementPreset.json
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>

          <DialogActions>
            {step === 1 && (
              <>
                <Button appearance="secondary" onClick={onClose}>
                  关闭
                </Button>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() => setStep(2)}
                >
                  下一步：安全凭据
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button appearance="secondary" onClick={() => setStep(1)}>
                  上一步
                </Button>
                <Button
                  appearance="primary"
                  icon={<Key24Regular />}
                  disabled={busy}
                  onClick={handleSaveCredentialsAndNext}
                >
                  {busy ? <Spinner size="tiny" /> : "保存并下一步"}
                </Button>
              </>
            )}
            {step === 3 && (
              <>
                <Button appearance="secondary" onClick={() => setStep(2)}>
                  上一步
                </Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    reloadAccounts();
                    onClose();
                  }}
                >
                  完成向导
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
