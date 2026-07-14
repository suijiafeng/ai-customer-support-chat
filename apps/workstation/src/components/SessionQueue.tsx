import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { fmtTime, type AgentIdentity } from '../api.js';

// 列表时间：当天显示 HH:MM，非当天显示 M/D
function fmtListTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 去除 Markdown 符号，得到单行纯文本预览
function previewText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`{1,3}|~~)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 会话已结束（'resolved' 为历史数据的遗留状态值）
function isDone(status: string): boolean {
  return status === 'closed' || status === 'resolved';
}

// 等待时长：待人工会话显示"等了多久"来驱动接单
function waitingFor(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时`;
  return `${Math.floor(h / 24)}天`;
}

// 未读基线：按客服隔离持久化「每个会话已看到的消息数」
function seenStoreKey(agentId?: string): string {
  return `assistflow.seen.${agentId || 'anon'}`;
}
function loadSeen(agentId?: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(seenStoreKey(agentId)) || '{}'); } catch { return {}; }
}
function persistSeen(agentId: string | undefined, map: Record<string, number>) {
  try { localStorage.setItem(seenStoreKey(agentId), JSON.stringify(map)); } catch { }
}

interface SessionItemProps {
  s: SessionSummary;
  active: boolean;
  /** 未读消息条数，0 为已读 */
  unread: number;
  onSelect: (id: string) => void;
}

