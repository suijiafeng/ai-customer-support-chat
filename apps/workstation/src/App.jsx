import React, { useCallback, useMemo, useState } from 'react';
import 'emoji-picker-element';
import { stableAgentId } from './api.js';
import { useQueueEvents } from './hooks/useQueueEvents.js';
import SessionQueue from './components/SessionQueue.jsx';
import ChatPanel from './components/ChatPanel.jsx';

export default function App() {
  // 开发者身份在组件生命周期内稳定
  const [agent] = useState(() => ({ id: stableAgentId(), name: '开发者本人' }));
  const { sessions } = useQueueEvents();
  const [activeId, setActiveId] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false); // 移动端抽屉

  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === activeId) || null,
    [sessions, activeId],
  );

  // 选中会话后在移动端自动收起队列
  const handleSelect = useCallback((id) => {
    setActiveId(id);
    setQueueOpen(false);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="menu-btn"
            aria-label={queueOpen ? '收起会话队列' : '展开会话队列'}
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen((v) => !v)}
          >☰</button>
          <span className="brand">AssistFlow 开发者工作台</span>
        </div>
        <span className="me">{agent.name}（访客咨询跟进）</span>
      </header>
      <div className="body">
        <SessionQueue
          sessions={sessions}
          activeId={activeId}
          onSelect={handleSelect}
          open={queueOpen}
        />
        {queueOpen && <div className="queue-overlay" onClick={() => setQueueOpen(false)} aria-hidden="true" />}
        <ChatPanel session={activeSession} agent={agent} />
      </div>
    </div>
  );
}
