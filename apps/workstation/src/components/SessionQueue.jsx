import React from 'react';
import { statusTag, statusText } from '../api.js';

export default function SessionQueue({ sessions, activeId, onSelect, open = false }) {
  return (
    <aside className={`queue${open ? ' open' : ''}`} aria-label="会话队列">
      <div className="queue-head">
        会话队列 <span className="count-badge" aria-label={`共 ${sessions.length} 个会话`}>{sessions.length}</span>
      </div>
      <div className="queue-scroll" role="list">
        {sessions.map((s) => {
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
                <span className="name">{s.displayName}</span>
                <span className={`tag tag-${statusTag(s.status)}`}>{statusText(s.status)}</span>
              </div>
              <div className="last">{s.lastMessage || '（暂无消息）'}</div>
            </div>
          );
        })}
        {!sessions.length && (
          <div className="empty"><span className="ico" aria-hidden="true">📭</span>暂无会话</div>
        )}
      </div>
    </aside>
  );
}
