import type { Message } from '@assistflow/shared';
import { fmtTime, linkParts } from '@assistflow/shared';

// 后端基地址：默认与工作台同源（留空）；独立部署时通过 VITE_API_BASE 指向 server 域名
export const API = import.meta.env.VITE_API_BASE || '';

export { fmtTime, linkParts };
export type { LinkPart } from '@assistflow/shared';

export const newId = () => crypto.randomUUID();

/** UI 用消息：在服务端 actor/role 基础上统一补出 from 区分左右 */
export type UiMessage = Message & { from: string };

export type AgentRole = 'agent' | 'admin';

export interface AgentIdentity {
  id: string;
  name: string;
  role?: AgentRole;
}

/** 换取 60s SSE 短票据，供 EventSource ?ticket= 使用（避免长效 JWT 进 URL/日志） */
export async function fetchSseTicket(): Promise<string> {
  const data = await requestJson<{ ticket: string }>('/api/auth/sse-ticket', { method: 'POST' });
  return data.ticket;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requestJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(options?.headers);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API}${url}`, { ...options, headers });
  const data = await response.json().catch(() => null);
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    // 登录态失效：清空并回到登录页
    clearAuth();
    window.location.reload();
  }
  if (!response.ok || !data) throw new ApiError(data?.error || `request failed: ${response.status}`, response.status);
  return data as T;
}

// 登录态：JWT 与客服身份存 localStorage，所有客服侧请求带 Authorization
const TOKEN_KEY = 'assistflow-token';
const AGENT_KEY = 'assistflow-agent';
const LOGIN_AT_KEY = 'assistflow-login-at';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getStoredAgent(): AgentIdentity | null {
  try {
    const raw = localStorage.getItem(AGENT_KEY);
    return raw ? (JSON.parse(raw) as AgentIdentity) : null;
  } catch { return null; }
}

export function saveAuth(token: string, agent: AgentIdentity) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(AGENT_KEY, JSON.stringify(agent));
    localStorage.setItem(LOGIN_AT_KEY, new Date().toISOString());
  } catch {}
}

export function getLoginAt(): string | null {
  try { return localStorage.getItem(LOGIN_AT_KEY); } catch { return null; }
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AGENT_KEY);
    localStorage.removeItem(LOGIN_AT_KEY);
  } catch {}
}

export async function login(agentNo: string, password: string): Promise<AgentIdentity> {
  const data = await requestJson<{ token: string; agent: AgentIdentity }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentNo, password }),
  });
  saveAuth(data.token, data.agent);
  return data.agent;
}

// 服务端消息字段是 actor/role，统一补出 from 供 UI 区分左右
export function normalizeMessages(list: Message[] = []): UiMessage[] {
  return list.map((m) => ({ ...m, from: (m as any).from || m.actor || 'system' }));
}

export const statusTag = (s: string): string =>
  ({ bot: 'info', waiting_human: 'warning', assigned: 'success', resolved: 'info', closed: 'info' } as Record<string, string>)[s] || 'info';

export const statusText = (s: string): string =>
  ({ bot: 'AI 回答', waiting_human: '待跟进', assigned: '接待中', resolved: '已解决', closed: '已关闭' } as Record<string, string>)[s] || s;

// ---- 意图代码 → 人话 ----
// FAQ / 流程意图（与 server data/faqs.json 及 chat.service 的取值对应）
const INTENT_TEXT: Record<string, string> = {
  pricing: '咨询项目报价',
  services: '咨询服务内容',
  portfolio: '想看过往作品案例',
  collaboration: '咨询合作流程',
  availability: '询问近期档期',
  contact: '想获取联系方式',
  about: '想了解开发者',
  tech_stack: '咨询技术栈',
  hiring: '招聘 / 工作机会',
  human_handoff: '要求人工客服',
  inquiry_status: '查询咨询进度',
  out_of_scope: '问题超出服务范围',
  general: '一般咨询',
  duplicate: '重复发送相同消息',
  agent_conversation: '人工接待中的对话',
  testing: '测试性提问',
};

// 闲聊子意图（chat.service 以 small_talk: 前缀上报）
const SMALL_TALK_TEXT: Record<string, string> = {
  greeting: '打招呼',
  bye: '道别',
  thanks: '表达感谢',
  praise: '夸赞',
  mood: '倾诉情绪',
  joke: '开玩笑',
  chitchat: '闲聊',
  ack: '简单附和',
  emoji_only: '只发了表情',
  meaningless: '无明确含义的消息',
  poke: '随口试探',
  testing: '测试性提问',
  who_are_you: '询问助手身份',
};

/** 把意图代码翻译成访客的真实来意；未知代码原样展示以便排查 */
export function intentText(intent?: string | null): string {
  if (!intent) return '—';
  if (intent.startsWith('small_talk:')) {
    const sub = intent.slice('small_talk:'.length);
    return SMALL_TALK_TEXT[sub] ? `闲聊 · ${SMALL_TALK_TEXT[sub]}` : '闲聊';
  }
  return INTENT_TEXT[intent] || intent;
}

export interface PendingAttachment {
  id: string;
  dataUrl: string;
  name: string;
  type: string;
}

// 图片附件：转 data URL，供发送使用
export function fileToDataUrl(file: File): Promise<PendingAttachment> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () =>
      resolve({ id: newId(), dataUrl: r.result as string, name: file.name || 'image', type: file.type });
    r.readAsDataURL(file);
  });
}

export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 750 * 1024;
