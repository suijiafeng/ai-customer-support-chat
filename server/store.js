// 持久化存储层（写穿透）。
//
// 设计：运行时仍以内存中的 Map/数组为准（同步、驱动 SSE 与指标），
// Postgres 仅作为「持久后备」——启动时载入内存，之后每次变更写穿透到库里。
// 这样既解决了 Render 重启/休眠丢数据的问题，又不必把上千行同步逻辑改成异步。
//
// 未配置 DATABASE_URL 时，store.enabled === false，所有方法都是 no-op，
// 行为与之前的纯内存版本完全一致（适合本地演示与单测）。

import pg from 'pg';

const { Pool } = pg;

function shouldUseSsl(connectionString) {
  if (!connectionString) return false;
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return false;
  if (/\bsslmode=disable\b/.test(connectionString)) return false;
  return true;
}

export function createStore({
  connectionString = process.env.DATABASE_URL,
  pool: injectedPool, // 测试时可注入 pg-mem 的 pool
} = {}) {
  const enabled = Boolean(connectionString || injectedPool);

  if (!enabled) {
    return createNoopStore();
  }

  const pool =
    injectedPool ||
    new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
      max: 4,
    });

  // 写穿透失败不应让请求崩溃：统一兜底记录日志。
  function fireAndForget(promise, label) {
    return Promise.resolve(promise).catch((error) => {
      console.warn(`[store] ${label} 持久化失败：${error?.message || error}`);
    });
  }

  return {
    enabled: true,

    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          session_id TEXT PRIMARY KEY,
          messages JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tickets (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    },

    // 启动时一次性载入内存。tickets 按 updated_at 升序，保持与内存数组的插入顺序近似。
    async loadAll() {
      const [sessionsRes, conversationsRes, ticketsRes] = await Promise.all([
        pool.query('SELECT session_id, data FROM sessions'),
        pool.query('SELECT session_id, messages FROM conversations'),
        pool.query('SELECT data FROM tickets ORDER BY updated_at ASC'),
      ]);

      return {
        sessions: sessionsRes.rows.map((row) => [row.session_id, row.data]),
        conversations: conversationsRes.rows.map((row) => [row.session_id, row.messages]),
        tickets: ticketsRes.rows.map((row) => row.data),
      };
    },

    saveSession(session) {
      if (!session?.sessionId) return Promise.resolve();
      return fireAndForget(
        pool.query(
          `INSERT INTO sessions (session_id, data, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (session_id)
           DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [session.sessionId, JSON.stringify(session)]
        ),
        `session ${session.sessionId}`
      );
    },

    deleteSession(sessionId) {
      if (!sessionId) return Promise.resolve();
      return fireAndForget(
        pool.query('DELETE FROM sessions WHERE session_id = $1', [sessionId]),
        `delete session ${sessionId}`
      );
    },

    saveConversation(sessionId, messages) {
      if (!sessionId) return Promise.resolve();
      return fireAndForget(
        pool.query(
          `INSERT INTO conversations (session_id, messages, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (session_id)
           DO UPDATE SET messages = EXCLUDED.messages, updated_at = now()`,
          [sessionId, JSON.stringify(messages)]
        ),
        `conversation ${sessionId}`
      );
    },

    deleteConversation(sessionId) {
      if (!sessionId) return Promise.resolve();
      return fireAndForget(
        pool.query('DELETE FROM conversations WHERE session_id = $1', [sessionId]),
        `delete conversation ${sessionId}`
      );
    },

    saveTicket(ticket) {
      if (!ticket?.id) return Promise.resolve();
      return fireAndForget(
        pool.query(
          `INSERT INTO tickets (id, data, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (id)
           DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [ticket.id, JSON.stringify(ticket)]
        ),
        `ticket ${ticket.id}`
      );
    },

    deleteTicket(ticketId) {
      if (!ticketId) return Promise.resolve();
      return fireAndForget(
        pool.query('DELETE FROM tickets WHERE id = $1', [ticketId]),
        `delete ticket ${ticketId}`
      );
    },

    async close() {
      if (!injectedPool) {
        await pool.end();
      }
    },
  };
}

function createNoopStore() {
  const noop = () => Promise.resolve();
  return {
    enabled: false,
    init: noop,
    loadAll: async () => ({ sessions: [], conversations: [], tickets: [] }),
    saveSession: noop,
    deleteSession: noop,
    saveConversation: noop,
    deleteConversation: noop,
    saveTicket: noop,
    deleteTicket: noop,
    close: noop,
  };
}
