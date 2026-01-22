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

export function normalizeAgent(value: any = {}): { id: string; name: string } {
  const id = String(value?.id || '').trim().slice(0, 48);
  const name = String(value?.name || '').trim().slice(0, 40);
  return {
    id: id || 'agent-local',
    name: name || '开发者本人',
  };
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
