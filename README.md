# AssistFlow

独立前端开发者个人主页 AI 助手。访客可以了解开发服务、报价方式、合作流程、技术栈、作品集、档期、招聘合作和个人背景，也可以通过项目或咨询编号查询公开进展。

项目默认使用本地 FAQ，不依赖外部模型。只有访客明确要求“转人工”（转人工 / 找人工 / 真人沟通）时，系统才会创建跟进事项并进入本人沟通流程。

[![CI](https://github.com/suijiafeng/ai-customer-support-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/suijiafeng/ai-customer-support-chat/actions/workflows/ci.yml)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-2f855a)
![SSE](https://img.shields.io/badge/realtime-SSE-2457c5)
![Local FAQ](https://img.shields.io/badge/default-local%20FAQ-f59e0b)

## 界面速览

### 客服工作台 · 接待大厅抢单 + AI 诊断

![客服工作台](./docs/screenshots/workstation-chat-effect-desktop.png)

> 左侧「接待大厅」是未被认领的会话，对全体客服可见，**发出第一条消息即接管**——不需要单独的抢单接口，判定与写入在同一个原子操作里完成。右侧会话详情里带 AI 诊断：最近意图、情绪、是否需要人工、命中的知识库条目及其得分——客服接手前就知道 AI 之前判断了什么。

### 嵌入式 widget · 一行 script 挂到任意页面

![嵌入效果](./docs/screenshots/demo-widget-chat-effect-desktop.png)

> widget 构建为**单个 IIFE 文件**，用 Shadow DOM 隔离样式，不依赖宿主页面的框架版本。配置从 script 标签读取，`apiBase` 默认取脚本自身的 origin——方便用同域反向代理隐藏真实 server 域名。

<details>
<summary>更多截图（演示站首页 / 客服登录）</summary>

![演示站](./docs/screenshots/demo-home-desktop.png)

![客服登录](./docs/screenshots/workstation-login-desktop.png)

</details>


## 快速开始（推荐）

```bash
npm install
npm run start -- dev
```

启动后可直接访问：

- Widget 演示页：`http://localhost:5175/`
- 工作台：`http://localhost:5174/`
- 健康检查：`http://localhost:3001/api/health`

> 若你使用 `npm run start`（prod）并遇到端口占用，可改用 `npm run start -- dev`，
> 或在截图命令里通过 `--base` 指向当前可访问地址（如 `http://localhost:3002`）。

## 核心场景

负面情绪、投诉、知识库未命中和查询不到编号都不会自动转本人。系统会继续使用 FAQ 回答，或提示访客补充信息。

## 仓库结构（monorepo）

```
packages/shared        前后端共享的 TS 类型与常量
apps/server            NestJS 后端（API + 静态产物托管）
apps/workstation       React 开发者工作台
apps/widget            React 嵌入式聊天组件（构建为单文件 widget.js）
apps/demo              演示站（widget 嵌入演示，仅消费产物与公开 API）
```

## 客服账号与鉴权

客服工作台需登录（JWT）。演示账号在 `apps/server/data/agents.json`，共三个客服（`9527` 为管理员）：

| 工号 | 显示名称 | 演示密码 | 角色 |
|------|----------|----------|------|
| `9527` | 客服9527 | `123456` | 管理员（admin） |
| `9528` | 客服9528 | `123456` | 普通客服 |
| `9529` | 客服9529 | `123456` | 普通客服 |

- 角色写入 JWT：管理员可见/可操作全部会话与工单；普通客服只看「接待大厅 + 自己接待的」。
- 客服侧接口（队列、回复、工单、指标）要求 `Authorization: Bearer <token>`；SSE 通过 `?token=` 传递。
- 会话详情与会话 SSE 做可选鉴权：带客服 token 的非归属者（且非管理员）返回 403；不带 token 的访客（widget）正常放行。
- 客服身份只来自已验证 token，请求体里的身份字段不再被信任。
- 生产部署请设置环境变量 `AUTH_SECRET`（JWT 签名密钥）。

### 访客会话凭证

`GET /api/sessions/:sessionId` 与它的 SSE **需要访客令牌**。

原因：`sessionId` 是浏览器端生成的（`widget/src/visitorId.ts` 里的校验和自己就写明「只用于检测本地存储被改动/损坏，并非防伪造的安全签名」），服务端对它零校验。如果不鉴权，知道 sessionId 就能读到完整对话——而 sessionId 会出现在 URL、访问日志、前端埋点里，「难猜」不等于「不可获得」。

- 服务端在**每次对话响应**里下发 `visitorToken`（绑定该 sessionId，TTL 7 天，每次对话顺带续期）
- 访客侧读取时出示：REST 走 `x-visitor-token` 请求头，SSE 走 `?vt=` 查询串（`EventSource` 无法自定义请求头，与客服的 `?ticket=` 同理）
- 令牌里带 `kind: 'visitor'` 并强制校验——**客服 token 与 SSE 票据不能冒充访客令牌，反之亦然**
- 客服携带自己的 token 访问则走原有的归属判定，不受影响
- 存量灰度：`ALLOW_ANON_SESSION_READ=true` 可临时放行不带令牌的请求，线上 widget 全部升级后应关闭

> 不用 Cookie 是因为 widget 嵌在第三方页面里，跨站 Cookie 需要 `SameSite=None` 且正被各浏览器默认拦截。代价是同源 XSS 能读到 localStorage 里的令牌——但该令牌只能读这一个会话，而能执行 XSS 的脚本本来就在同一页面上下文里。

### 接待大厅与抢单

- 未被认领（`assignedAgentId` 为空）且未关闭的会话进入「接待大厅」，对所有客服可见。
- **发首条消息即接待**：客服回复后该会话归为自己的，从接待大厅消失，进入「我的会话」；其他普通客服不再可见。并发下后到者收到 409。
- 跟进事项（工单）归属随会话：普通客服只看「自己的 + 未认领」，管理员看全部；改状态/优先级、加备注需归属人或管理员。
- 数据看板用 ECharts 展示饼图（会话状态）/柱状图（待办负载）/折线图（按本地日期的每日趋势，存于浏览器本地）。

## 入口

| 页面 | 本地地址 | 用途 |
|------|----------|------|
| Widget 嵌入演示 | http://localhost:3001/ | 模拟第三方网站嵌入 widget |
| 开发者工作台 | http://localhost:3001/workstation/ | React 会话工作台 |
| 健康检查 | http://localhost:3001/api/health | 服务、FAQ 和项目咨询数据状态 |

## 运行（三套环境）

需要 Node.js 22+。首次准备：

```bash
npm install
# 共享兜底配置已在 .env（可提交）；本机私有配置/密钥写到 .env.local（不提交）
# 加载优先级：真实环境变量 > .env.local > .env
```

统一入口 `npm run start` 按模式分发（也可直接用对应子脚本）：

```bash
npm run start -- dev    # 开发模式（= dev:all，热更新）
npm run start           # 生产模式（先 build 再跑打包产物，默认）
npm run start -- demo   # 演示模式（build 产物 + vite preview 模拟第三方嵌入）
```

### 1. 开发环境（改代码热更新）

```bash
npm run start -- dev    # 等价于 npm run dev:all
```

一条命令并行启动 5 个进程（首次会自动预构建 shared 与 widget）：

| 进程 | 说明 |
|------|------|
| shared | `tsc --watch`，类型/常量改动自动重编译并传导到前后端 |
| server | `tsc --watch` + `node --watch`，改 `.ts` 自动重编译重启（http://localhost:3001） |
| widget | Vite dev（http://localhost:5173，模拟宿主预览页） |
| workstation | Vite dev（http://localhost:5174，登录 9527/123456） |
| demo | Vite dev（http://localhost:5175，/widget 与 /workstation 代理到 3001） |

三个前端的 `/api` 都代理到 3001，SSE / 登录在 dev 下可直接使用。

### 2. 演示环境（单机以生产形态跑构建产物）

```bash
npm run build       # shared → server → widget → workstation → demo
npm run start       # NestJS 托管 API + 三套前端产物，http://localhost:3001
```

- 入口：`/`（widget 嵌入演示）、`/workstation/`（客服工作台）、`/widget/widget.js`（嵌入脚本）。
- 默认使用本地 SQLite 持久化（`apps/server/data/assistflow.db`），重启不丢；纯内存调试可设 `DB_DRIVER=memory`。
- 建议在 `.env.local` 中设置 `AUTH_SECRET`（`openssl rand -hex 32`），避免使用内置开发密钥。

### 3. 生产环境（Docker / Render）

```bash
# 本地或自托管：构建并运行生产镜像（挂卷以持久化 SQLite）
docker build -t assistflow .
docker run -d --name assistflow -p 3001:3001 \
  -v assistflow_data:/data \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  assistflow
```

- 镜像默认走 SQLite，库文件写在容器内的 `/data` 卷，**自托管必须挂卷才能持久化**（否则容器重建即丢，如上 `-v assistflow_data:/data`）。想用 Postgres 时追加 `-e DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"`。
- 持久化（`DB_DRIVER` 选择后端，默认 `sqlite`）：
  - **SQLite（默认）**：零配置，库文件 `/data/assistflow.db`（镜像已设 `SQLITE_PATH` 并声明 `VOLUME /data`）；镜像启动已带 `--experimental-sqlite`。挂卷即持久。
  - **Postgres**：设置 `DATABASE_URL`（Neon/Supabase 等），会话/消息/工单写穿透入库。
  - **memory**：`DB_DRIVER=memory`，纯内存、重启清空。
- **Render**：推送到 main 后按 `render.yaml` 自动 Docker 部署；`AUTH_SECRET` 由 Render 自动生成。注意 Render 文件系统是临时的（free 无持久磁盘），SQLite 重新部署会清空——要持久化请填 `DATABASE_URL` 用外部 Postgres，或付费挂 Disk 到 `/data`。
- 生产强制要求 `AUTH_SECRET`（`NODE_ENV=production` 且缺失时拒绝启动）。
- 健康检查：`/api/health`（Render 用 healthCheckPath，本地 docker 用镜像内 HEALTHCHECK）。
- CI 会构建生产镜像并启动验证健康检查，保证 Dockerfile 不漂移。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_ENABLED` | `false` | AI 模型总开关；默认只使用本地 FAQ |
| `AI_PROVIDER` | `openai` | `openai` 或 `deepseek` |
| `OPENAI_API_KEY` | — | OpenAI API Key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI 模型 |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek 模型 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek 接口地址 |
| `PORT` | `3001` | 服务监听端口 |
| `AUTH_SECRET` | 开发默认值 | 客服 JWT 签名密钥；**生产必须设置**（缺失拒绝启动） |
| `DB_DRIVER` | 自动推断 | 持久化后端：`sqlite`（默认）/ `postgres` / `memory`；不设时配了 `DATABASE_URL` 走 postgres，否则 sqlite |
| `DATABASE_URL` | — | Postgres 连接串（设置即用 Postgres） |
| `SQLITE_PATH` | `DATA_DIR/assistflow.db` | SQLite 库文件路径（Docker 镜像内为 `/data/assistflow.db`） |
| `DATA_DIR` | `apps/server/data` | faqs/inquiries/agents 数据目录 |
| `NODE_ENV` | — | `production` 时收紧错误信息并强制 AUTH_SECRET |
| `ALERT_WEBHOOK_URL` | — | 持久化写入失败时的告警 webhook（接受 JSON POST `{ text }`，如 Slack Incoming Webhook）；留空不告警，同一 5 分钟窗口内最多触发一次 |

> 配置文件：`.env` 为可提交的安全兜底，私有配置与密钥写入 `.env.local`（已 gitignore）。加载优先级：真实环境变量 > `.env.local` > `.env`。SQLite 默认启用，需 Node 以 `--experimental-sqlite` 启动（`npm run start` 与 Docker 镜像已自动带上）。

设置 `AI_ENABLED=true` 且配置对应 API Key 后，FAQ 会作为模型回答上下文。模型失败时仍会自动降级到本地 FAQ。

## 本地知识库

FAQ 位于 `apps/server/data/faqs.json`：

```json
{
  "id": "pricing",
  "intent": "pricing",
  "question": "项目怎么报价？",
  "answer": "请提供需求范围后评估报价。",
  "keywords": ["报价", "价格", "预算"]
}
```

项目和咨询的公开进展位于 `apps/server/data/inquiries.json`：

```json
{
  "id": "P1001",
  "title": "个人品牌官网改版",
  "type": "项目",
  "statusText": "方案与报价已发送",
  "nextStep": "等待确认需求范围和启动时间",
  "eta": "确认后可安排开发排期"
}
```

修改数据后需要重启服务。

### 知识库治理（建议）

- FAQ 可选元字段（用于运营治理，不影响现有检索）：
  - `audience`: 面向对象（如 `new_lead` / `existing_client`）
  - `stage`: 访客阶段（如 `discovery` / `scoping` / `quoting` / `delivery` / `support`）
  - `confidenceNote`: 需要人工确认的边界提示
  - `tags`: 运营标签
  - `lastReviewedAt`: 最近复审日期（`YYYY-MM-DD`）

- 未命中转 FAQ 草稿（先人工复核再入库）：

```bash
# 从知识库统计导出（或手工整理）的 miss.json 生成 FAQ 草稿
npm run kb:drafts -- --input miss.json --top 20 --out faq-drafts.json
```

`miss.json` 支持两种格式：

```json
[{"query":"你们支持驻场吗","count":8,"lastSeen":"2026-06-28T12:00:00.000Z"}]
```

或：

```json
{"topMissQueries":[{"query":"你们支持驻场吗","count":8,"lastSeen":"2026-06-28T12:00:00.000Z"}]}
```

## 对话流程

```mermaid
flowchart LR
  A["访客发送消息"] --> B["意图识别 / FAQ 检索 / 项目咨询查询"]
  B --> C{"明确要求转人工?"}
  C -- 否 --> D["本地 FAQ 或可选 AI 回复"]
  C -- 是 --> E["建立跟进事项"]
  D --> F["保存消息与会话"]
  E --> F
  F --> G["SSE 同步访客页与开发者工作台"]
  G --> H["开发者本人接入"]
  H --> I["AI 静默，进入本人沟通"]
```

## API 概览

```text
GET  /api/health                    服务、AI、FAQ 和项目咨询数据状态
GET  /api/faqs                      本地 FAQ
GET  /api/sessions                  会话队列（按客服归属过滤：管理员看全部）
GET  /api/sessions/events           SSE：队列实时推送（按订阅者归属过滤）
GET  /api/sessions/:id              单个会话详情（带 token 的非归属者 403）
GET  /api/sessions/:id/events       SSE：会话实时推送（同上可选鉴权）
GET  /api/tickets                   跟进事项列表（普通客服只看 自己的 + 未认领）
GET  /api/metrics                   运营指标

POST /api/auth/login                客服登录（工号+密码 → JWT，含角色）
POST /api/chat                      访客发送消息
POST /api/sessions/:id/messages     客服回复（需 JWT；首条消息即接待该会话）
POST /api/sessions/:id/profile      更新访客资料（需 JWT，归属人/管理员）
POST /api/sessions/:id/resolve      标记会话已解决（归属人/管理员）
PATCH /api/tickets/:id              更新跟进事项（归属人/管理员）
POST /api/tickets/:id/notes         追加处理备注（归属人/管理员）
```

## 验证

```bash
npm run build
npm test                       # 单元测试（rules/store/auth/config）
# 启动已构建的服务（SQLite 需 --experimental-sqlite；冒烟会自动等待 /api/health 就绪）
node --experimental-sqlite --disable-warning=ExperimentalWarning apps/server/dist/main.js &
npm run smoke                  # 接口回归用例（含鉴权、归属过滤；启动前会轮询就绪）
node scripts/dialog-test.js    # 访客↔客服对话时序回归

```
`SMOKE_BASE_URL` 可指向其他环境（默认 http://localhost:3001）。

## 当前限制

- 运行时以内存为事实来源，写穿透到持久化后端（默认 SQLite，可切 Postgres / memory）。
- 每日趋势图基于浏览器 localStorage 累积、按本地日期分桶，故各端各自独立、清缓存即重置。
- FAQ 使用关键词和字符匹配，不是语义向量检索。
- 客服账号为静态配置（agents.json），暂无账号管理界面。
- 图片附件当前使用 Base64 存储，不适合生产环境。

## 部署

仓库包含 `Dockerfile` 和 `render.yaml`。部署时默认使用本地 FAQ；如需启用模型，在平台环境变量中设置 `AI_ENABLED=true` 和对应 API Key。

默认 `Dockerfile` 只构建 server（纯 API），widget/workstation/demo 不在镜像里，需要按下面的方式各自独立部署。

### 拆分部署（server / workstation / widget / demo 各自独立）

**server**：按上面的 Docker 说明构建部署即可（`docker build` 用的就是收窄后的 server-only 镜像）。CORS 默认全开，**不建议收紧 `CORS_ORIGINS`**——`/api/chat` 需要能被任意第三方网站的 widget 跨域调用，收紧会连带堵死这个能力。

**workstation**（客服工作台）：在静态托管平台（Cloudflare Pages / Vercel / Netlify 等）连接本仓库，配置：
- 构建命令：`npm ci && npm run build --workspace @assistflow/shared && npm run build --workspace assistflow-workstation`（必须从仓库根目录跑 `npm ci`，让 npm workspaces 的符号链接生效）
- 产物目录：`apps/workstation/dist`
- 环境变量：`VITE_API_BASE=https://<server 部署域名>`、`VITE_BASE_PATH=/`（默认构建产物假设被 server 挂在 `/workstation/` 子路径下，独立部署要显式设成根路径）

**widget**（嵌入组件）：
- 构建命令：`npm ci && npm run build --workspace @assistflow/shared && npm run build --workspace assistflow-widget`
- 产物目录：`apps/widget/dist`（只有一个 `widget.js`），上传到静态托管/CDN 即可，不需要环境变量
- 第三方网站嵌入：`<script src="https://<widget 部署域名>/widget.js" data-key="租户密钥" data-name="租户ID"></script>`（密钥与租户ID在工作台「租户管理」创建后复制；`data-key`、`data-name` 必填且必须匹配；租户配置了域名时，还会校验请求来源域名，未配置则不校验）
- 默认情况下，widget 会把 `widget.js` 所在域名作为 API 基址，请在该域名/CDN 上把 `/api/*` 反向代理到 server。这样嵌入代码不需要暴露 server 部署域名。若无法配置代理，也可以继续显式传 `data-api-base="https://<server 部署域名>"`，但浏览器网络请求仍会暴露真实 API 地址，前端加密无法隐藏它。

**demo**（widget 嵌入演示站，可选，不部署也不影响 server/workstation/widget 正常工作）：
- 构建命令：`npm ci && npm run build --workspace @assistflow/shared && npm run build --workspace assistflow-demo`
- 产物目录：`apps/demo/dist`
- 环境变量：`VITE_WIDGET_SRC=https://<widget 部署域名>/widget.js`、`VITE_WORKSTATION_URL=https://<workstation 部署域名>`；仅在没有同域 `/api` 代理时才设置 `VITE_API_BASE=https://<server 部署域名>`

以上环境变量不设置时都会回退成"由 server 同源托管"的默认行为，本地 `npm run dev:all`、`npm run start`、`npm run start -- demo` 不受影响。

### 一键自托管（docker compose）

不想分别推到多个静态托管平台时，可以用 `docker-compose.yml` 在同一台机器上把 postgres + 四个部分作为独立容器跑起来（server 仍是纯 API，workstation/widget/demo 各自 nginx 托管静态产物；持久化默认用 compose 里自带的 Postgres）：

```bash
export AUTH_SECRET=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
docker compose up --build
```

- server: http://localhost:3001
- workstation: http://localhost:8081
- widget: http://localhost:8082/widget.js
- demo: http://localhost:8080
- postgres: 容器内网络 `postgres:5432`（不对外暴露端口），数据落盘在 `postgres_data` 具名卷

默认持久化用本地 Postgres（`DATABASE_URL` 按 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` 自动拼好，连到 compose 里的 `postgres` 服务）。想接外部 Postgres（Neon/Supabase）就设 `DATABASE_URL` 覆盖；想改回零配置 SQLite 就设 `DB_DRIVER=sqlite`（此时可以从 `docker-compose.yml` 里去掉 `postgres` 服务与 `server` 的 `depends_on`）。

其余可覆盖的环境变量：构建时注入的跨服务地址 `WORKSTATION_API_BASE`、`DEMO_WIDGET_SRC`、`DEMO_API_BASE`、`DEMO_WORKSTATION_URL`（默认已指向上面几个本地端口）；透传给 server 的 `AI_ENABLED`/`AI_PROVIDER`/`OPENAI_API_KEY`/`DEEPSEEK_API_KEY`。生产场景仍建议按上面「拆分部署」把 workstation/widget/demo 放到 CDN。
