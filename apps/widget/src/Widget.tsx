import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, linkParts } from '@assistflow/shared';
import { Markdown } from './markdown.js';
import { newId, type PendingImage } from './chatApi.js';
import { useDraggablePanel, type ResizeDir } from './hooks/useDraggablePanel.js';
import EmojiPicker from './EmojiPicker.js';
import { useDraggableFab } from './hooks/useDraggableFab.js';
import { useEmojiPicker } from './hooks/useEmojiPicker.js';
import { useSendCooldown } from './hooks/useSendCooldown.js';
import { useChatSession } from './hooks/useChatSession.js';

interface WidgetProps {
  apiBase: string;
  title?: string;
  siteKey: string;
  /** 租户ID（data-name），与 siteKey 成对，后端校验两者匹配 */
  tenantId: string;
}

const imageEnabled = false; // 是否启用图片发送（后端未实现相关接口，暂时隐藏入口）

// 访客快捷消息：使用内置 FAQ 问题原文，确保一键发送后能命中对应回复。
// 窗口八个方向的拉伸手柄（四边 + 四角）
const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function fileToDataUrl(file: File): Promise<PendingImage> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () =>
      resolve({ id: newId(), dataUrl: r.result as string, name: file.name || 'image', type: file.type });
    r.readAsDataURL(file);
  });
}

const QUICK_MESSAGES = [
  '项目怎么报价？',
  '咨询项目前需要准备什么？',
  '合作流程是什么？',
  '是否有最低合作预算？',
  '最近有档期吗？',
  '如何联系你？',
];

