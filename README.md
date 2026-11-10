# MINI ClassIsland STE (`miniclassisland/ste`)

<p align="center">
  <a href="https://miniclassisland.com" target="_blank" rel="noopener noreferrer">
    <img src="assets/miniclassisland.png" alt="MINI ClassIsland Logo" width="128" height="128" />
  </a>
</p>

> **MINI ClassIsland STE** — [ClassIsland](https://github.com/ClassIsland/ClassIsland) 轻量化单租户集中管控系统  
> 完整兼容上游 [Cyrene_MSP 协议 v2.0.0.0](https://github.com/ClassIsland/ClassIsland/tree/master/doc/Design/Cyrene_MSP)，基于全栈 Node.js / Next.js、SQLite 与 ConnectES 构建，单端口开箱即用。

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-green)](LICENSE)
[![Cyrene_MSP: v2.0.0.0](https://img.shields.io/badge/Cyrene__MSP-v2.0.0.0-indigo)](https://github.com/ClassIsland/ClassIsland)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2-61DAFB)](https://react.dev/)
[![Fluent UI v9](https://img.shields.io/badge/Fluent%20UI-v9-0078D4)](https://react.fluentui.dev/)
[![ConnectES v2](https://img.shields.io/badge/ConnectES-v2-2563EB)](https://connectrpc.com/)

> **提示**：单租户处于早期阶段，如需反馈，请前往 [miniclassisland.com](https://miniclassisland.com) 注册后加入 MINI ClassIsland 交流群反馈，感谢支持。

---

## 1. 概述

**MINI ClassIsland STE** 是面向单体学校、年级组或实验室场景打造的轻量化单租户 ClassIsland 终端集中管理平台。相比多租户集群版，单租户版将整套架构收敛为单一 Node.js / Next.js 技术栈与内置 SQLite 数据库，无需额外部署 Python、PostgreSQL 或 Redis，默认通过单一端口 `:21196` 同时承载 Web 集控工作台、终端配置分发与 Cyrene_MSP gRPC 双向通信服务。

---

## 2. 核心架构特点

1. **极简单一技术栈**：
   - 基于 Node.js 原生内置 `node:sqlite` 持久化存储全部档案、终端与审计记录，数据默认保存于 `data/ste.db`。
   - 内置单端口双协议网关（`server.mjs`），在默认端口 `:21196` 上自动识别并分流 HTTP/1.1 Web 访问与 HTTP/2 ClearText（`h2c`）原生 gRPC 流量。
2. **ConnectES 安全栈与协议实现**：
   - 使用 `@connectrpc/connect`、`@connectrpc/connect-node` 与 `@bufbuild/protobuf` 完整实现上游 `Handshake`、`ClientRegister`、`ClientCommandDeliver`、`ConfigUpload`、`Audit` 五大 gRPC 服务及 `SteSecurityGateway` 安全网关服务。
   - 结合 `openpgp` 自动完成服务端 RSA-2048 密钥对生成、终端握手验签与会话认证。
3. **Next.js 服务端水合与动作调用**：
   - 移除对外暴露的管理端 REST API，全面采用 Next.js Server Components 首屏水合与 Server Actions 处理集控业务操作。
   - 采用单密码认证模式，首次访问通过初始化向导设置管理密码与学校名称即可完成部署。

---

## 3. 核心功能模块

| 模块 | 路径 | 功能特性 |
| :--- | :--- | :--- |
| **初始化向导与密码认证** | `/oobe` · `/login` | 首次启动引导配置学校名称、集控标识与管理密码；采用单密码与 ConnectES 安全网关完成管理会话认证。 |
| **集控总览仪表盘** | `/` | 实时展示已注册设备总数、当前在线设备与待审批配对请求，支持一键生成并下载可直接导入教室终端的 `ManagementPreset.json`，以及向全校广播通知或远程控制指令。 |
| **7 类配置资源可视化编辑器** | `/profiles` | 完整对齐上游 ClassIsland 数据结构，提供可视化表单与原始 JSON 双模式编辑及历史版本回滚：<br>1. `Subjects`（科目表）<br>2. `TimeLayout`（时间表）<br>3. `ClassPlan`（课表）<br>4. `DefaultSettings`（默认设置）<br>5. `Policy`（集控策略）<br>6. `Components`（组件配置）<br>7. `Credentials`（凭据管理） |
| **终端设备管控与远程日志** | `/clients` | 查看终端在线状态、IP 与硬件 MAC；支持单台或批量重启、强制同步配置、按班级分配独立档案、重置设备绑定 IP，以及远程拉取终端运行日志与配置快照。 |
| **校园通知与紧急广播** | `/notifications` | 向指定终端或全校在线终端推送横幅通知，支持遮罩标题、正文、语音播报、音效、紧急闪烁模式、重复次数与持续时长实时预览。 |
| **终端准入控制** | `/pairing` | 支持开放自动准入、6 位动态配对码人工审批、预注册白名单三种准入模式及 CSV 批量导入。 |
| **安全审计日志** | `/audit` | 按事件类型与终端筛选查看解码后的 Protobuf 审计事件详情。 |
| **安全设置** | `/security` | 管理集控基础信息、客户端接入地址、轮换接口密钥以及修改管理密码。 |

---

## 4. 快速开始

### 4.1 环境要求

- Node.js `>= 22.5.0`（支持内置 `node:sqlite` 模块）
- npm `>= 10.0`

### 4.2 安装与运行

```bash
# 安装依赖
npm install

# 开发模式启动（默认监听 http://0.0.0.0:21196）
npm run dev

# 构建生产环境产物
npm run build

# 生产模式启动（默认监听 http://0.0.0.0:21196）
npm start
```

### 4.3 环境变量（可选）

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `21196` | 服务监听端口（同时提供 HTTP Web 面板与 gRPC 终端接入） |
| `HOSTNAME` | `0.0.0.0` | 服务绑定监听地址 |
| `STE_DATA_DIR` | `./data` | SQLite 数据库文件（`ste.db`）存储目录 |

---

## 5. 反馈与交流

单租户处于早期阶段，如需反馈，请前往 [miniclassisland.com](https://miniclassisland.com) 注册后加入 MINI ClassIsland 交流群反馈，感谢支持。

---

## 6. 开源协议

- 所有 Git Commit 必须使用 SSH 或 GPG 密钥签名（`git commit -S`）。
- 本项目基于 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开源。
