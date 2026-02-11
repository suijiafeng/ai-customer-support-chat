import React, { useCallback, useEffect, useState } from 'react';
import type { Ticket } from '@assistflow/shared';
import { fmtTime, requestJson } from '../api.js';

const STATUS_TEXT: Record<string, string> = { open: '待处理', processing: '处理中', resolved: '已解决' };
const STATUS_TAG: Record<string, string> = { open: 'warning', processing: 'primary', resolved: 'success' };

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('zh-CN')} ${fmtTime(iso)}`;
}

/** 跟进事项管理：列表 + 状态流转（待处理→处理中→已解决）+ 优先级切换。 */
export default function TicketsPanel({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'processing' | 'resolved'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
      alert('操作失败，请重试');
    }
  }, []);

  const visible = tickets.filter((t) => filter === 'all' || t.status === filter);
  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    processing: tickets.filter((t) => t.status === 'processing').length,
    resolved: tickets.filter((t) => t.status === 'resolved').length,
  };

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
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
        <button className="ghost-btn" onClick={load}>刷新</button>
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
                <th>编号</th><th>状态</th><th>优先级</th><th>事由</th><th>最近消息</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td><span className={`tag tag-${STATUS_TAG[t.status]}`}>{STATUS_TEXT[t.status]}</span></td>
                  <td>
                    <button
                      className={`prio-btn${t.priority === 'high' ? ' high' : ''}`}
                      disabled={t.status === 'resolved'}
                      title="点击切换优先级"
                      onClick={() => patch(t, { priority: t.priority === 'high' ? 'normal' : 'high' })}
                    >
                      {t.priority === 'high' ? '🔥 高' : '普通'}
                    </button>
                  </td>
                  <td className="reason">{t.reason}</td>
                  <td className="last-msg">{t.lastMessage}</td>
                  <td className="mono">{fmtDate(t.updatedAt)}</td>
                  <td className="ops">
                    {t.status === 'open' && (
                      <button className="ghost-btn" onClick={() => patch(t, { status: 'processing' })}>开始处理</button>
                    )}
                    {t.status !== 'resolved' && (
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
    </main>
  );
}
