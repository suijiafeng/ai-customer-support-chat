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
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  resolvedAt?: string;
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
}

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
}

/** 队列视图里的会话（附带消息数） */
export interface SessionSummary extends Session {
  messageCount: number;
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
