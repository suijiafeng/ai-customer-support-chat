import React, { memo, useCallback, useMemo, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { type AgentIdentity } from '../api.js';

interface SessionItemProps {
  s: SessionSummary;
  active: boolean;
  onSelect: (id: string) => void;
}

const SessionItem = memo(function SessionItem({ s, active, onSelect }: SessionItemProps) {
  const handleClick = useCallback(() => onSelect(s.sessionId), [s.sessionId, onSelect]);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.sessionId); }
  }, [s.sessionId, onSelect]);

  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-current={active}
      className={`sess${active ? ' active' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="sess-top">
        <span className="name">
          {s.priority === 'high' && <span className="prio-dot" aria-label="高优先级" />}
          {s.displayName}
        </span>
      </div>
      <div className="last">{s.lastMessage || '（暂无消息）'}</div>
    </div>
  );
});

interface SessionQueueProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  open?: boolean;
  agent?: AgentIdentity;
  ready?: boolean;
}

type Filter = 'all' | 'mine' | 'closed';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我的' },
  { key: 'closed', label: '已关闭' },
];

export default function SessionQueue({ sessions, activeId, onSelect, open = false, agent, ready = false }: SessionQueueProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');
  const [poolOpen, setPoolOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  const { pool, others, poolTotal } = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const isPool = (s: SessionSummary) => !s.assignedAgentId && s.status !== 'closed';
    const match = (s: SessionSummary) =>
      !kw ||
      s.displayName.toLowerCase().includes(kw) ||
      (s.lastMessage || '').toLowerCase().includes(kw) ||
      (s.inquiryId || '').toLowerCase().includes(kw);

    const pool = sessions.filter((s) => isPool(s) && match(s));
    const poolTotal = sessions.filter(isPool).length; // 不受关键字过滤，显示真实待接待数
    const others = sessions.filter((s) => {
      if (isPool(s)) return false;
      if (filter === 'mine' && s.assignedAgentId !== agent?.id) return false;
      if (filter === 'closed' && s.status !== 'closed') return false;
      return match(s);
    });
    return { pool, others, poolTotal };
  }, [sessions, filter, keyword, agent]);

  const renderItem = (s: SessionSummary) => (
    <SessionItem key={s.sessionId} s={s} active={s.sessionId === activeId} onSelect={onSelect} />
  );

  return (
    <aside className={`queue${open ? ' open' : ''}`} aria-label="会话列表">
      <div className="queue-top">
        <input
          className="queue-search"
          placeholder="搜索访客 / 消息…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="queue-scroll">
        {/* 接待大厅 */}
        <div className="queue-section queue-pool" role="group" aria-label="接待大厅">
          <div
            className="q-section-head"
            role="button"
            tabIndex={0}
            aria-expanded={poolOpen}
            onClick={() => setPoolOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPoolOpen((v) => !v); } }}
          >
            <span className={`q-caret${poolOpen ? ' open' : ''}`}>▸</span>
            <span className="q-section-title">接待大厅</span>
            {poolTotal > 0 && <span className="q-badge">{poolTotal} 待接待</span>}
          </div>
          {poolOpen && (
            <div role="list" className="q-list">
              {pool.map(renderItem)}
              {!pool.length && (
                <div className="section-empty">{ready ? '暂无待接待客户' : '连接中…'}</div>
              )}
            </div>
          )}
        </div>

        {/* 我的会话 */}
        <div className="queue-section" role="group" aria-label="我的会话">
          <div
            className="q-section-head"
            role="button"
            tabIndex={0}
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setListOpen((v) => !v); } }}
          >
            <span className={`q-caret${listOpen ? ' open' : ''}`}>▸</span>
            <span className="q-section-title">我的会话</span>
            <span className="q-count">{others.length}</span>
            <div className="q-filters" role="tablist" onClick={(e) => e.stopPropagation()}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={filter === f.key}
                  className={filter === f.key ? 'active' : ''}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {listOpen && (
            <div role="list" className="q-list">
              {others.map(renderItem)}
              {!others.length && <div className="section-empty">暂无会话</div>}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
