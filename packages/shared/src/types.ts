/** 域模型类型 — 与现有运行时对象逐字段对应（迁移期间是契约的唯一事实来源）。 */

export type SessionStatus = 'bot' | 'waiting_human' | 'assigned' | 'closed';
export type TicketStatus = 'open' | 'processing' | 'resolved';
export type Priority = 'normal' | 'high';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type Actor = 'customer' | 'ai' | 'agent';
export type AiProvider = 'openai' | 'deepseek';

export interface Attachment {
  type: 'image';
  id: string;
  dataUrl: string;
  name: string;
}

export interface Message {
  id: string;
  /** 客户端生成的消息标识：用于发送重试去重（幂等） */
  clientMessageId?: string | null;
  role: 'user' | 'assistant';
  actor: Actor;
  content: string;
  agentId: string | null;
  agentName: string | null;
  attachments: Attachment[];
  createdAt: string;
}

export interface TicketNote {
  id: string;
  agentId: string;
  agentName: string;
  text: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  sessionId: string;
  status: TicketStatus;
  priority: Priority;
  intent: string;
  reason: string;
  inquiryId: string | null;
  lastMessage: string;
  resolution?: string;
  notes?: TicketNote[];
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  resolvedAt?: string;
  // 响应时按会话归属附带（不一定持久化）：当前接待该工单会话的客服
  ownerAgentId?: string | null;
  ownerAgentName?: string | null;
}

export interface Inquiry {
  id: string;
  type: string;
  title: string;
  statusText: string;
  nextStep: string;
  eta: string;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  intent?: string;
  /** 面向对象（可选）：如 new_lead / existing_client / hiring */
  audience?: string;
  /** 访客旅程阶段（可选）：如 discovery / scoping / quoting / delivery / support */
  stage?: string;
  /** 需要人工确认的边界提示（可选） */
  confidenceNote?: string;
  /** 扩展标签（可选）：用于运营筛选与分组 */
  tags?: string[];
  /** 最近复审日期（可选，YYYY-MM-DD） */
  lastReviewedAt?: string;
}

export interface FaqSource {
  id: string;
  question: string;
  score: number;
}

export interface AiUsage {
  provider: AiProvider | string;
  model: string;
  used: boolean;
  fallback: boolean;
  error: string | null;
}

export interface Workflow {
  ai: AiUsage;
  intent: string;
  sentiment: Sentiment;
  needHuman: boolean;
  reason: string;
  inquiry: Inquiry | null;
  ticket: Ticket | null;
  sources: FaqSource[];
}

export interface VisitorInfo {
  code: string;
  createdAt: string | null;
  /** 服务端按真实客户端 IP 采集（仅客服可见，公开接口会剥离） */
  ip?: string | null;
  /** 由 User-Agent 解析的「系统 · 浏览器」标签（仅客服可见） */
  device?: string | null;
  /** 预留：由 IP 推断的地理位置；未启用 GeoIP 时为 null（仅客服可见） */
  location?: string | null;
  /** 访客发起对话时所在页面 URL（仅客服可见，公开接口会剥离） */
  pageUrl?: string | null;
}

/** 租户：每个接入站点/客户一个，workstation 里由 admin 管理；key（租户密钥）用于校验 /api/chat 请求来源 */
export interface Tenant {
  /** 租户ID：创建时自动生成（旧数据在服务端启动时补齐，老后端返回的行可能缺失） */
  id?: string;
  /** 租户名称 */
  name: string;
  /** 租户域名（接入站点的域名，创建时可选填写） */
  domain?: string;
  /** 备注（创建时可选填写） */
  remark?: string;
  /** 租户密钥：自动生成，16 位大小写字母+数字、按 4 位一组用 - 分隔；widget 嵌入代码的 data-key 用它 */
  key: string;
  /** 状态：启用/停用 */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated 旧命名，等同 Tenant，保留兼容既有引用 */
export type WidgetKey = Tenant;

export interface Profile {
  name: string;
  contact: string;
}

export interface Session {
  sessionId: string;
  displayName: string;
  profile: Profile | null;
  visitor: VisitorInfo | null;
  status: SessionStatus;
  priority: Priority;
  lastMessage: string;
  lastIntent: string;
  sentiment: Sentiment;
  needHuman: boolean;
  reason: string;
  inquiryId: string | null;
  ticketId: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  workflow: Workflow | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  /** 发起会话时使用的租户密钥（用于按租户统计，新会话写入，旧数据为 undefined） */
  tenantKey?: string | null;
}

/** 租户详情统计（GET /api/widget-keys/:key/stats 响应） */
export interface TenantStats {
  totalSessions: number;
  recentSessions: number;
  statusBreakdown: Record<SessionStatus, number>;
  deviceBreakdown: { mobile: number; desktop: number; unknown: number };
  topSources: Array<{ url: string; count: number }>;
  dailySessions: Array<{ date: string; count: number }>;
}

/** 队列视图里的会话（附带消息数） */
export interface SessionSummary extends Session {
  messageCount: number;
  /** 最后一条消息的发送方：user=访客（客服欠回复），assistant=AI/客服（等访客回） */
  lastMessageRole?: 'user' | 'assistant' | null;
}

export interface DailyMetricPoint {
  date: string; // 服务端本地日期 YYYY-MM-DD
  waiting: number;
  assigned: number;
  activeSessions: number;
}

export interface Metrics {
  generatedAt: string;
  totals: { sessions: number; messages: number; tickets: number };
  queue: { waitingHuman: number; assigned: number; closed: number; highPriority: number };
  tickets: { open: number; processing: number; resolved: number; highPriority: number };
  ai: { automationRate: number; handoffRate: number };
  workload: { activeTickets: number; activeSessions: number };
}

/** POST /api/chat 响应（workflow 字段平铺进响应体） */
export interface ChatResponse extends Workflow {
  sessionId: string;
  reply: string;
  handledByAgent?: boolean;
  session: Session;
  messages: Message[];
}
