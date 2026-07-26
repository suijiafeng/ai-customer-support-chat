> ⚠️ **本文档已过时（2026-06）**：仓库已重构为 npm workspaces monorepo——NestJS 后端（apps/server）+ React 工作台/widget/演示站 + JWT 鉴权 + Postgres 写穿透，实时层仍为 SSE（未采用本文规划的 Socket.IO/Prisma 方案）。当前架构与运行方式见根目录 README.md。本文仅作历史决策记录保留。

# AssistFlow 架构设计（人工客服跟进多个访客）

> 目标：把当前 Demo（Express + SSE + 内存 + 原生 JS）演进为可长期迭代的个人主页咨询系统，
> 核心场景是「个人主页 AI 助手回答常见问题，人工客服按需跟进多个访客会话」。
> 原则：沿用现有合理部分，只替换该替换的，不推翻重来。

---

## 1. 选型总览

| 层 | 现状 | 目标 | 处置 |
|----|------|------|------|
| 后端框架 | Express 5 | Express 5 | 保留 |
| 实时通信 | SSE（单向，两条通道） | Socket.IO（双向，room） | **替换** |
| 持久化 | 内存 Map/数组（200 上限） | SQLite + Prisma | **新增** |
| 鉴权 | 前端自填假身份 | JWT + bcrypt（开发者侧） | **新增** |
| AI 层 | OpenAI SDK / DeepSeek / 规则降级 | 不变 | 保留 |
| 访客前台 | 原生 JS | 原生 JS + socket.io-client | 保留 |
| 开发者工作台 | 原生 JS（700 行） | React + Ant Design | **升级** |
| 跨实例广播 | 无（单进程内存） | 预留 Redis Adapter 接口 | 暂不做 |
| 部署 | Docker + Render free | Docker + 持久卷 / 托管 PG | 调整 |

---

## 2. 系统分层

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│   访客前台 (public/)          │   │   开发者工作台 (React + AntD)  │
│   匿名访客 · 对话框           │   │   多会话队列 · 跟进事项 · 回复  │
│   socket.io-client            │   │   socket.io-client + JWT       │
└──────────────┬───────────────┘   └───────────────┬──────────────┘
               │ ws + http                          │ ws(鉴权) + http(鉴权)
               ▼                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Express + Socket.IO 服务                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌─────────────────┐  │
