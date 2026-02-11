import React, { useCallback, useMemo, useState } from 'react';
import 'emoji-picker-element';
import { clearAuth, getStoredAgent, getToken, type AgentIdentity } from './api.js';
import { useQueueEvents } from './hooks/useQueueEvents.js';
import SessionQueue from './components/SessionQueue.js';
import ChatPanel from './components/ChatPanel.js';
import Login from './components/Login.js';

export default function App() {
  // 客服身份来自登录态（JWT），未登录先进登录页
  const [agent, setAgent] = useState<AgentIdentity | null>(() =>
    getToken() ? getStoredAgent() : null
  );

  if (!agent) {
    return <Login onLogin={setAgent} />;
  }

  return <Workstation agent={agent} onLogout={() => { clearAuth(); setAgent(null); }} />;
}

function Workstation({ agent, onLogout }: { agent: AgentIdentity; onLogout: () => void }) {
  const { sessions } = useQueueEvents();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false); // 移动端抽屉

  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === activeId) || null,
    [sessions, activeId],
  );

  // 选中会话后在移动端自动收起队列
  const handleSelect = useCallback((id: string) => {
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
          <span className="brand">AssistFlow 客服工作台</span>
        </div>
        <span className="me">
          {agent.name}（访客咨询跟进）
          <button className="logout-btn" onClick={onLogout}>退出</button>
        </span>
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
