// 轻量 JWT（HS256）与口令哈希工具：纯函数，无外部依赖，便于单测。
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export type AgentRole = 'agent' | 'admin';

export interface AgentClaims {
  sub: string;
  name: string;
  role: AgentRole;
  exp: number;
}

export function signToken(
  payload: { sub: string; name: string; role: AgentRole },
  secret: string,
  ttlSeconds = 12 * 3600
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * SSE 短时一次性票据：EventSource 无法带请求头，只能用 query 传递；
 * 改用 60s 短 TTL 的专用票据（kind:'sse'），避免长效 JWT 暴露在 URL/日志里。
 */
export function signSseTicket(
  payload: { sub: string; name: string; role: AgentRole },
  secret: string,
  ttlSeconds = 60
): string {
  return signToken({ ...payload, kind: 'sse' } as any, secret, ttlSeconds);
}

export function verifySseTicket(ticket: string, secret: string): AgentClaims | null {
  const claims = verifyToken(ticket, secret) as (AgentClaims & { kind?: string }) | null;
  return claims && claims.kind === 'sse' ? claims : null;
}

export function verifyToken(token: string, secret: string): AgentClaims | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    // 兼容旧 token：缺省按普通客服处理
    if (claims.role !== 'admin') claims.role = 'agent';
    return claims as AgentClaims;
  } catch {
    return null;
  }
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
