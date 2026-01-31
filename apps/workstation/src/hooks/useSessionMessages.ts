import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@assistflow/shared';
import { API, requestJson, normalizeMessages, type UiMessage } from '../api.js';

export type HistoryStatus = 'loading' | 'ready' | 'error';
export type ConnectionStatus = 'syncing' | 'synced' | 'reconnecting';

// 订阅单个会话的消息流：加载历史 + SSE 实时更新，切换会话自动重连。
// status:      loading | ready | error            —— 历史加载结果，决定列表区显示骨架/内容/重试
// connection:  syncing | synced | reconnecting    —— SSE 实时通道状态
export function useSessionMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<HistoryStatus>('loading');
  const [connection, setConnection] = useState<ConnectionStatus>('syncing');
  const esRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);
  const everOpenRef = useRef(false);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    setStatus('loading');
    try {
      const data = await requestJson<{ messages: Message[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}`
      );
      if (!cancelledRef.current) {
        setMessages(normalizeMessages(data.messages));
        setStatus('ready');
      }
    } catch {
      if (!cancelledRef.current) setStatus('error');
    }
  }, [sessionId]);

  useEffect(() => {
    cancelledRef.current = false;
    everOpenRef.current = false;

    if (!sessionId) {
      setMessages([]);
      setStatus('ready');
      esRef.current?.close();
      return;
    }

    setConnection('syncing');
    setMessages([]);
    loadHistory();

    const es = new EventSource(`${API}/api/sessions/${encodeURIComponent(sessionId)}/events`);
    esRef.current = es;
    es.onopen = () => {
      if (cancelledRef.current) return;
      everOpenRef.current = true;
      setConnection('synced');
    };
    es.addEventListener('session', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (!cancelledRef.current) {
          setMessages(normalizeMessages(data.messages));
          setStatus('ready');
        }
      } catch {}
    });
    // 已经连上过再报错 = 断线重连中；从未连上 = 仍在初次连接
    es.onerror = () => {
      if (!cancelledRef.current) setConnection(everOpenRef.current ? 'reconnecting' : 'syncing');
    };

    return () => {
      cancelledRef.current = true;
      es.close();
    };
  }, [sessionId, loadHistory]);

  return { messages, setMessages, status, connection, reload: loadHistory };
}
