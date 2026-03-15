import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyMetricPoint, Metrics } from '@assistflow/shared';
import * as echarts from 'echarts';
import { fmtTime, requestJson } from '../api.js';

const MAX_DAYS = 14;
const CHART_H = 240; // 三张图统一高度

/** 数据看板：ECharts 可视化（柱状图 / 饼图 / 折线图），进入时拉取，每 15 秒自动刷新。 */
export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  // 每日趋势改由后端按天落库、聚合返回（团队级、跨端一致）
  const [history, setHistory] = useState<DailyMetricPoint[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([
        requestJson<Metrics>('/api/metrics'),
        requestJson<{ trend: DailyMetricPoint[] }>('/api/metrics/trend'),
      ]);
      setMetrics(m);
      setHistory(t.trend || []);
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

  const barOption = useMemo<echarts.EChartsOption | null>(() => {
    if (!metrics) return null;
    const rows = [
      { label: '待跟进会话', value: metrics.queue.waitingHuman, color: '#f59e0b' },
      { label: '接待中会话', value: metrics.queue.assigned, color: '#2563eb' },
      { label: '待处理工单', value: metrics.tickets.open, color: '#ef4444' },
      { label: '处理中工单', value: metrics.tickets.processing, color: '#6366f1' },
    ];
    return {
      grid: { left: 92, right: 24, top: 12, bottom: 28 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#eef2f7' } } },
      yAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { color: '#475569' }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
      series: [{
        type: 'bar', barWidth: 16,
        data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.color, borderRadius: [0, 6, 6, 0] } })),
        label: { show: true, position: 'right', color: '#0f172a' },
      }],
    };
  }, [metrics]);

  const pieOption = useMemo<echarts.EChartsOption | null>(() => {
    if (!metrics) return null;
    const bot = Math.max(0, metrics.totals.sessions - metrics.queue.waitingHuman - metrics.queue.assigned - metrics.queue.closed);
    const data = [
      { name: 'AI 接待', value: bot, itemStyle: { color: '#10b981' } },
      { name: '待跟进', value: metrics.queue.waitingHuman, itemStyle: { color: '#f59e0b' } },
      { name: '接待中', value: metrics.queue.assigned, itemStyle: { color: '#2563eb' } },
      { name: '已关闭', value: metrics.queue.closed, itemStyle: { color: '#94a3b8' } },
    ];
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c}（{d}%）' },
      legend: { orient: 'vertical', right: 8, top: 'center', textStyle: { color: '#475569' } },
      series: [{
        type: 'pie', radius: ['55%', '80%'], center: ['38%', '50%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: true, position: 'center', formatter: `{total|${metrics.totals.sessions}}\n{sub|总会话}`,
          rich: { total: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' }, sub: { fontSize: 11, color: '#94a3b8' } } },
        emphasis: { label: { show: true } },
        data,
      }],
    };
  }, [metrics]);

  const lineOption = useMemo<echarts.EChartsOption>(() => ({
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#475569' } },
    grid: { left: 36, right: 18, top: 32, bottom: 26 },
    xAxis: { type: 'category', boundaryGap: false, data: history.map((h) => h.date.slice(5)), axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [
      { name: '待跟进', type: 'line', smooth: true, showSymbol: true, data: history.map((h) => h.waiting), itemStyle: { color: '#f59e0b' }, areaStyle: { opacity: 0.06 } },
      { name: '接待中', type: 'line', smooth: true, showSymbol: true, data: history.map((h) => h.assigned), itemStyle: { color: '#2563eb' }, areaStyle: { opacity: 0.06 } },
      { name: '活跃会话', type: 'line', smooth: true, showSymbol: true, data: history.map((h) => h.activeSessions), itemStyle: { color: '#10b981' }, areaStyle: { opacity: 0.06 } },
    ],
  }), [history]);

  if (error) {
    return <main className="panel-page"><div className="empty"><span className="ico" aria-hidden="true">⚠️</span>指标加载失败<button className="retry-btn" onClick={load}>重试</button></div></main>;
  }
  if (!metrics) {
    return <main className="panel-page"><div className="empty">加载中…</div></main>;
  }

  const pieHasData = metrics.totals.sessions > 0;
  const barHasData =
    metrics.queue.waitingHuman + metrics.queue.assigned + metrics.tickets.open + metrics.tickets.processing > 0;
  const lineHasData = history.some((h) => h.waiting + h.assigned + h.activeSessions > 0);

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <span className="metrics-time">更新于 {fmtTime(metrics.generatedAt)}（15 秒自动刷新）</span>
        <button className="ghost-btn" onClick={load}>刷新</button>
      </div>

      <div className="chart-grid">
        <section className="chart-card">
          <h3>会话状态分布（饼图）</h3>
          {pieHasData && pieOption ? <EChart option={pieOption} height={CHART_H} /> : <ChartEmpty height={CHART_H} />}
        </section>

        <section className="chart-card">
          <h3>待办负载（柱状图）</h3>
          {barHasData && barOption ? <EChart option={barOption} height={CHART_H} /> : <ChartEmpty height={CHART_H} />}
        </section>

        <section className="chart-card">
          <h3>每日趋势（折线图）</h3>
          {lineHasData ? <EChart option={lineOption} height={CHART_H} /> : <ChartEmpty height={CHART_H} text="正在采集数据…" />}
          <p className="chart-note">以天为单位，由后端按天落库并聚合，最多展示最近 {MAX_DAYS} 天（团队级、跨端一致）。</p>
        </section>
      </div>
    </main>
  );
}

/** 图表空状态占位：无数据时的默认显示。 */
function ChartEmpty({ height, text = '暂无数据' }: { height: number; text?: string }) {
  return (
    <div className="chart-empty" style={{ height }}>
      <span className="ico" aria-hidden="true">📊</span>
      <span>{text}</span>
    </div>
  );
}

/** ECharts 容器：负责 init / setOption / 自适应 resize / 销毁。 */
function EChart({ option, height }: { option: echarts.EChartsOption; height: number }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    // 容器尺寸变化即重绘：覆盖窗口缩放、栏目折叠、断点切换等所有自适应场景
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={elRef} style={{ width: '100%', height }} />;
}
