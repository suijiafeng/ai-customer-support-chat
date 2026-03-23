import { useCallback, useEffect, useRef, useState } from 'react';
import { createMessageArchive } from '@assistflow/shared';
import { loadVisitorId, ensureVisitorId, isVisitorIdValid } from '../visitorId.js';
import { newId, normalizeMessages, streamChat, type PendingImage, type UiMessage } from '../chatApi.js';

// 流式中断后等待会话 SSE 推回最终结果的兜底时长：超时仍未收到则把消息标为失败可重试
const STREAM_FALLBACK_MS = 12000;

// 访客侧对话归档：服务端窗口外的旧消息留在本地，重启/淘汰不丢界面历史
const messageArchive = createMessageArchive(
  typeof window !== 'undefined' ? window.localStorage : undefined,
  'assistflow.history'
);

interface UseChatSessionParams {
  apiBase: string;
  siteKey: string;
  input: string;
  setInput: (value: string) => void;
  pending: PendingImage[];
  clearPending: () => void;
  checkRateLimit: () => boolean;
  startCooldown: (seconds: number) => void;
  onSendStart?: () => void; // 发送开始时关闭表情/快捷提问等 UI 弹层
}

/**
 * 会话状态机本体：访客身份、SSE 会话生命周期、消息收发与本地归档合并。
 * 这些状态互相联动（乐观消息 ↔ inflightRef ↔ 归档合并 ↔ sessionIdRef），
 * 刻意不再往下拆——强行拆分只会新增跨 hook 的 ref 透传，不减少真实耦合。
 */
