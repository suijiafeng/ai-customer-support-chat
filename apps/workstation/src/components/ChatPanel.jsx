import React from 'react';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import { useSessionMessages } from '../hooks/useSessionMessages.js';

export default function ChatPanel({ session, agent }) {
  const sessionId = session?.sessionId || null;
  const { messages, setMessages, connection } = useSessionMessages(sessionId);

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
        <span>{session.displayName} · {connection === 'synced' ? '消息已同步' : '正在同步'}</span>
        <span className="tag tag-success">服务端同步</span>
      </div>
      <MessageList messages={messages} customerName={session.displayName} />
      <Composer sessionId={sessionId} agent={agent} onSent={setMessages} />
    </main>
  );
}
