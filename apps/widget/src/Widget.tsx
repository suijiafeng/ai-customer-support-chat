import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@assistflow/shared';
import { createMessageArchive } from '@assistflow/shared';
import { loadVisitorId, ensureVisitorId, isVisitorIdValid } from './visitorId.js';

const newId = () => crypto.randomUUID();

type UiMessage = Partial<Message> & { id: string; from: string; content?: string };

interface PendingImage {
  id: string;
  dataUrl: string;
  name: string;
  type: string;
}

interface WidgetProps {
  apiBase: string;
  title: string;
  siteKey: string;
}

// 时间戳格式化为 HH:MM
function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 将纯文本切分为文本/链接片段，安全渲染可点击链接
const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkParts(text: string): Array<{ link: boolean; value: string }> {
  const parts: Array<{ link: boolean; value: string }> = [];
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

function normalizeMessages(list: any[] = []): UiMessage[] {
  return list.map((message) => ({
    ...message,
    from: message.from || message.actor || 'system',
  }));
}

const imageEnabled = false; // 是否启用图片发送（后端未实现相关接口，暂时隐藏入口）

// 访客快捷消息：使用内置 FAQ 问题原文，确保一键发送后能命中对应回复。
const QUICK_MESSAGES = [
  '项目怎么报价？',
  '咨询项目前需要准备什么？',
  '合作流程是什么？',
  '是否有最低合作预算？',
  '最近有档期吗？',
  '如何联系你？',
];

/**
 * 流式对话：POST /api/chat/stream 返回 SSE。
 * 逐块解析 delta 事件交给 onDelta，结束返回 done 事件的完整响应。
 */
async function streamChat(
  apiBase: string,
  payload: unknown,
  onDelta: (text: string) => void
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    // 请求根本没到服务端：调用方可以安全重试
    throw Object.assign(new Error(err?.message || 'request failed'), { phase: 'request' });
  }
  if (!response.ok || !response.body) {
    throw Object.assign(new Error(`stream failed: ${response.status}`), { phase: 'request' });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: any = null;

  const parseSseData = (data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      throw new Error(`invalid stream event data: ${data.slice(0, 120)}`);
    }
  };

  const handleBlock = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];

    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line || line.startsWith(':')) continue; // 空行/注释（心跳）

      // 规范允许 data: 后跟一个空格，去一个即可，不能 trim（会丢 delta 里的空格）
      if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }

    if (!dataLines.length) return;
    const parsed = parseSseData(dataLines.join('\n')); // 多行 data 按规范以换行拼接

    if (event === 'delta') onDelta(parsed.text || '');
    else if (event === 'done') done = parsed;
    else if (event === 'error') throw new Error(parsed?.error || 'stream error');
  };

  const drain = () => {
    let sep: number;
    // 兼容 \n\n 与 \r\n\r\n 分隔
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
      handleBlock(block);
    }
  };

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
  }

  // flush 解码器尾部 + 处理最后一段没有以空行收尾的事件
  buffer += decoder.decode();
  drain();
  if (buffer.trim()) handleBlock(buffer);

  // 流已建立但中途断开/异常：服务端可能已在处理，调用方不应盲目重发
  if (!done) throw Object.assign(new Error('stream ended without done event'), { phase: 'stream' });
  return done;
}

// 访客侧对话归档：服务端窗口外的旧消息留在本地，重启/淘汰不丢界面历史
const messageArchive = createMessageArchive(
  typeof window !== 'undefined' ? window.localStorage : undefined,
  'assistflow.history'
);

let emojiPickerPromise: Promise<unknown> | null = null;
function loadEmojiPicker() {
  emojiPickerPromise ||= import('emoji-picker-element');
  return emojiPickerPromise;
}

