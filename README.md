# AssistFlow

独立前端开发者个人主页 AI 助手。访客可以了解开发服务、报价方式、合作流程、技术栈、作品集、档期、招聘合作和个人背景，也可以通过项目或咨询编号查询公开进展。

项目默认使用本地 FAQ，不依赖外部模型。只有访客明确要求“联系开发者本人”或“转人工”时，系统才会创建跟进事项并进入本人沟通流程。

[![CI](https://github.com/suijiafeng/ai-customer-support-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/suijiafeng/ai-customer-support-chat/actions/workflows/ci.yml)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-2f855a)
![SSE](https://img.shields.io/badge/realtime-SSE-2457c5)
![Local FAQ](https://img.shields.io/badge/default-local%20FAQ-f59e0b)

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

客服工作台需登录（JWT）。演示账号在 `apps/server/data/agents.json`，共三个客服：

| 工号 | 显示名称 | 演示密码 |
|------|----------|----------|
| `9527` | 客服9527 | `123456` |
| `9528` | 客服9528 | `123456` |
| `9529` | 客服9529 | `123456` |

- 客服侧接口（队列、回复、工单、指标）要求 `Authorization: Bearer <token>`；SSE 通过 `?token=` 传递。
- 访客侧接口（`/api/chat`、会话详情与会话 SSE）保持公开，供 widget 使用。
- 客服身份只来自已验证 token，请求体里的身份字段不再被信任。
- 生产部署请设置环境变量 `AUTH_SECRET`（JWT 签名密钥）。

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
cp .env.example .env   # 按需修改；本地纯内存演示可不改
```

### 1. 开发环境（改代码热更新）

```bash
npm run dev:all
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
npm run build   # shared → server → widget → workstation → demo
npm start       # NestJS 托管 API + 三套前端产物，http://localhost:3001
```

- 入口：`/`（widget 嵌入演示）、`/workstation/`（客服工作台）、`/widget/widget.js`（嵌入脚本）。
- 未配置 `DATABASE_URL` 时数据存内存，重启即清空——适合演示。
- 建议在 `.env` 中设置 `AUTH_SECRET`（`openssl rand -hex 32`），避免使用内置开发密钥。

### 3. 生产环境（Docker / Render）

```bash
# 本地或自托管：构建并运行生产镜像
docker build -t assistflow .
cp .env.docker.example .env.docker
# 修改 .env.docker 中的 AUTH_SECRET / DATABASE_URL / AI Key
docker run -d --name assistflow -p 3001:3001 --env-file .env.docker assistflow
```

- 也可以直接使用 `-e` 传入变量，例如：

```bash
docker run -d --name assistflow -p 3001:3001 \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e AI_ENABLED=false \
  -e DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require" \
  assistflow
```

- **Render**：推送到 main 后按 `render.yaml` 自动 Docker 部署；`AUTH_SECRET` 由 Render 自动生成，`DATABASE_URL` / AI 密钥在后台填写。
- 生产强制要求 `AUTH_SECRET`（`NODE_ENV=production` 且缺失时拒绝启动）。
- 持久化：配置 `DATABASE_URL`（Neon/Supabase 等托管 Postgres），会话/消息/工单写穿透入库，重启自动恢复。
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
| `DATABASE_URL` | — | Postgres 连接串；留空则纯内存（重启清空） |
| `DATA_DIR` | `apps/server/data` | faqs/inquiries/agents 数据目录 |
| `NODE_ENV` | — | `production` 时收紧错误信息并强制 AUTH_SECRET |

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

## 对话流程

```mermaid
flowchart LR
  A["访客发送消息"] --> B["意图识别 / FAQ 检索 / 项目咨询查询"]
  B --> C{"明确要求联系本人?"}
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
GET  /api/sessions                  访客会话队列
GET  /api/sessions/events           SSE：队列实时推送
GET  /api/sessions/:id              单个会话详情
GET  /api/sessions/:id/events       SSE：会话实时推送
GET  /api/tickets                   跟进事项列表
GET  /api/metrics                   运营指标

POST /api/auth/login                客服登录（工号+密码 → JWT）
POST /api/chat                      访客发送消息
POST /api/sessions/:id/messages     客服回复（需 JWT）
POST /api/sessions/:id/profile      更新访客资料
POST /api/sessions/:id/resolve      标记会话已解决
PATCH /api/tickets/:id              更新跟进事项
```

## 验证

```bash
npm run build
npm test                       # 单元测试（rules/store/auth/config）
npm start &                    # smoke/dialog 需要服务已在运行
npm run smoke                  # 17 个接口回归用例（含鉴权）
node scripts/dialog-test.js    # 访客↔客服对话时序回归
```

`SMOKE_BASE_URL` 可指向其他环境（默认 http://localhost:3001）。

## 当前限制

- 运行时以内存为事实来源；配置 `DATABASE_URL` 后写穿透到 Postgres 持久化。
- FAQ 使用关键词和字符匹配，不是语义向量检索。
- 客服账号为静态配置（agents.json），暂无账号管理界面。
- 图片附件当前使用 Base64 存储，不适合生产环境。

## 部署

仓库包含 `Dockerfile` 和 `render.yaml`。部署时默认使用本地 FAQ；如需启用模型，在平台环境变量中设置 `AI_ENABLED=true` 和对应 API Key。
