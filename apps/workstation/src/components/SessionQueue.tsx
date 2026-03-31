import React, { useMemo, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { type AgentIdentity } from '../api.js';

interface SessionQueueProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  open?: boolean;
  agent?: AgentIdentity;
}

// 下方“会话列表”分区的筛选（公共池已独立成上方分区，不在此列）
type Filter = 'all' | 'mine' | 'closed';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我的接待' },
  { key: 'closed', label: '已关闭' },
];

export default function SessionQueue({ sessions, activeId, onSelect, open = false, agent }: SessionQueueProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');
  // 手风琴展开状态，默认都展开
  const [poolOpen, setPoolOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  // 公共池：尚未被认领且未关闭的会话（可抢单）；其余进入下方会话列表
  const { pool, others } = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const match = (s: SessionSummary) =>
      !kw ||
      s.displayName.toLowerCase().includes(kw) ||
      (s.lastMessage || '').toLowerCase().includes(kw) ||
      (s.inquiryId || '').toLowerCase().includes(kw);

    const isPool = (s: SessionSummary) => !s.assignedAgentId && s.status !== 'closed';

    const pool = sessions.filter((s) => isPool(s) && match(s));
    const others = sessions.filter((s) => {
      if (isPool(s)) return false;
      if (filter === 'mine' && s.assignedAgentId !== agent?.id) return false;
      if (filter === 'closed' && s.status !== 'closed') return false;
      return match(s);
    });
    return { pool, others };
  }, [sessions, filter, keyword, agent]);

  const poolTotal = sessions.filter((s) => !s.assignedAgentId && s.status !== 'closed').length;

  const renderItem = (s: SessionSummary) => {
    const active = s.sessionId === activeId;
    return (
      <div
        key={s.sessionId}
        role="listitem"
        tabIndex={0}
        aria-current={active}
        className={`sess${active ? ' active' : ''}`}
        onClick={() => onSelect(s.sessionId)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.sessionId); } }}
      >
        <div className="sess-top">
          <span className="name">
            {s.priority === 'high' && <span className="prio-dot" title="高优先级" aria-label="高优先级" />}
            {s.displayName}
          </span>
        </div>
        <div className="last">{s.lastMessage || '（暂无消息）'}</div>
      </div>
    );
  };

  return (
    <aside className={`queue${open ? ' open' : ''}`} aria-label="会话列表">
      <div className="queue-head">
        会话列表 <span className="count-badge" aria-label={`共 ${sessions.length} 个会话`}>共 {sessions.length} 个</span>
      </div>
      <div className="queue-tools">
        <input
          className="queue-search"
          placeholder="搜索访客 / 消息 / 编号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="queue-scroll">
        {/* 接待大厅：手风琴分区，待抢单 */}
        <div className="queue-section queue-pool" role="group" aria-label="接待大厅">
          <button
            className="section-head"
            aria-expanded={poolOpen}
            onClick={() => setPoolOpen((v) => !v)}
          >
            <span className="section-title">
              <span className={`section-caret${poolOpen ? ' open' : ''}`} aria-hidden="true">▸</span>
              接待大厅
            </span>
            <span className="section-count pool">{poolTotal} 待抢单</span>
          </button>
          {poolOpen && (
            <div role="list">
              {pool.map(renderItem)}
              {!pool.length && (
                <div className="section-empty">{poolTotal ? '没有匹配的客户' : '接待大厅暂无待接待客户'}</div>
              )}
            </div>
          )}
        </div>

        {/* 会话列表：手风琴分区，已被认领 / 已关闭 */}
        <div className="queue-section" role="group" aria-label="会话列表">
          <button
            className="section-head"
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
          >
            <span className="section-title">
              <span className={`section-caret${listOpen ? ' open' : ''}`} aria-hidden="true">▸</span>
              会话列表
            </span>
            <span className="section-count">{others.length}</span>
          </button>
          {listOpen && (
            <>
              <div className="queue-filters" role="tablist">
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
              <div role="list">
                {others.map(renderItem)}
                {!others.length && <div className="section-empty">没有匹配的会话</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
