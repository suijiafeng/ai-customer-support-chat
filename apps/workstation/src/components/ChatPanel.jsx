import React from 'react';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import { useSessionMessages } from '../hooks/useSessionMessages.js';

const CONNECTION_LABEL = {
  synced: '消息已同步',
  syncing: '正在同步…',
  reconnecting: '连接中断，重连中…',
};

export default function ChatPanel({ session, agent }) {
  const sessionId = session?.sessionId || null;
  const { messages, setMessages, status, connection, reload } = useSessionMessages(sessionId);

  if (!session) {
    return (
      <main className="chat">
        <div className="empty"><span className="ico" aria-hidden="true">🗂️</span>从左侧选择一个会话开始接待</div>
      </main>
    );
  }

  return (
    <main className="chat">
      <div className="chat-head">
        <span>
          {session.displayName} ·{' '}
          <span className={`conn conn-${connection}`}>
            <span className="conn-dot" aria-hidden="true" />
            {CONNECTION_LABEL[connection] || connection}
          </span>
        </span>
        <span className="tag tag-success">服务端同步</span>
      </div>

      {connection === 'reconnecting' && (
        <div className="banner banner-warn" role="status">
          实时连接已断开，正在自动重连…
        </div>
      )}

      {status === 'error' ? (
        <div className="state-block">
          <span className="ico" aria-hidden="true">⚠️</span>
          <p>历史消息加载失败</p>
          <button className="retry-btn" onClick={reload}>重试</button>
        </div>
      ) : (
        <MessageList messages={messages} customerName={session.displayName} status={status} />
      )}

      <Composer sessionId={sessionId} agent={agent} onSent={setMessages} />
    </main>
  );
}
