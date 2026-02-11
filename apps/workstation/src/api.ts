import type { Message } from '@assistflow/shared';

// 后端基地址：与工作台同源，留空即可
export const API = '';

export const newId = () => crypto.randomUUID();

/** UI 用消息：在服务端 actor/role 基础上统一补出 from 区分左右 */
export type UiMessage = Message & { from: string };

export interface AgentIdentity {
  id: string;
  name: string;
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
  } catch {}
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AGENT_KEY);
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
  ({ bot: 'AI 回答', waiting_human: '待本人跟进', assigned: '本人沟通中', resolved: '已解决', closed: '已关闭' } as Record<string, string>)[s] || s;

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

// 时间戳格式化为 HH:MM
export function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 将纯文本切分为 文本/链接 片段，供安全渲染可点击链接
const URL_RE = /(https?:\/\/[^\s]+)/g;

export interface LinkPart {
  link: boolean;
  value: string;
}

export function linkParts(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push({ link: false, value: text.slice(last, match.index) });
    parts.push({ link: true, value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ link: false, value: text.slice(last) });
  return parts;
}
