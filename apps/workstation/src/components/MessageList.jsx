import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime, linkParts } from '../api.js';

const avatarText = (from) => (from === 'customer' ? '访' : from === 'ai' ? 'AI' : '本');

function RichText({ text }) {
  return (
    <div className="txt">
      {linkParts(text).map((p, i) =>
        p.link
          ? <a key={i} href={p.value} target="_blank" rel="noopener noreferrer">{p.value}</a>
          : <span key={i}>{p.value}</span>,
      )}
    </div>
  );
}

const MessageRow = memo(function MessageRow({ m, customerName }) {
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
          {m.content && <RichText text={m.content} />}
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

export default function MessageList({ messages, customerName }) {
  const listEl = useRef(null);
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
        {!messages.length && (
          <div className="empty"><span className="ico" aria-hidden="true">💬</span>加载中…</div>
        )}
      </div>
      {!atBottom && (
        <button className="to-bottom" onClick={() => { setAtBottom(true); scrollToBottom(); }} aria-label="回到底部">↓</button>
      )}
    </div>
  );
}