export default function Widget({ apiBase, title, siteKey }: WidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [connection, setConnection] = useState<'syncing' | 'synced'>('syncing');
  const [messages, setMessagesState] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState<PendingImage[]>([]); // 待发送图片附件
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [mobile, setMobile] = useState(false);
  // 窗口左上角；null = 居中（由 CSS 控制）
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const listEl = useRef<HTMLDivElement | null>(null);
  const taEl = useRef<HTMLTextAreaElement | null>(null);
  const fileEl = useRef<HTMLInputElement | null>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);
  const emojiRef = useRef<HTMLElement | null>(null);
  const sessionEvents = useRef<EventSource | null>(null);
  const sessionIdRef = useRef(''); // 访客标识：首次发送消息后才惰性生成，存于本地并带完整性校验
  const pdown = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listEl.current) listEl.current.scrollTop = listEl.current.scrollHeight;
    });
  }, []);

  const setMessages = useCallback(
    (list: any[], force = false) => {
      // 「本地归档 ∪ 服务端窗口」：服务端只保留最近一段，溢出部分从本地归档补全
      const merged = sessionIdRef.current
        ? messageArchive.merge(sessionIdRef.current, list)
        : list;
      setMessagesState(normalizeMessages(merged));
      if (force || atBottomRef.current) scrollToBottom();
    },
    [scrollToBottom]
  );

  const requestJson = useCallback(
    async (url: string, options?: RequestInit) => {
      const response = await fetch(`${apiBase}${url}`, options);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || `request failed: ${response.status}`);
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

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if ((!text && pending.length === 0) || sending) return;
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
        visitor: { code: sessionIdRef.current },
        // 幂等键：服务端据此对重试去重，避免「AI 失败 + 重发」产生重复气泡
        clientMessageId: userMsgId,
      };
      const aiMsgId = newId();
      const now = new Date().toISOString();
      setInput('');
      setPending([]);
      setShowEmoji(false);
      setShowQuick(false);
      atBottomRef.current = true;
      setAtBottom(true);
      setMessagesState((m) => [
        ...m,
        { id: userMsgId, from: 'customer', content: text, createdAt: now },
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
        if (err?.phase === 'stream') {
          // 流已建立但中断：服务端大概率仍在处理并会落库，最终结果由会话 SSE 推回来。
          // 只移除未完成的 AI 气泡等待同步，不重发（误重发也会被服务端幂等去重兜底）
          setMessagesState((m) => m.filter((msg) => msg.id !== aiMsgId));
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
    } catch {
      setMessagesState((m) => [
        ...m,
        { id: newId(), from: 'system', content: '抱歉，消息没发出去，稍后再试一下好吗？' },
      ]);
      scrollToBottom();
    } finally {
      setSending(false);
    }
  }, [input, pending, sending, ensureSession, requestJson, setMessages, scrollToBottom]);

  // 回访访客：本地已有合法标识则直接恢复会话；否则等到首次发消息再生成
  useEffect(() => {
    const computeMobile = () =>
      setMobile(window.matchMedia('(max-width: 480px), (max-height: 560px)').matches);
    computeMobile();

    const onResize = () => {
      computeMobile();
      setPanelPos((pos) => {
        if (!pos || !panelEl.current) return pos;
        const w = panelEl.current.offsetWidth;
        const h = panelEl.current.offsetHeight;
        return {
          x: Math.max(8, Math.min(pos.x, window.innerWidth - w - 8)),
          y: Math.max(8, Math.min(pos.y, window.innerHeight - h - 8)),
        };
      });
    };
    window.addEventListener('resize', onResize);

    const existing = loadVisitorId(siteKey);
    if (existing) {
      sessionIdRef.current = existing;
      activate();
    }

    return () => {
      sessionEvents.current?.close();
      window.removeEventListener('resize', onResize);
    };
  }, [siteKey, activate]);

  const toggleEmoji = useCallback(async () => {
    if (showEmoji) {
      setShowEmoji(false);
      return;
    }
    setShowQuick(false);
    setEmojiLoading(true);
    try {
      await loadEmojiPicker();
      setShowEmoji(true);
    } finally {
      setEmojiLoading(false);
    }
  }, [showEmoji]);

  // emoji-picker 是 web component，需手动绑事件
  useEffect(() => {
    if (!showEmoji) return;
    const el = emojiRef.current;
    if (!el) return;
    const handler = (e: any) => {
      setInput((v) => v + (e.detail?.unicode || ''));
      setShowEmoji(false);
      taEl.current?.focus();
    };
    el.addEventListener('emoji-click', handler);
    return () => el.removeEventListener('emoji-click', handler);
  }, [showEmoji]);

  // ---- 悬浮球：固定右下角、不可拖；窗口：居中弹出、可拖动 ----
  const onHeadDown = useCallback(
    (e: React.PointerEvent) => {
      if (mobile || !panelEl.current) return;
      if ((e.target as HTMLElement).closest?.('.x')) return; // 关闭按钮不触发拖拽
      const rect = panelEl.current.getBoundingClientRect();
      setPanelPos({ x: rect.left, y: rect.top }); // 切到绝对定位，无跳变
      pdown.current = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [mobile]
  );
  const onHeadMove = useCallback((e: React.PointerEvent) => {
    if (!pdown.current || !panelEl.current) return;
    const w = panelEl.current.offsetWidth;
    const h = panelEl.current.offsetHeight;
    const nx = pdown.current.x + (e.clientX - pdown.current.px);
    const ny = pdown.current.y + (e.clientY - pdown.current.py);
    setPanelPos({
      x: Math.max(8, Math.min(nx, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(ny, window.innerHeight - h - 8)),
    });
  }, []);
  const onHeadUp = useCallback(() => {
    if (!pdown.current) return;
    pdown.current = null;
    setDragging(false);
  }, []);

  const onListScroll = useCallback(() => {
    const el = listEl.current;
    if (!el) return;
    const value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = value;
    setAtBottom(value);
  }, []);

  const fileToDataUrl = (file: File): Promise<PendingImage> =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () =>
        resolve({ id: newId(), dataUrl: r.result as string, name: file.name || 'image', type: file.type });
      r.readAsDataURL(file);
    });

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!imageEnabled) return;
      const imgs = files
        .filter((f) => f && f.type.startsWith('image/') && f.size <= 750 * 1024)
        .slice(0, 4 - pending.length);
      const items = await Promise.all(imgs.map(fileToDataUrl));
      setPending((p) => [...p, ...items].slice(0, 4));
    },
    [pending.length]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
      if (items.length) {
        e.preventDefault();
        addFiles(items.map((i) => i.getAsFile()).filter((f): f is File => Boolean(f)));
      }
    },
    [addFiles]
  );

  const onPickFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles([...(e.target.files || [])]);
      e.target.value = '';
    },
    [addFiles]
  );

  const removePending = useCallback(
    (i: number) => setPending((p) => p.filter((_, idx) => idx !== i)),
    []
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next) {
        setPanelPos(null); // 每次打开都居中
        atBottomRef.current = true;
        setAtBottom(true);
        scrollToBottom();
      }
      return next;
    });
  }, [scrollToBottom]);

  // 窗口内联定位：拖动后用 left/top，否则留空由 CSS 居中（移动端始终全屏）
  const panelStyle: React.CSSProperties =
    panelPos && !mobile
      ? { left: panelPos.x, top: panelPos.y, right: 'auto', bottom: 'auto', margin: 0 }
      : {};

  return (
    <div className="afw">
      {open && (
        <>
          <button className="backdrop" type="button" aria-label="关闭聊天窗口" onClick={toggle} />
          <div className={`panel${dragging ? ' dragging' : ''}`} ref={panelEl} style={panelStyle}>
            <div
              className="head"
              onPointerDown={onHeadDown}
              onPointerMove={onHeadMove}
              onPointerUp={onHeadUp}
              onPointerCancel={onHeadUp}
            >
              <span className="title">
                {title}
                <span className="sub">
                  <span className={`dot ${connection === 'synced' ? '' : 'off'}`} />
                  {connection === 'synced' ? '消息已同步' : '正在同步'}
                </span>
              </span>
              <button className="x" onClick={toggle} aria-label="关闭">×</button>
            </div>
            <div className="list-wrap">
              <div className="list" ref={listEl} onScroll={onListScroll}>
                {messages.length === 0 && (
                  <div className="hint">
                    你好呀，我是开发者的智能助手 👋<br />有什么想了解的直接问我，或点下方快捷提问
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`row ${m.from}`}>
                    {m.from !== 'system' && (
                      <div className={`avatar ${m.from}`}>
                        {m.from === 'customer' ? '我' : m.from === 'ai' ? 'AI' : '客'}
                      </div>
                    )}
                    <div className="col">
                      {m.from !== 'customer' && m.from !== 'system' && (
                        <div className="meta">
                          {m.from === 'ai' ? '智能助手' : m.agentName || '开发者本人'}
                        </div>
                      )}
                      <div className="bubble">
                        {m.content && (
                          <div className="txt">
                            {linkParts(m.content).map((part, i) =>
                              part.link ? (
                                <a key={i} href={part.value} target="_blank" rel="noopener noreferrer">
                                  {part.value}
                                </a>
                              ) : (
                                <React.Fragment key={i}>{part.value}</React.Fragment>
                              )
                            )}
                          </div>
                        )}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="imgs">
                            {m.attachments.map((a, j) => (
                              <button
                                key={j}
                                className="image-link"
                                type="button"
                                onClick={() => window.open(a.dataUrl, '_blank')}
                              >
                                <img src={a.dataUrl} alt={a.name} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {m.from !== 'system' && fmtTime(m.createdAt) && (
                        <div className="time">{fmtTime(m.createdAt)}</div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && !(messages.at(-1)?.from === 'ai' && messages.at(-1)?.content) && (
                  <div className="row ai">
                    <div className="avatar ai">AI</div>
                    <div className="col">
                      <div className="bubble">
                        <span className="typing-dots"><i></i><i></i><i></i></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {!atBottom && (
                <button className="to-bottom" onClick={scrollToBottom} aria-label="回到底部">↓</button>
              )}
            </div>

            {pending.length > 0 && (
              <div className="previews">
                {pending.map((p, i) => (
                  <div key={p.id} className="thumb">
                    <img src={p.dataUrl} alt={p.name} />
                    <button onClick={() => removePending(i)}>×</button>
                  </div>
                ))}
              </div>
            )}

            {showEmoji && (
              <div className="emoji-pop">
                <emoji-picker ref={emojiRef}></emoji-picker>
              </div>
            )}

            {(showQuick || messages.length === 0) && !sending && (
              <div className="quick-pop" role="menu" aria-label="快捷提问">
                {QUICK_MESSAGES.map((text) => (
                  <button key={text} role="menuitem" onClick={() => send(text)}>
                    {text}
                  </button>
                ))}
              </div>
            )}

            <div className="composer">
              <textarea
                rows={2}
                placeholder="输入消息，Enter 发送…"
                ref={taEl}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
              />
              <div className="composer-foot">
                <div className="toolbar">
                  <button
                    className={`tool${showEmoji || emojiLoading ? ' active' : ''}`}
                    title="表情"
                    aria-busy={emojiLoading}
                    onClick={toggleEmoji}
                  >{emojiLoading ? '…' : '😊'}</button>
                  <button
                    className={`tool${showQuick ? ' active' : ''}`}
                    title="快捷提问"
                    aria-pressed={showQuick}
                    onClick={() => { setShowQuick((v) => !v); setShowEmoji(false); }}
                  >⚡</button>
                  {imageEnabled && (
                    <>
                      <button className="tool" title="发送图片/截图" onClick={() => fileEl.current?.click()}>🖼️</button>
                      <input type="file" accept="image/*" multiple hidden ref={fileEl} onChange={onPickFiles} />
                    </>
                  )}
                  <span className="key-hint">Shift + Enter 换行</span>
                </div>
                <button
                  className="send"
                  onClick={() => send()}
                  disabled={sending || (!input.trim() && pending.length === 0)}
                >
                  {sending ? '发送中' : '发送'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {!open && <button className="fab" onClick={toggle}>💬</button>}
    </div>
  );
}