const SessionItem = memo(function SessionItem({ s, active, unread, onSelect }: SessionItemProps) {
  const handleClick = useCallback(() => onSelect(s.sessionId), [s.sessionId, onSelect]);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.sessionId); }
  }, [s.sessionId, onSelect]);
  const done = isDone(s.status);
  const waiting = !done && (s.status === 'waiting_human' || s.needHuman);

  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-current={active}
      className={`sess${active ? ' active' : ''}${done ? ' done' : ''}${unread > 0 ? ' unread' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="sess-main">
        <div className="sess-top">
          <span className="name">{s.displayName}</span>
          {!done && s.priority === 'high' && <span className="prio-tag" title="高优先级">急</span>}
          {!done && s.sentiment === 'negative' && <span className="mood-tag" title="客户情绪负面，请优先安抚">⚠</span>}
          <span className={`sess-time${waiting ? ' waiting' : ''}`}>
            {waiting ? waitingFor(s.updatedAt) : fmtListTime(s.updatedAt)}
          </span>
        </div>
        <div className="last">
          <span className="last-text">{previewText(s.lastMessage || '') || '（暂无消息）'}</span>
          {unread > 0 && (
            <span className="unread-count" title={`${unread} 条新消息`} aria-label={`${unread} 条新消息`}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
      </div>
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

// 参考主流客服平台（Zendesk/Intercom/千牛）：按"球在谁那边"分类
// 待回复=访客最后发言（我的待办）；处理中=我已回复等访客；全部=所有客服进行中；已结束=历史
type Filter = 'reply' | 'active' | 'all' | 'closed';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'reply', label: '待回复' },
  { key: 'active', label: '处理中' },
  { key: 'all', label: '全部' },
  { key: 'closed', label: '已结束' },
];

export default function SessionQueue({ sessions, activeId, onSelect, open = false, agent, ready = false }: SessionQueueProps) {
  const [filter, setFilter] = useState<Filter>('reply');
  const [keyword, setKeyword] = useState('');
  const [poolOpen, setPoolOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  // 未读标记：messageCount 超过已读基线即未读；打开会话即更新基线
  const seenRef = useRef<Record<string, number>>({});
  useEffect(() => { seenRef.current = loadSeen(agent?.id); }, [agent?.id]);
  useEffect(() => {
    const seen = seenRef.current;
    let changed = false;
    // 首次见到的会话以当前计数为基线，避免初次加载全员标未读
    for (const s of sessions) {
      if (!(s.sessionId in seen)) { seen[s.sessionId] = s.messageCount; changed = true; }
    }
    // 正在查看的会话：新消息到达也持续视为已读
    if (activeId) {
      const act = sessions.find((s) => s.sessionId === activeId);
      if (act && seen[activeId] !== act.messageCount) { seen[activeId] = act.messageCount; changed = true; }
    }
    if (changed) persistSeen(agent?.id, seen);
  }, [sessions, activeId, agent?.id]);
  const unreadCount = (s: SessionSummary) =>
    s.sessionId === activeId || isDone(s.status)
      ? 0
      : Math.max(0, s.messageCount - (seenRef.current[s.sessionId] ?? s.messageCount));
  const isUnread = (s: SessionSummary) => unreadCount(s) > 0;

  const { pool, others, poolTotal, tabUnread, unreadTotal } = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const isPool = (s: SessionSummary) => !s.assignedAgentId && s.status !== 'closed';
    const isClosed = (s: SessionSummary) => isDone(s.status);
    const isMine = (s: SessionSummary) => s.assignedAgentId === agent?.id;
    // 访客最后发言 = 客服欠一条回复（旧后端无此字段时视为已回复，降级不误报）
    const awaitingReply = (s: SessionSummary) => s.lastMessageRole === 'user';
    const match = (s: SessionSummary) =>
      !kw ||
      s.displayName.toLowerCase().includes(kw) ||
      (s.lastMessage || '').toLowerCase().includes(kw) ||
      (s.inquiryId || '').toLowerCase().includes(kw);
    const byRecent = (a: SessionSummary, b: SessionSummary) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '');
    const needsHuman = (s: SessionSummary) => s.status === 'waiting_human' || s.needHuman;

    // 接待大厅：待人工永远置顶（AI 求救不能被普通新会话淹没），其次有新消息的，再按时间
    const pool = sessions
      .filter((s) => isPool(s) && match(s))
      .sort(
        (a, b) =>
          (Number(needsHuman(b)) - Number(needsHuman(a))) ||
          (Number(isUnread(b)) - Number(isUnread(a))) ||
          byRecent(a, b)
      );
    const poolTotal = sessions.filter(isPool).length; // 不受关键字过滤，显示真实待接待数
    const others = sessions
      .filter((s) => {
        if (isPool(s)) return false;
        if (filter === 'closed') return isClosed(s) && match(s);
        if (isClosed(s)) return false;
        if (filter === 'reply') return isMine(s) && awaitingReply(s) && match(s);
        if (filter === 'active') return isMine(s) && !awaitingReply(s) && match(s);
        return match(s); // 全部：所有客服的进行中会话
      })
      // 有新消息的排最上方，其次待人工，再按时间
      .sort(
        (a, b) =>
          (Number(isUnread(b)) - Number(isUnread(a))) ||
          (Number(needsHuman(b)) - Number(needsHuman(a))) ||
          byRecent(a, b)
      );
    // 各分类是否还有未读会话：tab 上亮绿点，直到该分类内全部查看
    const tabUnread: Record<Filter, boolean> = { reply: false, active: false, all: false, closed: false };
    let unreadTotal = 0;
    for (const s of sessions) {
      const n = unreadCount(s);
      if (isPool(s) || n === 0) continue;
      unreadTotal += n;
      tabUnread.all = true;
      if (isMine(s)) {
        if (awaitingReply(s)) tabUnread.reply = true;
        else tabUnread.active = true;
      }
    }
    return { pool, others, poolTotal, tabUnread, unreadTotal };
  }, [sessions, filter, keyword, agent, activeId]);

  const renderItem = (s: SessionSummary) => (
    <SessionItem key={s.sessionId} s={s} active={s.sessionId === activeId} unread={unreadCount(s)} onSelect={onSelect} />
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
            {poolTotal > 0 && <span className="q-num" title={`${poolTotal} 位访客待接待`}>({poolTotal})</span>}
          </div>
          <div className={`q-collapse${poolOpen ? ' open' : ''}`} aria-hidden={!poolOpen}>
            <div className="q-collapse-inner">
              <div role="list" className="q-list">
                {pool.map(renderItem)}
                {!pool.length && (
                  <div className="section-empty">{ready ? '暂无待接待客户' : '连接中…'}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 会话列表 */}
        <div className="queue-section" role="group" aria-label="会话列表">
          <div
            className="q-section-head"
            role="button"
            tabIndex={0}
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setListOpen((v) => !v); } }}
          >
            <span className={`q-caret${listOpen ? ' open' : ''}`}>▸</span>
            <span className="q-section-title">会话列表</span>
            {unreadTotal > 0 && <span className="q-num" title={`${unreadTotal} 条会话有新消息`}>({unreadTotal})</span>}
          </div>
          <div className={`q-collapse${listOpen ? ' open' : ''}`} aria-hidden={!listOpen}>
            <div className="q-collapse-inner">
              <div className="q-filter-row" role="tablist" aria-label="会话筛选">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    className={filter === f.key ? 'active' : ''}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                    {tabUnread[f.key] && <span className="q-tab-dot" title="该分类有新消息" aria-label="有新消息" />}
                  </button>
                ))}
              </div>
              <div role="list" className="q-list">
                {others.map(renderItem)}
                {!others.length && (
                  <div className="section-empty">
                    {filter === 'reply' ? '没有待回复的会话，干得漂亮' : '暂无会话'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
