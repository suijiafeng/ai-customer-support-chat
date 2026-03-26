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
  if (!code) return null;
  return {
    code,
    createdAt: value?.createdAt || null,
    pageUrl: String(value?.pageUrl || '').trim().slice(0, 500) || null,
  };
}

export function inferVisitorFromSessionId(sessionId: string): VisitorInfo | null {
  const match = String(sessionId).match(/customer-([a-z0-9]+)/i);
  if (!match) return null;
  return { code: match[1].toUpperCase(), createdAt: null };
}

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

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