export default function Widget({ apiBase, title, siteKey, tenantId }: WidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingImage[]>([]); // 待发送图片附件
  const [showQuick, setShowQuick] = useState(false);
  const [unread, setUnread] = useState(0); // 关闭状态下收到的新回复数（FAB 红点）
  const seenInboundRef = useRef(0); // 已读的 AI/客服消息数
  const baselinedRef = useRef(false); // 首次同步完成后才开始计增量，避免历史消息触发红点

  const taEl = useRef<HTMLTextAreaElement | null>(null);
  const fileEl = useRef<HTMLInputElement | null>(null);
  const composerAreaRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);

  const {
    mobile,
    narrow,
    panelPos,
    setPanelPos,
    panelSize,
    dragging,
    panelRef: panelEl,
    onHeadDown,
    onHeadMove,
    onHeadUp,
    onResizeDown,
    onResizeMove,
    onResizeUp,
  } = useDraggablePanel();

  const { fabRef, fabPos, fabDragging, onFabDown, onFabMove, onFabUp, consumeDrag } =
    useDraggableFab();

  const { cooldown, checkRateLimit, startCooldown } = useSendCooldown();

  const {
    showEmoji,
    toggleEmoji,
    handleSelect: handleEmojiSelect,
    close: closeEmoji,
  } = useEmojiPicker({
    onInsert: (emoji) => {
      setInput((v) => v + emoji);
      taEl.current?.focus();
    },
    onOpen: () => setShowQuick(false),
  });

  // 面板打开时锁住宿主页面滚动，防止穿透
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (open) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // backdrop 上的 wheel/touchmove 必须用原生非被动监听器才能 preventDefault；
  // React 合成事件的 onWheel/onTouchMove 在 Chrome 中默认被标记为 passive，调用
  // preventDefault() 无效并触发控制台警告。
  useEffect(() => {
    if (!open) return;
    const el = backdropRef.current;
    if (!el) return;
    const noScroll = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', noScroll, { passive: false });
    el.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      el.removeEventListener('wheel', noScroll);
      el.removeEventListener('touchmove', noScroll);
    };
  }, [open]);

  // 点击 composer 区域外时关闭表情/快捷提问弹层
  // widget 运行在 Shadow DOM 中，e.target 在 shadow 边界外会被重定向；
  // 用 composedPath() 获取真实路径，再检查 composerAreaRef 是否在路径上。
  useEffect(() => {
    if (!showEmoji && !showQuick) return;
    const root = (composerAreaRef.current?.getRootNode() ?? document) as Document | ShadowRoot;
    const onDown = (e: MouseEvent) => {
      const inside = e.composedPath().includes(composerAreaRef.current as EventTarget);
      if (!inside) {
        closeEmoji();
        setShowQuick(false);
      }
    };
    root.addEventListener('mousedown', onDown as EventListener);
    return () => root.removeEventListener('mousedown', onDown as EventListener);
  }, [showEmoji, showQuick, closeEmoji]);

  const clearPending = useCallback(() => setPending([]), []);
  const onSendStart = useCallback(() => {
    closeEmoji();
    setShowQuick(false);
  }, [closeEmoji]);

  const {
    connection,
    messages,
    sending,
    atBottom,
    keyInvalid,
    sessionId,
    listEl,
    scrollToBottom,
    resetAtBottom,
    onListScroll,
    send,
    retrySend,
  } = useChatSession({
    apiBase,
    siteKey,
    tenantId,
    input,
    setInput,
    pending,
    clearPending,
    checkRateLimit,
    startCooldown,
    onSendStart,
  });

  const displayTitle = title || (sessionId ? '访客 ' + sessionId.slice(0, 20) : '访客');

  // 未读红点：首次同步后建立基准，之后关闭状态下收到新消息才计数；打开即清零
  const inboundCount = useMemo(
    () => messages.filter((m) => m.from === 'ai' || m.from === 'agent').length,
    [messages],
  );
  useEffect(() => {
    if (open) {
      seenInboundRef.current = inboundCount;
      setUnread(0);
      return;
    }
    // 首次同步完成时建立基准，不触发红点
    if (!baselinedRef.current && connection === 'synced') {
      baselinedRef.current = true;
      seenInboundRef.current = inboundCount;
      return;
    }
    if (baselinedRef.current && inboundCount > seenInboundRef.current) {
      setUnread(inboundCount - seenInboundRef.current);
    }
  }, [inboundCount, open, connection]);

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
        if (cooldown > 0) return; // 倒计时中禁用 Enter 等快捷键发送
        send();
      }
    },
    [send, cooldown]
  );

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next) {
        setPanelPos(null); // 每次打开都居中
        resetAtBottom();
        scrollToBottom();
      }
      return next;
    });
  }, [setPanelPos, resetAtBottom, scrollToBottom]);

  // 窗口内联定位：拖动后用 left/top，否则留空由 CSS 居中；拉伸过的宽高持续生效（移动端始终全屏）
  const panelStyle = useMemo<React.CSSProperties>(() => ({
    ...(panelSize && !mobile ? { width: panelSize.w, height: panelSize.h } : {}),
    ...(panelPos && !mobile
      ? { left: panelPos.x, top: panelPos.y, right: 'auto', bottom: 'auto', margin: 0 }
      : {}),
  }), [panelSize, panelPos, mobile]);

  // 悬浮球：拖动后改为 fixed + left/top，吸附/拖动位置均由 hook 计算
  const fabStyle = useMemo<React.CSSProperties | undefined>(() =>
    fabPos ? { position: 'fixed', left: fabPos.x, top: fabPos.y, right: 'auto', bottom: 'auto' } : undefined,
  [fabPos]);

  return (
    <div className={`afw${mobile ? ' mobile' : narrow ? ' narrow' : ''}`}>
      {open && (
        <>
          <button
            ref={backdropRef}
            className="backdrop"
            type="button"
            aria-label="关闭聊天窗口"
            onClick={toggle}
          />
          <div className={`panel${dragging ? ' dragging' : ''}`} ref={panelEl} style={panelStyle}>
            {!mobile &&
              RESIZE_DIRS.map((dir) => (
                <div
                  key={dir}
                  className={`rs rs-${dir}`}
                  onPointerDown={(e) => onResizeDown(e, dir)}
                  onPointerMove={onResizeMove}
                  onPointerUp={onResizeUp}
                  onPointerCancel={onResizeUp}
                />
              ))}
            <div
              className="head"
              onPointerDown={onHeadDown}
              onPointerMove={onHeadMove}
              onPointerUp={onHeadUp}
              onPointerCancel={onHeadUp}
            >
              <span className="title">
                {displayTitle}
               {!mobile&&<span className="sub">
                  <span className={`dot ${connection === 'synced' ? '' : 'off'}`} />
                  {connection === 'synced' ? '消息已同步' : '正在同步'}
                </span>}
              </span>
              <button className="x" onClick={toggle} aria-label="关闭">×</button>
            </div>
            <div className="list-wrap">
              <div className="list" ref={listEl} onScroll={onListScroll}>
                {messages.length === 0 && (
                  <div className="hint">
                    你好呀，我是开发者的智能助手<br />有什么想了解的直接问我，或点下方快捷提问
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
                        {m.from === 'ai' && !m.content && !m.attachments?.length && (
                          <span className="typing-dots"><i></i><i></i><i></i></span>
                        )}
                        {m.content && (
                          (m.from === 'ai' || m.from === 'agent') ? (
                            // AI/客服消息按 Markdown 渲染；访客/系统消息保持纯文本（避免把输入当 Markdown）
                            <div className="txt"><Markdown text={m.content} /></div>
                          ) : (
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
                          )
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
                      {m.from === 'customer' && m.status === 'sending' && (
                        <div className="msg-status">发送中…</div>
                      )}
                      {m.from === 'customer' && m.status === 'failed' && (
                        <div className="msg-status failed">
                          发送失败
                          <button type="button" className="retry-link" onClick={() => retrySend(m)}>重试</button>
                        </div>
                      )}
                      {m.from !== 'system' && m.status !== 'failed' && m.status !== 'sending' && (() => {
                        const t = fmtTime(m.createdAt);
                        return t ? <div className="time">{t}</div> : null;
                      })()}
                    </div>
                  </div>
                ))}
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

            <div ref={composerAreaRef} style={{ display: 'contents' }}>
            {showEmoji && (
              <div className="emoji-pop">
                <EmojiPicker onSelect={handleEmojiSelect} />
              </div>
            )}

            {showQuick && !sending && (
              <div className="quick-pop" role="menu" aria-label="快捷提问">
                {QUICK_MESSAGES.map((text) => (
                  <button key={text} role="menuitem" onClick={() => { setInput(text); setShowQuick(false); taEl.current?.focus(); }}>
                    {text}
                  </button>
                ))}
              </div>
            )}

            {cooldown > 0 && (
              <div className="cooldown-bar" role="status">
                {`发送太频繁，请等 ${cooldown} 秒再试`}
              </div>
            )}
            {keyInvalid ? (
              <div className="composer" role="status">
                <div className="key-invalid-bar">服务暂不可用，请联系管理员</div>
              </div>
            ) : (
            <div className="composer">
              <textarea
                rows={2}
                placeholder="输入消息，Enter 发送…"
                ref={taEl}
                value={input}
                maxLength={2000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
              />
              <div className="composer-foot">
                <div className="toolbar">
                  <button
                    className={`tool${showEmoji ? ' active' : ''}`}
                    title="表情"
                    onClick={toggleEmoji}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                  </button>
                  <button
                    className={`tool${showQuick ? ' active' : ''}`}
                    title="快捷提问"
                    aria-pressed={showQuick}
                    onClick={() => { setShowQuick((v) => !v); closeEmoji(); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  </button>
                  {imageEnabled && (
                    <>
                      <button className="tool" title="发送图片/截图" onClick={() => fileEl.current?.click()}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      </button>
                      <input type="file" accept="image/*" multiple hidden ref={fileEl} onChange={onPickFiles} />
                    </>
                  )}
                  <span className="key-hint">Shift + Enter 换行</span>
                </div>
                <button
                  className="send"
                  onClick={() => send()}
                  disabled={sending || cooldown > 0 || (!input.trim() && pending.length === 0)}
                >
                  {sending ? '发送中' : '发送'}
                </button>
              </div>
            </div>
            )}
            </div>{/* composerAreaRef */}
          </div>
        </>
      )}
      {!open && (
        <button
          className={`fab${fabDragging ? ' dragging' : ''}`}
          ref={fabRef}
          style={fabStyle}
          onPointerDown={onFabDown}
          onPointerMove={onFabMove}
          onPointerUp={onFabUp}
          onPointerCancel={onFabUp}
          onClick={() => {
            if (consumeDrag()) return; // 拖拽结束触发的 click 不打开窗口
            toggle();
          }}
          aria-label={unread > 0 ? `有 ${unread} 条新消息` : '打开客服'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {unread > 0 && <span className="fab-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    </div>
  );
}
