import React, { useCallback, useEffect, useState } from 'react';
import type { Metrics } from '@assistflow/shared';
import { fmtTime, requestJson } from '../api.js';

/** 数据看板：运营指标卡片，进入时拉取，每 15 秒自动刷新。 */
export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setMetrics(await requestJson<Metrics>('/api/metrics'));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return <main className="panel-page"><div className="empty"><span className="ico" aria-hidden="true">⚠️</span>指标加载失败<button className="retry-btn" onClick={load}>重试</button></div></main>;
  }
  if (!metrics) {
    return <main className="panel-page"><div className="empty">加载中…</div></main>;
  }

  const groups = [
    {
      title: '会话',
      cards: [
        { label: '总会话', value: metrics.totals.sessions },
        { label: '消息总数', value: metrics.totals.messages },
        { label: '待跟进', value: metrics.queue.waitingHuman, accent: metrics.queue.waitingHuman > 0 },
        { label: '接待中', value: metrics.queue.assigned },
        { label: '已关闭', value: metrics.queue.closed },
        { label: '高优先级', value: metrics.queue.highPriority, accent: metrics.queue.highPriority > 0 },
      ],
    },
    {
      title: '跟进事项',
      cards: [
        { label: '待处理', value: metrics.tickets.open, accent: metrics.tickets.open > 0 },
        { label: '处理中', value: metrics.tickets.processing },
        { label: '已解决', value: metrics.tickets.resolved },
        { label: '活跃工作量', value: metrics.workload.activeTickets },
      ],
    },
    {
      title: 'AI 自动化',
      cards: [
        { label: '自动化率', value: `${metrics.ai.automationRate}%` },
        { label: '转人工率', value: `${metrics.ai.handoffRate}%` },
        { label: '活跃会话', value: metrics.workload.activeSessions },
      ],
    },
  ];

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <span className="metrics-time">更新于 {fmtTime(metrics.generatedAt)}（15 秒自动刷新）</span>
        <button className="ghost-btn" onClick={load}>刷新</button>
      </div>
      {groups.map((group) => (
        <section key={group.title} className="metric-group">
          <h3>{group.title}</h3>
          <div className="metric-cards">
            {group.cards.map((card) => (
              <div key={card.label} className={`metric-card${'accent' in card && card.accent ? ' accent' : ''}`}>
                <b>{card.value}</b>
                <span>{card.label}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
