// 访客会话凭证。
//
// 要解决的问题：`GET /api/sessions/:sessionId` 与它的 SSE 之前完全没有鉴权，
// 而 sessionId 是浏览器端生成的（widget/src/visitorId.ts，那里的校验和自己也写明
// 「只用于检测本地存储被改动/损坏，并非防伪造的安全签名」），服务端对它零校验。
// 结果是：知道 sessionId 就能读到完整对话。sessionId 会出现在 URL、日志、
// 前端埋点里，「难猜」不等于「不可获得」。
//
// 做法：会话建立时由服务端签发一个绑定该 sessionId 的访客令牌，后续读取必须出示。
// 三个设计点：
//   1. 令牌里带 kind:'visitor'，且校验时强制比对——保证它不能当客服 token 用，
//      反之亦然（与 signSseTicket 的 kind:'sse' 是同一套思路）。
//   2. sub 就是 sessionId：令牌只对签发它的那一个会话有效，拿到别人的也读不了第三方会话。
//   3. TTL 默认 7 天并在每次对话时续签——访客不登录，令牌就是他的身份，
//      过期即失去自己的历史记录，所以不能像客服 token 那样只给 12 小时。
//
// 为什么不用 Cookie：widget 是嵌到第三方页面里的，跨站 Cookie 需要 SameSite=None
// 且正被各浏览器默认拦截。所以走「响应体下发 + 前端存 localStorage + 请求头/查询串回传」，
// 与 SSE 票据同样的传递方式。

import { createHmac, timingSafeEqual } from 'node:crypto';

const KIND = 'visitor';
export const VISITOR_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

interface VisitorClaims {
  sub: string; // sessionId
  kind: typeof KIND;
  exp: number;
}

const b64url = (input: string) => Buffer.from(input).toString('base64url');

export function signVisitorToken(
  sessionId: string,
  secret: string,
  ttlSeconds = VISITOR_TOKEN_TTL_SECONDS
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({
      sub: sessionId,
      kind: KIND,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    } satisfies VisitorClaims)
  );
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/** 校验令牌并确认它就是为 sessionId 签发的。任何一步不满足都返回 false，不区分原因。 */
export function verifyVisitorToken(
  token: string | undefined | null,
  sessionId: string,
  secret: string
): boolean {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [header, body, sig] = parts;

  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  // 长度不等时 timingSafeEqual 会抛异常，必须先比长度
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VisitorClaims;
    if (claims.kind !== KIND) return false; // 客服 token / SSE 票据不能冒充访客令牌
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return false;
    return claims.sub === sessionId;
  } catch {
    return false;
  }
}
