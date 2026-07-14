import React, { memo, useCallback, useMemo, useState } from 'react';
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

// 状态色点：红=待人工（呼吸），蓝=AI 接管，绿=人工进行中，灰=已结束
function statusDot(s: SessionSummary): { cls: string; title: string } {
  if (isDone(s.status)) return { cls: 'st-done', title: '已结束' };
  if (s.status === 'waiting_human' || s.needHuman) return { cls: 'st-wait', title: '等待人工接待' };
  if (s.status === 'bot') return { cls: 'st-bot', title: 'AI 接待中' };
  return { cls: 'st-live', title: '人工服务中' };
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
  const dot = statusDot(s);
  const done = dot.cls === 'st-done';
  const waiting = !done && (s.status === 'waiting_human' || s.needHuman);

  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-current={active}
      className={`sess${active ? ' active' : ''}${done ? ' done' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className={`sess-dot ${dot.cls}`} title={dot.title} aria-label={dot.title} />
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
  connected?: boolean;
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

export default function SessionQueue({ sessions, activeId, onSelect, open = false, agent, ready = false, connected = false }: SessionQueueProps) {
  const [filter, setFilter] = useState<Filter>('reply');
  const [keyword, setKeyword] = useState('');
  const [poolOpen, setPoolOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  const { pool, others, poolTotal, replyCount } = useMemo(() => {
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

    // 接待大厅：待人工永远置顶（AI 求救不能被普通新会话淹没），再按时间
    const pool = sessions
      .filter((s) => isPool(s) && match(s))
      .sort((a, b) => (Number(needsHuman(b)) - Number(needsHuman(a))) || byRecent(a, b));
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
      .sort((a, b) => (Number(needsHuman(b)) - Number(needsHuman(a))) || byRecent(a, b));
    // 待回复计数：不受关键字与当前筛选影响，反映真实欠账
    const replyCount = sessions.filter(
      (s) => !isPool(s) && !isClosed(s) && isMine(s) && awaitingReply(s)
    ).length;
    return { pool, others, poolTotal, replyCount };
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
        <span className={`queue-conn${connected ? ' connected' : ''}`} title={connected ? '实时推送已连接' : '轮询模式（2s）'}>
          {connected ? '●' : '○'}
        </span>
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
            {poolTotal > 0 && <span className="q-num" title={`${poolTotal} 位访客待接待`}>{poolTotal}</span>}
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
            {replyCount > 0 && <span className="q-num warn" title={`${replyCount} 条会话待回复`}>{replyCount}</span>}
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
                    {f.key === 'reply' && replyCount > 0 && <span className="q-tab-num">{replyCount}</span>}
                  </button>
                ))}
              </div>
              <div role="list" className="q-list">
                {others.map(renderItem)}
                {!others.length && (
                  <div className="section-empty">
                    {filter === 'reply' ? '没有待回复的会话，干得漂亮 🎉' : '暂无会话'}
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
