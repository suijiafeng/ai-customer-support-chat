# AssistFlow — AI 智能客服系统

全栈客服 Chat 系统，支持 AI 自动接管、实时人工转接与客服工作台。无 API Key 时自动切换本地规则模式，开箱即用。

## 在线体验

当前仓库已准备好 Render Blueprint 与 Docker 部署配置。拿到线上域名后，将下面的 `<demo-url>` 替换为实际地址，并放在 GitHub Profile 的代表作品区。

| 入口 | 地址 | 用途 |
|------|------|------|
| 在线预览 | `<demo-url>` | 项目总入口 |
| 客户入口 | `<demo-url>/` | 访客发起咨询、订单查询、AI 回复、转人工 |
| 客服入口 | `<demo-url>/agent.html` | 查看会话队列、AI 诊断、工单和人工回复 |
| 健康检查 | `<demo-url>/api/health` | 确认服务、FAQ 和示例订单数据可用 |

测试账号：当前 Demo 不需要登录。客户页会自动生成访客身份，客服工作台可直接进入。

测试话术：

- `帮我查一下订单 A1001`
- `我的订单 B2026 什么时候发货`
- `R3308 退款进度怎么样`
- `我要投诉，找人工客服`

## 项目定位

很多 AI 客服 Demo 依赖外部模型 Key 和理想网络环境，一旦缺少配置就无法完整演示。AssistFlow 的核心目标是：**即使没有 API Key，也能跑通客户咨询、AI 回复、转人工、客服接入和工单生成的完整链路**。

这个项目更关注真实客服场景里的前端与交互问题：

- 客户侧如何快速获得回复，并在复杂问题上顺畅转人工
- 客服侧如何看到会话队列、历史消息、AI 诊断和处理状态
- AI 回复、规则兜底、人工接入三种状态如何避免互相冲突
- 网络、存储、接口异常时，页面如何保持可用

## 界面预览

### 客户对话页

客户侧入口面向真实业务咨询场景，支持访客识别、快捷问题、AI 自动响应和人工转接。

![客户对话页](docs/images/customer-chat.png)

客户侧关键区域：

| 品牌与服务承诺 | 对话处理区 |
|----------------|------------|
| ![客户侧品牌区](docs/images/customer-hero-detail.png) | ![客户侧对话区](docs/images/customer-conversation-detail.png) |

### 客服工作台

客服侧工作台提供会话队列、聊天记录、AI 诊断、工单状态和快捷回复，便于人工客服接入处理。

![客服工作台](docs/images/agent-workbench.png)

工作台关键区域：

| 会话队列 | 人工处理区 | 智能诊断 |
|----------|------------|----------|
| ![客服会话队列](docs/images/agent-queue-detail.png) | ![客服聊天处理区](docs/images/agent-chat-detail.png) | ![智能诊断面板](docs/images/agent-diagnostics-detail.png) |

## 功能

- **AI 自动接管** — 接入 OpenAI（GPT-4o）或 DeepSeek；无 Key 时降级为本地 FAQ 匹配 + 规则引擎
- **智能转人工** — 自动检测负面情绪、投诉关键词、未命中意图，触发人工接入流程
- **实时客服工作台** — SSE 推送会话队列、聊天记录、AI 诊断面板（意图 / 情绪 / 转人工原因）
- **工单系统** — 高优先级会话自动生成工单，支持优先级标记
- **人工接入后 AI 静默** — 人工客服加入会话后，AI 自动停止回复该会话
- **业务数据查询** — 内置示例订单数据，可演示订单状态、退款和售后类问答

## 工程亮点

| 设计点 | 处理方式 | 价值 |
|--------|----------|------|
| 无 Key 可演示 | 未配置 OpenAI / DeepSeek 时自动切换本地 FAQ + 规则引擎 | 降低演示门槛，保证核心流程始终可跑 |
| AI 与人工状态隔离 | 客服回复后会话进入人工处理状态，后续客户消息不再触发 AI 自动回复 | 避免 AI 与人工客服重复回复 |
| 实时能力可降级 | 优先使用 SSE 推送，会话页和工作台在不支持 `EventSource` 时自动轮询 | 兼容代理、WebView 和受限浏览器环境 |
| 前端异常兜底 | 处理非 2xx、非 JSON、网络失败和存储受限场景 | 避免客服工作流被单点异常打断 |
| 接口边界清晰 | 客户消息、客服回复、会话队列、工单列表拆分为独立 API | 便于后续接入鉴权、数据库和真实业务系统 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 服务端 | Node.js + Express 5 |
| AI 集成 | OpenAI SDK（兼容 GPT-4o / DeepSeek） |
| 实时推送 | Server-Sent Events (SSE) |
| 前端 | 原生 JS + CSS，无框架依赖 |

## 项目结构

```
├── server/
│   └── index.js          # Express 服务、AI 调用、会话管理
├── public/
│   ├── index.html        # 客户对话页面
│   ├── agent.html        # 客服工作台
│   ├── customer.js       # 客户端逻辑
│   ├── agent.js          # 工作台逻辑
│   └── styles.css        # 公共样式
├── data/
│   ├── faqs.json         # 知识库（可自行扩展）
│   └── orders.json       # 示例订单数据
├── docs/
│   └── images/           # README 项目截图
├── screenshot/           # 原始截图素材
└── scripts/
    └── smoke-test.js     # 集成冒烟测试
```