export function useChatSession({
  apiBase,
  siteKey,
  input,
  setInput,
  pending,
  clearPending,
  checkRateLimit,
  startCooldown,
  onSendStart,
}: UseChatSessionParams) {
  const [connection, setConnection] = useState<'syncing' | 'synced'>('syncing');
  const [messages, setMessagesState] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [keyInvalid, setKeyInvalid] = useState(false); // widget 接入密钥无效/停用：重试无意义，需和普通失败区分

  const listEl = useRef<HTMLDivElement | null>(null);
  const sessionEvents = useRef<EventSource | null>(null);
  const sessionIdRef = useRef(''); // 访客标识：首次发送消息后才惰性生成，存于本地并带完整性校验
  // 本次发送的乐观消息对（访客消息 id 即 clientMessageId + 流式 AI 气泡 id）
  const inflightRef = useRef<{ userId: string; aiId: string } | null>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listEl.current) listEl.current.scrollTop = listEl.current.scrollHeight;
    });
  }, []);

  const resetAtBottom = useCallback(() => {
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  const setMessages = useCallback(
    (list: any[], force = false) => {
      // 「本地归档 ∪ 服务端窗口」：服务端只保留最近一段，溢出部分从本地归档补全
      const merged = sessionIdRef.current
        ? messageArchive.merge(sessionIdRef.current, list)
        : list;
      setMessagesState((current) => {
        const next = normalizeMessages(merged);
        if (force) return next;
        // 非权威更新（SSE 快照等）：保留服务端尚未确认的本地乐观消息，
        // 避免发送中收到旧快照把「我的消息 + 流式 AI 气泡」整体冲掉
        const confirmed = new Set<string>();
        for (const m of Array.isArray(list) ? list : []) {
          if (m?.id) confirmed.add(String(m.id));
          if (m?.clientMessageId) confirmed.add(String(m.clientMessageId));
        }
        for (const m of next) confirmed.add(m.id);
        // 服务端把「访客消息 + AI 回复」一起落库：访客消息一旦确认，配对的流式气泡同样让位
        const inflight = inflightRef.current;
        if (inflight && confirmed.has(inflight.userId)) confirmed.add(inflight.aiId);
        const optimistic = current.filter((m) => !(m as any).actor && !confirmed.has(m.id));
        return optimistic.length ? [...next, ...optimistic] : next;
      });
      if (force || atBottomRef.current) scrollToBottom();
    },
    [scrollToBottom]
  );

  const requestJson = useCallback(
    async (url: string, options?: RequestInit) => {
      const response = await fetch(`${apiBase}${url}`, options);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data)
        throw Object.assign(new Error(data?.error || `request failed: ${response.status}`), {
          status: response.status,
          retryAfter: Number(response.headers.get('retry-after')) || 0,
          code: data?.error,
        });
      return data;
    },
    [apiBase]
  );

  const activate = useCallback(async () => {
    sessionEvents.current?.close();
    const sessionId = sessionIdRef.current;
    try {
      const data = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
      setMessages(data.messages);
    } catch {}

    const es = new EventSource(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/events`);
    sessionEvents.current = es;
    es.onopen = () => setConnection('synced');
    es.addEventListener('session', (event) => {
      try {
        setMessages(JSON.parse((event as MessageEvent).data).messages || []);
      } catch {}
    });
    es.onerror = () => setConnection('syncing');
  }, [apiBase, requestJson, setMessages]);

  // 确保会话 ID 合法：不存在则生成，已被篡改/损坏则重新生成
  const ensureSession = useCallback(async () => {
    const prev = sessionIdRef.current;
    if (!sessionIdRef.current || !isVisitorIdValid(siteKey, sessionIdRef.current)) {
      sessionIdRef.current = ensureVisitorId(siteKey);
    }
    if (!sessionEvents.current || sessionIdRef.current !== prev) {
      await activate();
    }
  }, [siteKey, activate]);

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if ((!text && pending.length === 0) || sending) return;
      // 前端先拦截：发送过快时保留输入框内容、不发请求，只给倒计时；后端为最后一道防线
      if (!checkRateLimit()) return;

      const attachments = pending;
      setSending(true);
      try {
        await ensureSession();
        // 乐观渲染：先放上访客消息和一个空的 AI 气泡，流式增量往里填
        const userMsgId = newId();
        const payload = {
          sessionId: sessionIdRef.current,
          message: text,
          attachments,
          siteKey,
          visitor: { code: sessionIdRef.current, pageUrl: window.location.href },
          // 幂等键：服务端据此对重试去重，避免「AI 失败 + 重发」产生重复气泡
          clientMessageId: userMsgId,
        };
        const aiMsgId = newId();
        inflightRef.current = { userId: userMsgId, aiId: aiMsgId };
        const now = new Date().toISOString();
        setInput('');
        clearPending();
        onSendStart?.();
        resetAtBottom();
        setMessagesState((m) => [
          ...m,
          { id: userMsgId, from: 'customer', content: text, createdAt: now, status: 'sending' },
          { id: aiMsgId, from: 'ai', content: '', createdAt: now },
        ]);
        scrollToBottom();

        let data: any;
        try {
          data = await streamChat(apiBase, payload, (delta) => {
            setMessagesState((m) =>
              m.map((msg) => (msg.id === aiMsgId ? { ...msg, content: (msg.content || '') + delta } : msg))
            );
            if (atBottomRef.current) scrollToBottom();
          });
        } catch (err: any) {
          if (err?.code === 'invalid_site_key') {
            // 密钥无效/停用：不是普通发送失败，重试没有意义，撤回乐观气泡并转入"客服不可用"状态
            setMessagesState((m) => m.filter((msg) => msg.id !== userMsgId && msg.id !== aiMsgId));
            setKeyInvalid(true);
            return;
          }
          if (err?.phase === 'stream') {
            // 流已建立但中断：服务端大概率仍在处理并会落库，最终结果由会话 SSE 推回来。
            // 移除未完成的 AI 气泡等待同步，不立刻重发（误重发也会被服务端幂等去重兜底）。
            // 兜底：超时仍未收到回复（访客消息还停在「发送中」）则标为失败可重试，避免无声永久卡住。
            setMessagesState((m) => m.filter((msg) => msg.id !== aiMsgId));
            window.setTimeout(() => {
              setMessagesState((m) =>
                m.map((msg) =>
                  msg.id === userMsgId && msg.status === 'sending'
                    ? { ...msg, status: 'failed' as const, retryText: text }
                    : msg
                )
              );
            }, STREAM_FALLBACK_MS);
            return;
          }
          // 服务端限流（429）：再回退一次性接口也会被限流，直接提示访客稍后再试
          if (err?.status === 429) {
            setMessagesState((m) =>
              m
                .filter((msg) => msg.id !== aiMsgId)
                .map((msg) =>
                  msg.id === userMsgId ? { ...msg, status: 'failed' as const, retryText: text } : msg
                )
            );
            startCooldown(err?.retryAfter > 0 ? err.retryAfter : 10);
            return;
          }
          // 请求阶段失败（流式接口不可用等）：回退一次性接口；服务端按 clientMessageId 幂等
          data = await requestJson('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
        setMessages(data.messages || [], true);
      } catch (err: any) {
        const inflight = inflightRef.current;
        if (err?.code === 'invalid_site_key') {
          // 兜底：一次性接口回退这条路上才发现密钥无效，同样撤回乐观气泡
          setMessagesState((m) => m.filter((msg) => msg.id !== inflight?.userId && msg.id !== inflight?.aiId));
          setKeyInvalid(true);
          return;
        }
        // 彻底失败：把乐观访客气泡标为「失败」并提供一键重试（移除未完成的 AI 空气泡）
        setMessagesState((m) =>
          m
            .filter((msg) => msg.id !== inflight?.aiId)
            .map((msg) =>
              msg.id === inflight?.userId
                ? { ...msg, status: 'failed' as const, retryText: text }
                : msg
            )
        );
        if (err?.status === 429) {
          startCooldown(err?.retryAfter > 0 ? err.retryAfter : 10);
        }
        scrollToBottom();
      } finally {
        inflightRef.current = null;
        setSending(false);
      }
    },
    [
      input,
      pending,
      sending,
      siteKey,
      checkRateLimit,
      ensureSession,
      setInput,
      clearPending,
      onSendStart,
      resetAtBottom,
      apiBase,
      requestJson,
      setMessages,
      scrollToBottom,
      startCooldown,
    ]
  );

  // 失败重试：移除失败气泡，按原文重发
  const retrySend = useCallback(
    (msg: UiMessage) => {
      const text = msg.retryText || msg.content || '';
      setMessagesState((m) => m.filter((x) => x.id !== msg.id));
      if (text) send(text);
    },
    [send]
  );

  // 回访访客：本地已有合法标识则直接恢复会话；否则等到首次发消息再生成
  useEffect(() => {
    const existing = loadVisitorId(siteKey);
    if (existing) {
      sessionIdRef.current = existing;
      activate();
    }
    return () => {
      sessionEvents.current?.close();
    };
  }, [siteKey, activate]);

  const onListScroll = useCallback(() => {
    const el = listEl.current;
    if (!el) return;
    const value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = value;
    setAtBottom(value);
  }, []);

  return {
    connection,
    messages,
    sending,
    atBottom,
    keyInvalid,
    listEl,
    scrollToBottom,
    resetAtBottom,
    onListScroll,
    send,
    retrySend,
  };
}
