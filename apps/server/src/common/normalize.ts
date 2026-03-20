// 入参规范化（自原 index.js 的 normalizeXxx 系列平移，契约不变）。
import { randomUUID } from 'node:crypto';
import { LIMITS } from '@assistflow/shared';
import type { Attachment, Profile, VisitorInfo } from '@assistflow/shared';

export function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a) => a && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/'))
    .slice(0, LIMITS.MAX_ATTACHMENTS)
    .filter((a) => a.dataUrl.length <= LIMITS.MAX_ATTACHMENT_BYTES)
    .map((a) => ({
      type: 'image' as const,
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 64) : randomUUID(),
      dataUrl: a.dataUrl as string,
      name: typeof a.name === 'string' ? a.name.slice(0, 80) : 'image',
    }));
}

export function normalizeProfile(value: any = {}): Profile {
  return {
    name: String(value?.name || '').trim().slice(0, 24),
    contact: String(value?.contact || '').trim().slice(0, 40),
  };
}

export function normalizeVisitor(value: any = {}): VisitorInfo | null {
  const code = String(value?.code || '').trim().slice(0, 20);
  if (!code) {
    return null;
  }
  return {
    code,
    createdAt: value?.createdAt || null,
  };
}

export function inferVisitorFromSessionId(sessionId: string): VisitorInfo | null {
  const match = String(sessionId).match(/customer-([a-z0-9]+)/i);
  if (!match) {
    return null;
  }
  return {
    code: match[1].toUpperCase(),
    createdAt: null,
  };
}

/** 请求侧元信息：真实客户端 IP 与 User-Agent（由服务端采集，客户端不可伪造）。 */
export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** 从 User-Agent 粗略解析「系统 · 浏览器」标签，仅供客服侧识别，不追求精确，无外部依赖。 */
export function parseDevice(userAgent?: string | null): string | null {
  const ua = String(userAgent || '').trim();
  if (!ua) return null;
  const os = /iphone/i.test(ua)
    ? 'iPhone'
    : /ipad/i.test(ua)
      ? 'iPad'
      : /android/i.test(ua)
        ? 'Android'
        : /windows/i.test(ua)
          ? 'Windows'
          : /macintosh|mac os x/i.test(ua)
            ? 'macOS'
            : /linux/i.test(ua)
              ? 'Linux'
              : '未知系统';
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /chrome\//i.test(ua)
        ? 'Chrome'
        : /firefox\//i.test(ua)
          ? 'Firefox'
          : /safari\//i.test(ua)
            ? 'Safari'
            : '未知浏览器';
  return `${os} · ${browser}`;
}
