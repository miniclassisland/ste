"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAccount } from "@/lib/account-context";
import { useHydrationData } from "@/components/Providers";
import { clients, pairing, accounts } from "@/lib/api";
import type { ClientDeviceOut, PairingCodeOut } from "@/lib/types";
import {
  Button,
  Spinner,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import {
  ArrowUpload24Regular,
  ArrowSync24Regular,
} from "@fluentui/react-icons";
import OnboardingWizard from "@/components/OnboardingWizard";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";

export default function HomePage() {
  const { accountId, currentAccount, reloadAccounts } = useAccount();
  const hydration = useHydrationData();

  const [clientList, setClientList] = useState<ClientDeviceOut[]>(
    hydration.initialClients || []
  );
  const [pairingList, setPairingList] = useState<PairingCodeOut[]>(
    hydration.initialPairings || []
  );
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [cl, pc] = await Promise.all([
        clients.list(accountId).catch(() => [] as ClientDeviceOut[]),
        pairing.listCodes(accountId).catch(() => [] as PairingCodeOut[]),
      ]);
      setClientList(Array.isArray(cl) ? cl : []);
      setPairingList(Array.isArray(pc) ? pc : []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onlineCount = clientList.filter((c) => c.status === "online").length;
  const pendingPairing = pairingList.filter(
    (p) => !p.approved && !p.used && p.status !== "rejected"
  ).length;
  const slugName = currentAccount?.slug || "default";

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">主页</h1>
          <p className="page-subtitle">
            {currentAccount
              ? `当前集控：${currentAccount.name}`
              : "MINI ClassIsland 集控中心"}
          </p>
        </div>
        <div className="flex gap-8">
          <Button
            appearance="secondary"
            icon={<ArrowSync24Regular />}
            onClick={() => {
              reloadAccounts();
              loadData();
            }}
          >
            刷新状态
          </Button>
          <Button
            appearance="secondary"
            icon={<ArrowUpload24Regular />}
            onClick={() => setWizardOpen(true)}
          >
            上传本地配置向导
          </Button>
          {currentAccount && (
            <DownloadPresetPopoverButton
              buttonText="下载客户端引导文件"
              appearance="primary"
              defaultFileName={`ManagementPreset-${slugName}.json`}
              onFetchData={() => accounts.downloadPreset(accountId)}
              onError={(text) => setMsg({ type: "error", text })}
            />
          )}
        </div>
      </div>

      {msg && (
        <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
          <MessageBarBody>{msg.text}</MessageBarBody>
        </MessageBar>
      )}

      {loading && clientList.length === 0 ? (
        <div className="empty-state">
          <Spinner size="medium" label="加载数据..." />
        </div>
      ) : (
        <>
          <div className="grid-3">
            <div className="stat-card">
              <div className="stat-value">{clientList.length}</div>
              <div className="stat-label">已注册设备总数</div>
            </div>
            <div className="stat-card">
              <div
                className="stat-value"
                style={{ color: "var(--success-color)" }}
              >
                {onlineCount}
              </div>
              <div className="stat-label">当前在线设备</div>
            </div>
            <div className="stat-card">
              <div
                className="stat-value"
                style={{
                  color:
                    pendingPairing > 0 ? "var(--warning-color)" : undefined,
                }}
              >
                {pendingPairing}
              </div>
              <div className="stat-label">待审批配对请求</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">集控工作流指引</div>
            <ol
              style={{
                paddingLeft: 20,
                color: "var(--text-secondary)",
                fontSize: 13,
                lineHeight: 2,
              }}
            >
              <li>
                点击右上角「上传本地配置向导」直接导入现有客户端文件，或在左侧「档案管理」中在线编辑科目、时间表与课表
              </li>
              <li>
                在「策略管理」与「凭据管理」中配置客户端权限锁与密码保护
              </li>
              <li>
                点击右上角「下载客户端引导文件」获取{" "}
                <code className="mono-code">ManagementPreset.json</code>{" "}
                并放入客户端程序目录
              </li>
              <li>
                在「配对码管理」或「预注册客户端」中准入终端，随后在「客户端管理」中实时分配档案与推送通知
              </li>
            </ol>
          </div>
        </>
      )}

      {wizardOpen && (
        <OnboardingWizard
          open={wizardOpen}
          initialAccountId={accountId}
          onClose={() => {
            setWizardOpen(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}