## 快速开始

需要 Node.js 18+。

```bash
git clone https://github.com/suijiafeng/ai-customer-support-chat.git
cd ai-customer-support-chat
npm install
cp .env.example .env   # 按需填入 API Key，不填也能运行
npm run dev
```

| 页面 | 地址 |
|------|------|
| 客户对话 | http://localhost:3001 |
| 客服工作台 | http://localhost:3001/agent.html |

## 云平台部署

### Render

仓库根目录已经包含 `render.yaml`，可在 Render 中创建 Blueprint 或 Web Service：

- Build Command：`npm ci`
- Start Command：`npm start`
- Health Check Path：`/api/health`
- Node Version：`22.12.0`

不配置 OpenAI / DeepSeek API Key 时，服务会使用本地规则模式，仍然可以完整演示客户咨询、AI 规则回复、转人工、客服接入和工单生成。

### Docker / Railway / Fly.io

也可以使用仓库内的 `Dockerfile` 部署：

```bash
docker build -t ai-customer-support-chat .
docker run --rm -p 3001:3001 ai-customer-support-chat
```

服务读取平台注入的 `PORT` 环境变量；没有注入时默认监听 `3001`。

## 演示建议

1. 打开客户对话页，输入 `帮我查一下订单 A1001`。
2. 客户侧会收到订单相关回复；如果命中转人工条件，会生成待处理工单。
3. 打开客服工作台，左侧选择新会话，查看聊天记录和 AI 诊断结果。
4. 使用快捷回复或手动输入内容，客服回复后该会话进入人工接入状态，AI 不再自动回复。

可测试订单：

| 订单号 | 场景 |
|--------|------|
| `A1001` | 已发货订单，包含物流信息 |
| `B2026` | 仓库处理中，适合演示发货咨询 |
| `R3308` | 退款审核中，适合演示退款进度 |

## 兼容与容错

- **无 API Key 可运行**：未配置 OpenAI 或 DeepSeek Key 时，服务自动使用本地 FAQ 和规则回复。
- **SSE 降级轮询**：浏览器或代理环境不支持 `EventSource` 时，客户页和客服工作台会自动改用定时轮询。
- **接口异常兜底**：前端会处理非 2xx 响应、非 JSON 响应和网络失败，避免页面直接中断。
- **存储受限兜底**：隐私模式或 WebView 禁用 `localStorage` 时，客户页仍可生成访客码并继续聊天。
- **人工接入保护**：客服回复后，同一会话进入人工处理状态，后续客户消息不再触发 AI 自动回复。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_PROVIDER` | `openai` | `openai` 或 `deepseek` |
| `OPENAI_API_KEY` | — | OpenAI API Key |
| `OPENAI_MODEL` | `gpt-4o` | 使用的 OpenAI 模型 |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 使用的 DeepSeek 模型 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek 接口地址 |
| `PORT` | `3001` | 服务监听端口 |

> 不配置 API Key 时，服务以本地规则模式运行，FAQ 匹配和转人工逻辑完整可用。

## 工作流程

```
客户发送消息
     │
意图检测 → 情绪分析 → FAQ 匹配
     │
是否需要转人工？
  ├─ 是 → 创建工单 → SSE 推送客服工作台
  └─ 否 → AI 生成回复（OpenAI / DeepSeek / 本地规则）
```

## 设计取舍

- **先保证完整流程，再接入更复杂模型能力**：本地 FAQ 和规则引擎不是临时替代品，而是为了让系统在无 Key、限流或模型异常时仍可继续处理常见咨询。
- **使用 SSE 而不是 WebSocket**：当前场景主要是服务端向客户页和客服工作台推送会话变化，SSE 更轻量，部署和调试成本更低。
- **前端保持无框架依赖**：项目重点放在客服流程、状态管理和容错逻辑上，避免框架配置掩盖核心业务交互。
- **会话与工单暂存内存**：当前版本便于本地演示和快速理解链路，后续可替换为数据库持久化。

## API 概览

```
GET  /api/health                    服务状态、模型信息
GET  /api/sessions                  客户会话队列
GET  /api/sessions/events           SSE：队列实时推送
GET  /api/sessions/:id              单个会话详情
GET  /api/sessions/:id/events       SSE：会话实时推送
GET  /api/tickets                   工单列表

POST /api/chat                      客户发送消息（触发 AI / 规则回复）
POST /api/sessions/:id/messages     客服人工回复
```

## 冒烟测试

```bash
npm run dev &
npm run smoke     # 7 个用例，覆盖核心流程
```

## 自定义知识库

编辑 `data/faqs.json`，每条记录格式：

```json
{
  "id": "unique_id",
  "intent": "意图分类",
  "question": "问题描述",
  "answer": "标准回答",
  "keywords": ["关键词1", "关键词2"]
}
```

重启服务后生效。

## 说明

- 会话、工单存储在进程内存中，服务重启后清空
- FAQ 使用关键词 + 字符匹配；如需语义检索可替换为向量数据库
- 鉴权层留作扩展点，可在客服工作台、会话 API 和工单 API 前统一接入

## 后续规划

- 接入数据库，持久化会话、消息和工单
- 增加客服登录、角色权限和操作审计
- 引入向量检索，支持更稳定的知识库问答
- 增加会话质检、满意度评价和统计看板
- 补充生产环境监控、日志和数据备份策略
