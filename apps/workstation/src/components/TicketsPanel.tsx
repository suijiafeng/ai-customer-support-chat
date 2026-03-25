import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ticket } from '@assistflow/shared';
import { fmtTime, intentText, requestJson, type AgentIdentity } from '../api.js';
import { showToast } from '../ui/feedback.js';

const STATUS_TEXT: Record<string, string> = { open: '待处理', processing: '处理中', resolved: '已解决' };
const STATUS_TAG: Record<string, string> = { open: 'warning', processing: 'primary', resolved: 'success' };

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('zh-CN')} ${fmtTime(iso)}`;
}

interface TicketsPanelProps {
  agent: AgentIdentity;
  onOpenSession: (sessionId: string) => void;
}

/** 跟进事项区块（运营中心下半部）：归属过滤 + 状态流转 + 优先级 + 详情/备注。 */
export default function TicketsPanel({ agent, onOpenSession }: TicketsPanelProps) {
  const isAdmin = agent.role === 'admin';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'processing' | 'resolved'>('all');
  const [scope, setScope] = useState<'all' | 'mine'>('all'); // 仅管理员可切换
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await requestJson<{ tickets: Ticket[] }>('/api/tickets');
      setTickets(data.tickets || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (ticket: Ticket, body: { status?: string; priority?: string }) => {
    try {
      const data = await requestJson<{ ticket: Ticket }>(`/api/tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTickets((list) => list.map((t) => (t.id === data.ticket.id ? data.ticket : t)));
    } catch {
      showToast('操作失败，请重试', 'error');
    }
  }, []);

  const addNote = useCallback(async (ticket: Ticket, text: string) => {
    const data = await requestJson<{ ticket: Ticket }>(`/api/tickets/${encodeURIComponent(ticket.id)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    setTickets((list) => list.map((t) => (t.id === data.ticket.id ? data.ticket : t)));
    return data.ticket;
  }, []);

  const scoped = useMemo(
    () => (isAdmin && scope === 'mine' ? tickets.filter((t) => t.ownerAgentId === agent.id) : tickets),
    [tickets, isAdmin, scope, agent.id]
  );
  const visible = scoped.filter((t) => filter === 'all' || t.status === filter);
  const counts = {
    all: scoped.length,
    open: scoped.filter((t) => t.status === 'open').length,
    processing: scoped.filter((t) => t.status === 'processing').length,
    resolved: scoped.filter((t) => t.status === 'resolved').length,
  };
  const detail = detailId ? tickets.find((t) => t.id === detailId) || null : null;
  // 可操作：管理员 / 本人归属 / 未认领（池中，谁都可跟进）
  const canOperate = (t: Ticket) => isAdmin || t.ownerAgentId === agent.id || t.ownerAgentId == null;

  return (
    <section className="panel-block" aria-label="跟进事项">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">跟进事项</h2>
          <div className="filter-tabs" role="tablist">
            {(['all', 'open', 'processing', 'resolved'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
              >
                {key === 'all' ? '全部' : STATUS_TEXT[key]}（{counts[key]}）
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-right">
          {isAdmin && (
            <div className="scope-toggle" role="tablist" aria-label="归属范围">
              <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部</button>
              <button role="tab" aria-selected={scope === 'mine'} className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>我的</button>
            </div>
          )}
          <button className="ghost-btn" onClick={load}>刷新</button>
        </div>
      </div>

      {error ? (
        <div className="empty"><span className="ico" aria-hidden="true">⚠️</span>加载失败<button className="retry-btn" onClick={load}>重试</button></div>
      ) : loading ? (
        <div className="empty">加载中…</div>
      ) : !visible.length ? (
        <div className="empty"><span className="ico" aria-hidden="true">🗒️</span>暂无跟进事项</div>
      ) : (
        <div className="ticket-table-wrap">
          <table className="ticket-table">
            <thead>
              <tr>
                <th>编号</th><th>状态</th><th>优先级</th><th>事由</th>
                {isAdmin && <th>负责客服</th>}
                <th>备注</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td className="mono"><button className="link-btn" onClick={() => setDetailId(t.id)}>{t.id}</button></td>
                  <td><span className={`tag tag-${STATUS_TAG[t.status]}`}>{STATUS_TEXT[t.status]}</span></td>
                  <td>
                    <button
                      className={`prio-btn${t.priority === 'high' ? ' high' : ''}`}
                      disabled={t.status === 'resolved' || !canOperate(t)}
                      title={canOperate(t) ? '点击切换优先级' : '非本人工单'}
                      onClick={() => patch(t, { priority: t.priority === 'high' ? 'normal' : 'high' })}
                    >
                      {t.priority === 'high' ? '🔥 高' : '普通'}
                    </button>
                  </td>
                  <td className="reason">{t.reason}</td>
                  {isAdmin && <td>{t.ownerAgentName || <span className="muted">未认领</span>}</td>}
                  <td>{t.notes?.length ? <span className="note-count">💬 {t.notes.length}</span> : <span className="muted">—</span>}</td>
                  <td className="mono">{fmtDate(t.updatedAt)}</td>
                  <td className="ops">
                    <button className="ghost-btn" onClick={() => setDetailId(t.id)}>详情</button>
                    {canOperate(t) && t.status === 'open' && (
                      <button className="ghost-btn" onClick={() => patch(t, { status: 'processing' })}>开始处理</button>
                    )}
                    {canOperate(t) && t.status !== 'resolved' && (
                      <button className="ghost-btn" onClick={() => patch(t, { status: 'resolved' })}>标记解决</button>
                    )}
                    <button className="ghost-btn" onClick={() => onOpenSession(t.sessionId)}>打开会话</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <TicketDetail
          ticket={detail}
          canOperate={canOperate(detail)}
          onClose={() => setDetailId(null)}
          onAddNote={addNote}
          onOpenSession={onOpenSession}
        />
      )}
    </section>
  );
}

function TicketDetail({
  ticket, canOperate, onClose, onAddNote, onOpenSession,
}: {
  ticket: Ticket;
  canOperate: boolean;
  onClose: () => void;
  onAddNote: (t: Ticket, text: string) => Promise<Ticket>;
  onOpenSession: (sessionId: string) => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await onAddNote(ticket, value);
      setText('');
    } catch {
      showToast('备注添加失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="ticket-modal" onClick={(e) => e.stopPropagation()}>
        <button className="profile-close" aria-label="关闭" onClick={onClose}>×</button>
        <div className="ticket-modal-head">
          <span className="mono">{ticket.id}</span>
          <span className={`tag tag-${STATUS_TAG[ticket.status]}`}>{STATUS_TEXT[ticket.status]}</span>
          {ticket.priority === 'high' && <span className="tag tag-warning">🔥 高优先级</span>}
        </div>
        <dl className="ticket-detail">
          <div><dt>事由</dt><dd>{ticket.reason || '—'}</dd></div>
          <div><dt>意图</dt><dd>{intentText(ticket.intent)}</dd></div>
          <div><dt>关联咨询</dt><dd className="mono">{ticket.inquiryId || '—'}</dd></div>
          <div><dt>负责客服</dt><dd>{ticket.ownerAgentName || '未认领'}</dd></div>
          <div><dt>最近消息</dt><dd>{ticket.lastMessage || '—'}</dd></div>
          <div><dt>创建时间</dt><dd className="mono">{fmtDate(ticket.createdAt)}</dd></div>
          {ticket.resolution && <div><dt>解决方案</dt><dd>{ticket.resolution}</dd></div>}
        </dl>

        <div className="ticket-notes">
          <h4>处理备注（{ticket.notes?.length || 0}）</h4>
          {ticket.notes?.length ? (
            <ul className="note-list">
              {ticket.notes.map((n) => (
                <li key={n.id}>
                  <div className="note-meta"><b>{n.agentName}</b><span className="mono">{fmtDate(n.createdAt)}</span></div>
                  <div className="note-text">{n.text}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">暂无备注</p>
          )}
          {canOperate ? (
            <div className="note-compose">
              <textarea
                rows={2}
                placeholder="添加处理备注…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="claim-like-btn" disabled={!text.trim() || saving} onClick={submit}>
                {saving ? '提交中…' : '添加备注'}
              </button>
            </div>
          ) : (
            <p className="muted">非本人工单，仅可查看</p>
          )}
        </div>

        <div className="ticket-modal-foot">
          <button className="ghost-btn" onClick={() => { onOpenSession(ticket.sessionId); onClose(); }}>打开会话</button>
        </div>
      </div>
    </div>
  );
}
