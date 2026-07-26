// 访客令牌的本地保管。
//
// 服务端在每次对话响应里下发 visitorToken（见 server/src/auth/visitor-token.ts），
// 它绑定当前 sessionId，是后续读取会话详情与 SSE 的唯一凭证。
//
// 存 localStorage 而不是 Cookie：widget 嵌在第三方页面里，跨站 Cookie 需要
// SameSite=None 且正被各浏览器默认拦截。代价是同源 XSS 能读到它——但令牌只能读
// 这一个会话的内容，而能执行 XSS 的脚本本来就在同一个页面上下文里，拿不到额外的东西。
//
// 按 sessionId 分键存放：同一浏览器换了访客身份（清了 visitorId）就是另一个会话，
// 旧令牌自然失效，不会串号。

const KEY_PREFIX = 'assistflow:vt:';

// 浏览器隐私模式下 localStorage 可能直接抛异常，全部读写都要兜底——
// 拿不到令牌只是退化成"读不到历史"，不能让整个 widget 崩掉。
function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__assistflow_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function saveVisitorToken(sessionId: string, token: string | undefined | null): void {
  if (!sessionId || !token) return;
  safeStorage()?.setItem(KEY_PREFIX + sessionId, token);
}

export function loadVisitorToken(sessionId: string): string {
  if (!sessionId) return '';
  return safeStorage()?.getItem(KEY_PREFIX + sessionId) || '';
}

/** REST 请求头。没有令牌时返回空对象，让服务端按未授权处理，而不是发一个空字符串头。 */
export function visitorAuthHeaders(sessionId: string): Record<string, string> {
  const token = loadVisitorToken(sessionId);
  return token ? { 'x-visitor-token': token } : {};
}

/** SSE 用查询串传递：EventSource 无法自定义请求头，与客服侧的 ?ticket= 同理。 */
export function withVisitorQuery(url: string, sessionId: string): string {
  const token = loadVisitorToken(sessionId);
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}vt=${encodeURIComponent(token)}`;
}
