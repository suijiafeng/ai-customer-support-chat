import React, { useCallback, useMemo, useState } from 'react';
import { clearAuth, getStoredAgent, getToken, type AgentIdentity } from './api.js';
import { useQueueEvents } from './hooks/useQueueEvents.js';
import SessionQueue from './components/SessionQueue.js';
import ChatPanel from './components/ChatPanel.js';
import Login from './components/Login.js';
import AgentMenu from './components/AgentMenu.js';
import OperationsPanel from './components/OperationsPanel.js';
import TenantsPanel from './components/TenantsPanel.js';
import { FeedbackHost } from './ui/feedback.js';
import Icon from './ui/Icon.js';

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

type View = 'sessions' | 'ops' | 'tenants';

type ViewDef = { key: View; label: string; icon: 'inbox' | 'bar-chart' | 'building' };
const VIEWS: ViewDef[] = [
  { key: 'sessions', label: '会话接待', icon: 'inbox' },
  { key: 'ops', label: '运营中心', icon: 'bar-chart' },
];

function Workstation({ agent, onLogout }: { agent: AgentIdentity; onLogout: () => void }) {
  const { sessions, ready: queueReady } = useQueueEvents();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false); // 移动端抽屉
  const [view, setView] = useState<View>('sessions');
  // 租户管理仅 admin 可见；后端本身也会拒绝非 admin 请求，这里是双重保险
  const views = useMemo<ViewDef[]>(
    () => agent.role === 'admin'
      ? [...VIEWS, { key: 'tenants' as const, label: '租户管理', icon: 'building' as const }]
      : VIEWS,
    [agent.role],
  );

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
          ><Icon name="menu" size={20} /></button>
          <button className="brand" type="button" onClick={() => setView('sessions')}>
            AssistFlow 客服工作台
          </button>
        </div>
        <nav className="view-tabs" aria-label="功能页签">
          {views.map((v) => (
            <button
              key={v.key}
              aria-current={view === v.key}
              className={view === v.key ? 'active' : ''}
              onClick={() => setView(v.key)}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
            </button>
          ))}
        </nav>
        <div className="menu-wraper">
          <AgentMenu agent={agent} sessions={sessions} onLogout={onLogout} />
        </div>
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
              ready={queueReady}
            />
            {queueOpen && <div className="queue-overlay" onClick={() => setQueueOpen(false)} aria-hidden="true" />}
            <ChatPanel session={activeSession} agent={agent} />
          </>
        )}
        {view === 'ops' && (
          <OperationsPanel agent={agent} onOpenSession={(id) => { setView('sessions'); handleSelect(id); }} />
        )}
        {view === 'tenants' && agent.role === 'admin' && <TenantsPanel />}
      </div>
    </div>
  );
}
