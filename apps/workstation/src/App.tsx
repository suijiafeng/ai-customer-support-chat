import React, { useCallback, useMemo, useState } from 'react';
import { clearAuth, getStoredAgent, getToken, type AgentIdentity } from './api.js';
import { useQueueEvents } from './hooks/useQueueEvents.js';
import SessionQueue from './components/SessionQueue.js';
import ChatPanel from './components/ChatPanel.js';
import Login from './components/Login.js';
import AgentMenu from './components/AgentMenu.js';
import TicketsPanel from './components/TicketsPanel.js';
import MetricsPanel from './components/MetricsPanel.js';
import { FeedbackHost } from './ui/feedback.js';

export default function App() {
  // 客服身份来自登录态（JWT），未登录先进登录页
  const [agent, setAgent] = useState<AgentIdentity | null>(() =>
    getToken() ? getStoredAgent() : null
  );

  return (
    <>
      {agent
        ? <Workstation agent={agent} onLogout={() => { clearAuth(); setAgent(null); }} />
        : <Login onLogin={setAgent} />}
      <FeedbackHost />
    </>
  );
}

type View = 'sessions' | 'tickets' | 'metrics';

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'sessions', label: '会话接待' },
  { key: 'tickets', label: '跟进事项' },
  { key: 'metrics', label: '数据看板' },
];

function Workstation({ agent, onLogout }: { agent: AgentIdentity; onLogout: () => void }) {
  const { sessions } = useQueueEvents();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false); // 移动端抽屉
  const [view, setView] = useState<View>('sessions');

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
          <nav className="view-tabs" aria-label="功能页签">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                aria-current={view === v.key}
                className={view === v.key ? 'active' : ''}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </div>
        <AgentMenu agent={agent} sessions={sessions} onLogout={onLogout} />
      </header>
      <div className="body">
        {view === 'sessions' && (
          <>
            <SessionQueue
              sessions={sessions}
              activeId={activeId}
              onSelect={handleSelect}
              open={queueOpen}
              agent={agent}
            />
            {queueOpen && <div className="queue-overlay" onClick={() => setQueueOpen(false)} aria-hidden="true" />}
            <ChatPanel session={activeSession} agent={agent} />
          </>
        )}
        {view === 'tickets' && (
          <TicketsPanel agent={agent} onOpenSession={(id) => { setView('sessions'); handleSelect(id); }} />
        )}
        {view === 'metrics' && <MetricsPanel />}
      </div>
    </div>
  );
}
