import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime, type UiMessage } from '../api.js';
import type { HistoryStatus } from '../hooks/useSessionMessages.js';
import { Markdown } from '../ui/markdown.js';

const avatarText = (from: string) => (from === 'customer' ? '访' : from === 'ai' ? 'AI' : '本');

// AI/客服消息按 Markdown 渲染；访客消息按纯文本（保留换行），避免把用户输入当 Markdown
function RichText({ text, markdown }: { text: string; markdown?: boolean }) {
  if (markdown) return <div className="txt"><Markdown text={text} /></div>;
  return <div className="txt md-plain">{text}</div>;
}

const MessageRow = memo(function MessageRow({ m, customerName }: { m: UiMessage; customerName?: string }) {
  const who = m.from === 'customer'
    ? (customerName || '访客')
    : m.from === 'ai' ? '智能助手' : (m.agentName || '开发者本人');
  const time = fmtTime(m.createdAt);
  return (
    <div className={`row ${m.from}`}>
      <div className={`avatar ${m.from}`} aria-hidden="true">{avatarText(m.from)}</div>
      <div className="col">
        {m.from !== 'agent' && <div className="meta">{who}</div>}
        <div className="bubble">
          {m.content && <RichText text={m.content} markdown={m.from !== 'customer'} />}
          {m.attachments?.length > 0 && (
            <div className="imgs">
              {m.attachments.map((a, j) => (
                <img
                  key={j}
                  src={a.dataUrl}
                  alt={a.name || '图片附件'}
                  onClick={() => window.open(a.dataUrl, '_blank')}
                />
              ))}
            </div>
          )}
        </div>
        {time && <div className="time">{time}</div>}
      </div>
    </div>
  );
});

function Skeleton() {
  // 历史加载中的占位骨架，避免空白或与“暂无消息”混淆
  return (
    <div className="skeleton" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`sk-row${i % 2 ? ' me' : ''}`}>
          <div className="sk-avatar" />
          <div className="sk-bubble" />
        </div>
      ))}
    </div>
  );
}

interface MessageListProps {
  messages: UiMessage[];
  customerName?: string;
  status?: HistoryStatus;
}

export default function MessageList({ messages, customerName, status = 'ready' }: MessageListProps) {
  const listEl = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = listEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = listEl.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  // 新消息：贴底时自动跟随，否则保持位置（由“回到底部”按钮提示）
  useEffect(() => {
    if (atBottom) scrollToBottom();
  }, [messages, atBottom, scrollToBottom]);

  return (
    <div className="list-wrap">
      <div ref={listEl} className="msgs" role="log" aria-live="polite" aria-label="对话消息" onScroll={onScroll}>
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} customerName={customerName} />
        ))}
        {!messages.length && status === 'loading' && <Skeleton />}
        {!messages.length && status === 'ready' && (
          <div className="empty"><span className="ico" aria-hidden="true">💬</span>暂无消息，等待访客发起咨询</div>
        )}
      </div>
      {!atBottom && (
        <button className="to-bottom" onClick={() => { setAtBottom(true); scrollToBottom(); }} aria-label="回到底部">↓</button>
      )}
    </div>
  );
}
