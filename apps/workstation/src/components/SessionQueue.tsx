import React, { useMemo, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { statusTag, statusText } from '../api.js';

interface SessionQueueProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  open?: boolean;
}

type Filter = 'all' | 'waiting_human' | 'assigned' | 'bot' | 'closed';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'waiting_human', label: '待跟进' },
  { key: 'assigned', label: '接待中' },
  { key: 'bot', label: 'AI 中' },
  { key: 'closed', label: '已关闭' },
];

export default function SessionQueue({ sessions, activeId, onSelect, open = false }: SessionQueueProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!kw) return true;
      return (
        s.displayName.toLowerCase().includes(kw) ||
        (s.lastMessage || '').toLowerCase().includes(kw) ||
        (s.inquiryId || '').toLowerCase().includes(kw)
      );
    });
  }, [sessions, filter, keyword]);

  const waitingCount = sessions.filter((s) => s.status === 'waiting_human').length;

  return (
    <aside className={`queue${open ? ' open' : ''}`} aria-label="会话队列">
      <div className="queue-head">
        会话队列 <span className="count-badge" aria-label={`共 ${sessions.length} 个会话`}>{sessions.length}</span>
        {waitingCount > 0 && <span className="waiting-badge">{waitingCount} 待跟进</span>}
      </div>
      <div className="queue-tools">
        <input
          className="queue-search"
          placeholder="搜索访客 / 消息 / 编号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
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
      </div>
      <div className="queue-scroll" role="list">
        {visible.map((s) => {
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
                <span className={`tag tag-${statusTag(s.status)}`}>{statusText(s.status)}</span>
              </div>
              <div className="last">{s.lastMessage || '（暂无消息）'}</div>
            </div>
          );
        })}
        {!visible.length && (
          <div className="empty">
            <span className="ico" aria-hidden="true">📭</span>
            {sessions.length ? '没有匹配的会话' : '暂无会话'}
          </div>
        )}
      </div>
    </aside>
  );
}