│  │ HTTP 路由   │ │ Socket 网关 │ │ 鉴权中间件  │ │ 业务服务层       │  │
│  │ /api/*     │ │ rooms/emit  │ │ JWT verify  │ │ chat/ticket/... │  │
│  └─────┬──────┘ └─────┬──────┘ └────────────┘ └────────┬────────┘  │
│        └──────────────┴───────────────────────────────┘            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │
│  │ 规则引擎      │  │ AI 适配器     │  │ 数据访问层 (Prisma)     │    │
│  │ rules.js     │  │ openai/ds    │  │ sessions/messages/...   │    │
│  └──────────────┘  └──────────────┘  └───────────┬────────────┘    │
└────────────────────────────────────────────────┬─┴────────────────┘
                                                  ▼
                                        ┌──────────────────┐
                                        │ SQLite (Prisma)   │
                                        │ 可平滑迁 Postgres  │
                                        └──────────────────┘
            (扩展期) Redis Pub/Sub  ←── @socket.io/redis-adapter
```

---

## 3. 数据模型（Prisma schema）

把现有内存结构平移成表，去掉 200 条硬上限。

```prisma
// 开发者账号
model Agent {
  id        String   @id @default(cuid())
  username  String   @unique
  password  String              // bcrypt
  name      String
  status    String   @default("offline") // online / busy / offline
  createdAt DateTime @default(now())
  sessions  Session[]
  messages  Message[]
}

// 一个访客会话
model Session {
  id              String    @id            // 沿用现在的 sessionId
  visitorName     String?
  status          String    @default("ai") // ai / waiting / assigned / resolved
  assignedAgentId String?
  assignedAgent   Agent?    @relation(fields: [assignedAgentId], references: [id])
  lastMessageAt   DateTime  @default(now())
  unreadForAgent  Int       @default(0)    // 工作台未读计数
  createdAt       DateTime  @default(now())
  messages        Message[]
  tickets         Ticket[]
  @@index([status, lastMessageAt])
}

// 消息
model Message {
  id        String   @id @default(cuid())
  sessionId String
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  actor     String   // customer / ai / agent
  role      String   // user / assistant
  content   String
  agentId   String?
  agent     Agent?   @relation(fields: [agentId], references: [id])
  createdAt DateTime @default(now())
  @@index([sessionId, createdAt])
}

// 跟进事项
model Ticket {
  id        String   @id @default(cuid())
  sessionId String
  session   Session  @relation(fields: [sessionId], references: [id])
  status    String   // open / processing / resolved
  priority  String   // low / medium / high
  intent    String?
  reason    String?
  inquiryId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([status])
}
```

FAQ / 项目咨询进展仍可留在 `data/*.json`（只读种子数据），或后续入库。

---

## 4. 实时层：SSE → Socket.IO

### Room 设计（这是「开发者跟进多个访客」的核心）

- `session:<id>` —— 每个访客会话一个房间。访客加入自己的；开发者**可同时加入多个**自己跟进的会话房间。
- `queue` —— 开发者工作台订阅，接收队列变化（新会话、状态流转、未读变化）。
- `agent:<id>` —— 给开发者工作台的私有通知（被分配新会话等）。

### 事件契约

客户端 → 服务端：

| 事件 | 发起方 | 说明 |
|------|--------|------|
| `customer:message` | 访客 | 发消息（触发本地 FAQ / AI / 或联系本人） |
| `agent:join` | 开发者 | 接入某会话，加入 room，清未读 |
| `agent:message` | 开发者 | 本人回复 |
| `agent:resolve` | 开发者 | 标记解决，关闭会话和跟进事项 |
| `ticket:update` | 开发者 | 跟进事项状态/优先级流转 |

服务端 → 客户端：

| 事件 | 目标 room | 说明 |
|------|-----------|------|
| `message:new` | `session:<id>` | 新消息（访客/AI/开发者） |
| `session:update` | `session:<id>` | 会话状态变化 |
| `queue:update` | `queue` | 队列与未读刷新 |
| `agent:assigned` | `agent:<id>` | 有新会话分配/抢到 |

现有 `notifySession()` / `notifyQueue()` 几乎一对一映射成 `io.to('session:'+id).emit('session:update', payload)` 和 `io.to('queue').emit('queue:update', payload)`，迁移成本低。

### 为什么换

SSE 单向、开发者回复要另开 POST、心跳手写、多实例无法广播。Socket.IO 双向、room 天然表达「开发者订阅多个会话」、自带重连与降级，且扩展期加 `@socket.io/redis-adapter` 即可跨实例，几乎不改业务代码。

---

## 5. 鉴权流程（开发者侧）

```
开发者登录 POST /api/auth/login {username,password}
        │  bcrypt 校验
        ▼
   签发 JWT (agentId, name, exp)
        │
        ├─ HTTP：所有写接口走 authMiddleware，从 token 取真实 agentId
        └─ Socket：握手时 socket.handshake.auth.token → verify → socket.data.agent
```

- 访客前台**保持匿名**（自动生成 visitorId），不需登录，符合个人主页低门槛咨询定位。
- 彻底移除前端自填 `agentId/agentName`，开发者身份只来自已验证的 token。
- 写操作（join/message/resolve/ticket）全部校验：会话已被他人接入则拒绝（沿用现有 `assignedAgentId` 锁，但 id 现在可信了）。

---

## 6. 开发者跟进多个访客：工作台关键能力

1. **多会话队列**：按状态分组（待接入 / 我的会话 / 已解决），`lastMessageAt` 排序。
2. **未读计数**：`Session.unreadForAgent`，开发者未打开该会话时新消息 +1，进入会话清零。
3. **实时提醒**：`queue:update` 驱动红点/声音，避免并发漏看。
4. **会话切换**：开发者在多个 `session:<id>` room 间切换，互不干扰；当前会话高亮。
5. **接入锁**：一个会话只允许一个开发者身份接入，其他身份只读。
6. **AI 让位**：会话进入 `assigned` 后，`customer:message` 不再触发 AI（现有逻辑保留）。

工作台用 React + Ant Design：`List`/`Badge` 做队列、`Drawer`/`Tabs` 做多会话、`Tag` 做状态机——组件现成，比 700 行原生 JS 好维护得多。

---

## 7. 部署注意

- SQLite 文件需挂**持久卷**，否则容器重启数据丢失。Render free 无持久磁盘 → 要么升级实例挂盘，要么直接用托管 Postgres（Prisma 只改 datasource 一行）。
- 单实例先上线。水平扩展时再加 Redis + socket.io redis-adapter。
- 保留 `/api/health`、Docker、CI。

---

## 8. 演进路线（建议顺序）

1. **持久化**：引入 Prisma + SQLite，把内存结构迁成表（不改对外行为）。
2. **鉴权**：开发者登录 + JWT + 中间件，替掉假身份。
3. **实时层**：SSE → Socket.IO，迁移两条通道为 room 事件。
4. **工作台**：React + AntD 重写，补未读/提醒/多会话切换。
5. **加固**：限流、输入转义（防 XSS 打到工作台）、CORS 收敛。
6. **（按需）扩展**：Redis adapter 支持多实例。

每一步都能独立交付、独立验证，不必一次性大重构。
