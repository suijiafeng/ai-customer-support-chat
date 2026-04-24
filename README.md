# Customer Support Bot MVP

一个基于 Node.js + Express 的在线客服机器人 Demo。项目内置 FAQ 知识库、模拟订单数据、AI/规则回复、转人工工单和客服工作台，适合用于演示“AI 先响应，人工再兜底”的客服流程。

## 功能特性

- **用户聊天入口**：用户可输入问题、填写姓名/联系方式，并通过快捷按钮发起常见咨询。
- **FAQ 知识库检索**：根据关键词匹配发货、退款、发票、售后、转人工等问题。
- **订单状态查询**：识别订单号并返回本地模拟订单的物流、退款或处理状态。
- **智能转人工**：识别投诉、负面情绪、高风险退款等场景，自动生成待处理工单。
- **客服工作台**：查看客户队列、会话记录、AI 诊断、知识来源、订单信息和工单列表。
- **人工接入模式**：客服回复后，会话进入人工处理状态，后续用户消息不再触发 AI 自动回复。
- **实时同步**：使用 Server-Sent Events 同步客户队列和单个会话消息。
- **可选大模型回复**：支持 OpenAI 或 DeepSeek；未配置 API Key 时自动使用本地规则兜底。

## 技术栈

- Node.js / Express
- 原生 HTML、CSS、JavaScript
- OpenAI npm SDK
- Server-Sent Events
- 本地 JSON 数据源

## 项目结构

```text
.
├── data/
│   ├── faqs.json          # FAQ 知识库
│   └── orders.json        # 模拟订单数据
├── public/
│   ├── index.html         # 用户端页面
│   ├── agent.html         # 客服端页面
│   ├── customer.js        # 用户端交互逻辑
│   ├── agent.js           # 客服端交互逻辑
│   └── styles.css         # 页面样式
├── scripts/
│   └── smoke-test.js      # 冒烟测试脚本
├── server/
│   └── index.js           # Express API 与客服工作流
├── .env.example           # 环境变量示例
├── package.json
└── README.md
```

## 快速启动

建议使用 Node.js 18 或更高版本。

```bash
npm install
cp .env.example .env
npm run dev
```

默认服务地址：

```text
http://localhost:3001
```

页面入口：

- 用户端：`http://localhost:3001/`
- 客服端：`http://localhost:3001/agent.html`

两个页面都支持指定会话参数，便于复现同一条客户会话：

```text
http://localhost:3001/?sessionId=customer-demo
http://localhost:3001/agent.html?sessionId=customer-demo
```

如果用户端 URL 没有 `sessionId`，前端会自动生成访客码和会话 ID，并写入地址栏与 `localStorage`。

## 环境变量

复制 `.env.example` 后按需修改：

```env
PORT=3001
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.2
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

### 本地规则模式

不配置 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` 时，服务仍可正常运行，会基于 FAQ、订单数据和转人工规则生成回复。

### OpenAI 模式

```env
AI_PROVIDER=openai
OPENAI_API_KEY=你的_openai_key
OPENAI_MODEL=gpt-5.2
```

### DeepSeek 模式

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的_deepseek_key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

DeepSeek 使用 OpenAI 兼容接口，本项目复用 `openai` npm SDK，并通过 `baseURL` 切换供应商。

接口响应中会返回 AI 调用状态：

```json
{
  "ai": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "used": true,
    "fallback": false,
    "error": null
  }
}
```

如果模型接口失败，系统会自动回退到本地规则回复，并在 `ai.fallback` 和 `ai.error` 中记录原因。

## 使用流程

1. 打开用户端，输入咨询内容，例如“帮我查一下订单 A1001”。
2. 服务端识别意图、匹配 FAQ、查询订单，并返回机器人回复。
3. 如果消息包含投诉、人工客服、强烈负面情绪等信号，系统会创建工单并标记需要人工。
4. 打开客服端，选择客户队列中的会话，查看消息、诊断结果和工单信息。
5. 客服发送人工回复后，该会话进入人工接入状态，后续用户消息只同步给客服，不再自动生成 AI 回复。

## 可测试订单

- `A1001`：已发货，有物流单号。
- `B2026`：仓库处理中，预计 24 小时内发货。
- `R3308`：退款审核中，预计 1-3 个工作日完成审核。

## 常用脚本

```bash
npm run dev      # 以 watch 模式启动开发服务
npm start        # 启动生产/普通服务
npm run smoke    # 运行接口冒烟测试
```

运行冒烟测试前，请先启动服务：

```bash
npm run dev
npm run smoke
```

如需测试其他服务地址：

```bash
SMOKE_BASE_URL=http://localhost:3001 npm run smoke
```

## API 概览

### 基础接口

```text
GET  /api/health                  # 服务健康状态、模型状态和数据统计
GET  /api/faqs                    # FAQ 知识库
GET  /api/tickets                 # 工单列表
GET  /api/sessions                # 客户会话队列
GET  /api/sessions/:sessionId     # 单个会话详情和消息记录
```

### 聊天与人工接口

```text
POST /api/chat                              # 用户发送消息，触发机器人/规则回复
POST /api/sessions/:sessionId/profile      # 更新客户姓名和联系方式
POST /api/sessions/:sessionId/messages     # 客服发送人工回复
```

`POST /api/chat` 示例：

```json
{
  "sessionId": "demo-user",
  "message": "帮我查一下订单 A1001",
  "profile": {
    "name": "测试用户",
    "contact": "13800000000"
  },
  "visitor": {
    "code": "DEMO01"
  }
}
```

`POST /api/sessions/:sessionId/messages` 用于客服端人工回复。人工回复会把会话标记为 `assigned`，后续同一 `sessionId` 的用户消息会返回 `handledByAgent: true`。

### 实时事件接口

```text
GET /api/sessions/events              # 客服端订阅客户队列变化
GET /api/sessions/:sessionId/events   # 用户端/客服端订阅单个会话变化
```

实时同步基于 Server-Sent Events，浏览器端通过 `EventSource` 连接。

## 数据说明

- FAQ 数据位于 `data/faqs.json`，每条 FAQ 包含 `id`、`intent`、`question`、`answer` 和 `keywords`。
- 订单数据位于 `data/orders.json`，用于演示订单状态查询，不连接真实业务系统。
- 会话、工单和消息存储在服务进程内存中，重启服务后会清空。

## 当前限制

- 这是 MVP Demo，没有接入数据库、登录鉴权和权限控制。
- 会话与工单仅保存在内存中，不适合直接用于生产环境。
- FAQ 检索采用简单关键词与文本匹配，复杂语义检索可后续替换为向量检索或搜索服务。
- 客服工作台中的“导出记录”等入口是界面占位功能，当前未实现导出逻辑。
