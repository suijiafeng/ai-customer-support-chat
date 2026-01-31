import { useEffect, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { API, requestJson } from '../api.js';

// 会话队列实时订阅：优先 SSE，断线/不支持时降级为轮询。
export function useQueueEvents() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const startPolling = () => {
      if (pollTimer) return;
      const tick = async () => {
        try {
          const data = await requestJson<{ sessions: SessionSummary[] }>('/api/sessions');
          if (!closed) setSessions(data.sessions || []);
        } catch {
          /* 保留上次数据 */
        }
      };
      tick();
      pollTimer = setInterval(tick, 5000);
    };

    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    if (typeof window.EventSource === 'undefined') {
      startPolling();
      return () => { closed = true; stopPolling(); };
    }

    es = new EventSource(`${API}/api/sessions/events`);
    es.onopen = () => { setConnected(true); stopPolling(); };
    es.addEventListener('sessions', (e) => {
      try { setSessions(JSON.parse((e as MessageEvent).data).sessions || []); } catch {}
    });
    es.onerror = () => {
      setConnected(false);
      // SSE 异常时启动轮询兜底，浏览器会自动尝试重连 SSE
      startPolling();
    };

    return () => {
      closed = true;
      es?.close();
      stopPolling();
    };
  }, []);

  return { sessions, connected };
}
