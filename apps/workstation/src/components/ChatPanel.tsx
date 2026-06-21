import React, { useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import MessageList from './MessageList.js';
import Composer from './Composer.js';
import SessionDetail from './SessionDetail.js';
import { useSessionMessages, type ConnectionStatus } from '../hooks/useSessionMessages.js';
import { type AgentIdentity } from '../api.js';

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  synced: '消息已同步',
  syncing: '正在同步…',
  reconnecting: '连接中断，重连中…',
};

interface ChatPanelProps {
  session: SessionSummary | null;
  agent: AgentIdentity;
}

export default function ChatPanel({ session, agent }: ChatPanelProps) {
  const sessionId = session?.sessionId || null;
  const { messages, applyServer, status, connection, reload } = useSessionMessages(sessionId);
  const [showDetail, setShowDetail] = useState(true);

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
        <button
          className={`ghost-btn${showDetail ? ' active' : ''}`}
          aria-pressed={showDetail}
          onClick={() => setShowDetail((v) => !v)}
        >
          {showDetail ? '收起详情' : '会话详情'}
        </button>
      </div>

      {connection === 'reconnecting' && (
        <div className="banner banner-warn" role="status">
          实时连接已断开，正在自动重连…
        </div>
      )}

      <div className="chat-body">
        <div className="chat-main">
          {status === 'error' ? (
            <div className="state-block">
              <span className="ico" aria-hidden="true">⚠️</span>
              <p>历史消息加载失败</p>
              <button className="retry-btn" onClick={reload}>重试</button>
            </div>
          ) : (
            <MessageList messages={messages} customerName={session.displayName} status={status} />
          )}
          {!session.assignedAgentId && session.status !== 'closed' && (
            <div className="claim-hint-bar" role="status">
              <span aria-hidden="true">📥</span> 该客户来自接待大厅，发送消息即接待并归入「我的会话」
            </div>
          )}
          <Composer sessionId={sessionId} agent={agent} onSent={applyServer} />
        </div>
        {showDetail && (
          <SessionDetail
            session={session}
            onClose={() => setShowDetail(false)}
            canResolve={agent.role === 'admin' || session.assignedAgentId === agent.id}
          />
        )}
      </div>
    </main>
  );
}
