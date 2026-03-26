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

// SSE 用 ?ticket= 传递凭证（EventSource 无法自定义请求头），60s 短 TTL 避免长效 JWT 进 URL
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
    if (claims.role !== 'admin') claims.role = 'agent'; // 兼容旧 token
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
