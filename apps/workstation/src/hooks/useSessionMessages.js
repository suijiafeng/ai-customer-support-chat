import { useEffect, useRef, useState } from 'react';
import { API, requestJson, normalizeMessages } from '../api.js';

// 订阅单个会话的消息流：加载历史 + SSE 实时更新，切换会话自动重连。
export function useSessionMessages(sessionId) {
  const [messages, setMessages] = useState([]);
  const [connection, setConnection] = useState('syncing'); // syncing | synced
  const esRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      esRef.current?.close();
      return;
    }

    let cancelled = false;
    setConnection('syncing');
    setMessages([]);

    (async () => {
      try {
        const data = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (!cancelled) setMessages(normalizeMessages(data.messages));
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();

    const es = new EventSource(`${API}/api/sessions/${encodeURIComponent(sessionId)}/events`);
    esRef.current = es;
    es.onopen = () => { if (!cancelled) setConnection('synced'); };
    es.addEventListener('session', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!cancelled) setMessages(normalizeMessages(data.messages));
      } catch {}
    });
    es.onerror = () => { if (!cancelled) setConnection('syncing'); };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [sessionId]);

  return { messages, setMessages, connection };
}
