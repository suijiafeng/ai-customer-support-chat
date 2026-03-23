// 持久化存储层（写穿透）。
//
// 设计：运行时仍以内存中的 Map/数组为准（同步、驱动 SSE 与指标），
// 数据库仅作为「持久后备」——启动时载入内存，之后每次变更写穿透到库里。
//
// 后端选择（createStore）：
//   - 注入 pool（测试） → Postgres
//   - connectionString === null（容错降级） → 纯内存 no-op
//   - 配置了 DATABASE_URL → Postgres
//   - 默认（什么都没配） → 本地 SQLite 零配置持久化（node:sqlite，写入 DATA_DIR/assistflow.db）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import type { DailyMetricPoint, Message, Session, Ticket, WidgetKey } from '@assistflow/shared';
import { appConfig } from '../config.js';
import { notifyWriteFailure } from './alert.js';

const { Pool } = pg;

export interface PersistedData {
  sessions: Array<[string, Session]>;
  conversations: Array<[string, Message[]]>;
  tickets: Ticket[];
  widgetKeys: WidgetKey[];
}

export interface StoreStats {
  /** 写穿透失败累计次数（>0 表示持久化处于降级风险） */
  writeErrors: number;
  /** 最近一次写失败信息 */
  lastError: string | null;
}

export interface Store {
  enabled: boolean;
  init(): Promise<void>;
  loadAll(): Promise<PersistedData>;
  saveSession(session: Session): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  saveConversation(sessionId: string, messages: Message[]): Promise<void>;
  deleteConversation(sessionId: string): Promise<void>;
  saveTicket(ticket: Ticket): Promise<void>;
  deleteTicket(ticketId: string): Promise<void>;
  saveWidgetKey(key: WidgetKey): Promise<void>;
  deleteWidgetKey(key: string): Promise<void>;
  /** 单条回读（内存淘汰后仍可从库取回，DB 为读的权威源） */
  getSession(sessionId: string): Promise<Session | null>;
  getConversation(sessionId: string): Promise<Message[] | null>;
  getTicket(ticketId: string): Promise<Ticket | null>;
  /** 每日指标快照：按天 upsert + 读取最近 N 天（团队级趋势，跨端一致） */
  saveDailyMetric(point: DailyMetricPoint): Promise<void>;
  loadDailyMetrics(days: number): Promise<DailyMetricPoint[]>;
  /** 持久化健康状态 */
  stats(): StoreStats;
  close(): Promise<void>;
}

function shouldUseSsl(connectionString: string): boolean {
  if (!connectionString) return false;
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return false;
  if (/\bsslmode=disable\b/.test(connectionString)) return false;
  return true;
}

export type StoreDriver = 'sqlite' | 'postgres' | 'memory';

export interface CreateStoreOptions {
  connectionString?: string | null;
  /** 测试时可注入 pg-mem 的 pool */
  pool?: pg.Pool;
  /** 覆盖 SQLite 文件路径（默认 DATA_DIR/assistflow.db） */
  sqlitePath?: string;
  /** 显式指定后端，优先级最高（覆盖 DB_DRIVER 与自动推断） */
  driver?: StoreDriver;
}

/**
 * 驱动注册表：后端工厂集中在此，新增数据库只需在这里注册一个工厂函数 + 实现 Store 接口。
 * 例如以后接 MySQL：`mysql: (opt) => createMysqlStore(...)`。
 */
const DRIVERS: Record<StoreDriver, (opt: CreateStoreOptions) => Store> = {
  memory: () => createNoopStore(),
  postgres: (opt) => {
    const cs = String(opt.connectionString ?? process.env.DATABASE_URL ?? '');
    if (!cs.trim()) throw new Error('postgres 驱动需要 DATABASE_URL');
    const pool = new Pool({
      connectionString: cs,
      ssl: shouldUseSsl(cs) ? { rejectUnauthorized: false } : false,
      max: 4,
    });
    return createPgStore(pool, true);
  },
  sqlite: (opt) => {
    const dbPath =
      opt.sqlitePath || process.env.SQLITE_PATH || path.join(appConfig.dataDir, 'assistflow.db');
    return createSqliteStore(dbPath);
  },
};

/** 解析当前应使用的后端：显式 driver/env > 注入 pool > DATABASE_URL > 默认 SQLite。 */
function resolveDriver(opt: CreateStoreOptions): StoreDriver {
  if (opt.driver) return opt.driver;
  const env = (process.env.DB_DRIVER || '').trim().toLowerCase();
  if (env === 'sqlite' || env === 'postgres' || env === 'memory') return env;
  if (opt.pool) return 'postgres';
  if (opt.connectionString === null) return 'memory';
  if (opt.connectionString && String(opt.connectionString).trim()) return 'postgres';
  if (String(process.env.DATABASE_URL || '').trim()) return 'postgres';
  return 'sqlite';
}

export function createStore(opt: CreateStoreOptions = {}): Store {
  // 测试注入的 pool 仍走「不接管关闭」的 Postgres 分支
  if (opt.pool && !opt.driver && !process.env.DB_DRIVER) {
    return createPgStore(opt.pool, false);
  }
  const driver = resolveDriver(opt);
  return DRIVERS[driver](opt);
}

/** Postgres 后端（写穿透）。ownsPool=true 时 close 会真正结束连接池。 */
function createPgStore(pool: pg.Pool, ownsPool: boolean): Store {
  const stats: StoreStats = { writeErrors: 0, lastError: null };
  // 写穿透失败不应让请求崩溃：兜底记录并计入健康状态（不再静默）。
  function fireAndForget(promise: Promise<unknown>, label: string): Promise<void> {
    return Promise.resolve(promise)
      .then(() => undefined)
      .catch((error) => {
        stats.writeErrors += 1;
        stats.lastError = `${label}: ${error?.message || error}`;
        console.error(`[store] ${label} 持久化失败：${error?.message || error}`);
        notifyWriteFailure(label, error);
      });
  }

  return {
    enabled: true,
    stats: () => ({ ...stats }),

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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS metrics_daily (
          date TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS widget_keys (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    },

    // 启动时一次性载入内存。tickets/widget_keys 按 updated_at 升序，保持与内存数组的插入顺序近似。
    async loadAll() {
      const [sessionsRes, conversationsRes, ticketsRes, widgetKeysRes] = await Promise.all([
        pool.query('SELECT session_id, data FROM sessions'),
        pool.query('SELECT session_id, messages FROM conversations'),
        pool.query('SELECT data FROM tickets ORDER BY updated_at ASC'),
        pool.query('SELECT data FROM widget_keys ORDER BY updated_at ASC'),
      ]);

      return {
        sessions: sessionsRes.rows.map((row) => [row.session_id, row.data] as [string, Session]),
        conversations: conversationsRes.rows.map(
          (row) => [row.session_id, row.messages] as [string, Message[]]
        ),
        tickets: ticketsRes.rows.map((row) => row.data as Ticket),
        widgetKeys: widgetKeysRes.rows.map((row) => row.data as WidgetKey),
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

    saveWidgetKey(key) {
      if (!key?.key) return Promise.resolve();
      return fireAndForget(
        pool.query(
          `INSERT INTO widget_keys (key, data, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (key)
           DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [key.key, JSON.stringify(key)]
        ),
        `widget key ${key.key}`
      );
    },

    deleteWidgetKey(key) {
      if (!key) return Promise.resolve();
      return fireAndForget(
        pool.query('DELETE FROM widget_keys WHERE key = $1', [key]),
        `delete widget key ${key}`
      );
    },

    async getSession(sessionId) {
      const res = await pool.query('SELECT data FROM sessions WHERE session_id = $1', [sessionId]);
      return res.rows[0]?.data ?? null;
    },
    async getConversation(sessionId) {
      const res = await pool.query('SELECT messages FROM conversations WHERE session_id = $1', [sessionId]);
      return res.rows[0]?.messages ?? null;
    },
    async getTicket(ticketId) {
      const res = await pool.query('SELECT data FROM tickets WHERE id = $1', [ticketId]);
      return res.rows[0]?.data ?? null;
    },

    saveDailyMetric(point) {
      if (!point?.date) return Promise.resolve();
      return fireAndForget(
        pool.query(
          `INSERT INTO metrics_daily (date, data, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (date) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [point.date, JSON.stringify(point)]
        ),
        `daily metric ${point.date}`
      );
    },
    async loadDailyMetrics(days) {
      const res = await pool.query(
        'SELECT data FROM metrics_daily ORDER BY date DESC LIMIT $1',
        [days]
      );
      return res.rows.map((row) => row.data as DailyMetricPoint).reverse();
    },

    async close() {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

/** SQLite 后端（node:sqlite，同步 API）。零配置本地持久化，写入单个 .db 文件。 */
function createSqliteStore(dbPath: string): Store {
  const require = createRequire(import.meta.url);
  let DatabaseSync: any;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    throw new Error(
      'node:sqlite 不可用：请用 Node 22+ 并以 --experimental-sqlite 启动，或配置 DATABASE_URL 使用 Postgres'
    );
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');

  const stats: StoreStats = { writeErrors: 0, lastError: null };
  // SQLite 同步写入：safe 返回时数据已落盘。失败计入健康状态（不再静默）。
  function safe(label: string, fn: () => void): Promise<void> {
    try {
      fn();
    } catch (error: any) {
      stats.writeErrors += 1;
      stats.lastError = `${label}: ${error?.message || error}`;
      console.error(`[store] ${label} 持久化失败：${error?.message || error}`);
      notifyWriteFailure(label, error);
    }
    return Promise.resolve();
  }

  return {
    enabled: true,
    stats: () => ({ ...stats }),

    async init() {
      db.exec(
        `CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS conversations (session_id TEXT PRIMARY KEY, messages TEXT NOT NULL, updated_at INTEGER NOT NULL)`
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS metrics_daily (date TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS widget_keys (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`
      );
    },

    async loadAll() {
      const sessions = db
        .prepare('SELECT session_id, data FROM sessions')
        .all()
        .map((row: any) => [row.session_id, JSON.parse(row.data)] as [string, Session]);
      const conversations = db
        .prepare('SELECT session_id, messages FROM conversations')
        .all()
        .map((row: any) => [row.session_id, JSON.parse(row.messages)] as [string, Message[]]);
      const tickets = db
        .prepare('SELECT data FROM tickets ORDER BY updated_at ASC')
        .all()
        .map((row: any) => JSON.parse(row.data) as Ticket);
      const widgetKeys = db
        .prepare('SELECT data FROM widget_keys ORDER BY updated_at ASC')
        .all()
        .map((row: any) => JSON.parse(row.data) as WidgetKey);
      return { sessions, conversations, tickets, widgetKeys };
    },

    saveSession(session) {
      if (!session?.sessionId) return Promise.resolve();
      return safe(`session ${session.sessionId}`, () =>
        db
          .prepare(
            `INSERT INTO sessions (session_id, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
          )
          .run(session.sessionId, JSON.stringify(session), Date.now())
      );
    },

    deleteSession(sessionId) {
      if (!sessionId) return Promise.resolve();
      return safe(`delete session ${sessionId}`, () =>
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
      );
    },

    saveConversation(sessionId, messages) {
      if (!sessionId) return Promise.resolve();
      return safe(`conversation ${sessionId}`, () =>
        db
          .prepare(
            `INSERT INTO conversations (session_id, messages, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at`
          )
          .run(sessionId, JSON.stringify(messages), Date.now())
      );
    },

    deleteConversation(sessionId) {
      if (!sessionId) return Promise.resolve();
      return safe(`delete conversation ${sessionId}`, () =>
        db.prepare('DELETE FROM conversations WHERE session_id = ?').run(sessionId)
      );
    },

    saveTicket(ticket) {
      if (!ticket?.id) return Promise.resolve();
      return safe(`ticket ${ticket.id}`, () =>
        db
          .prepare(
            `INSERT INTO tickets (id, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
          )
          .run(ticket.id, JSON.stringify(ticket), Date.now())
      );
    },

    deleteTicket(ticketId) {
      if (!ticketId) return Promise.resolve();
      return safe(`delete ticket ${ticketId}`, () =>
        db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId)
      );
    },

    saveWidgetKey(key) {
      if (!key?.key) return Promise.resolve();
      return safe(`widget key ${key.key}`, () =>
        db
          .prepare(
            `INSERT INTO widget_keys (key, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
          )
          .run(key.key, JSON.stringify(key), Date.now())
      );
    },

    deleteWidgetKey(key) {
      if (!key) return Promise.resolve();
      return safe(`delete widget key ${key}`, () =>
        db.prepare('DELETE FROM widget_keys WHERE key = ?').run(key)
      );
    },

    async getSession(sessionId) {
      const row: any = db.prepare('SELECT data FROM sessions WHERE session_id = ?').get(sessionId);
      return row ? (JSON.parse(row.data) as Session) : null;
    },
    async getConversation(sessionId) {
      const row: any = db.prepare('SELECT messages FROM conversations WHERE session_id = ?').get(sessionId);
      return row ? (JSON.parse(row.messages) as Message[]) : null;
    },
    async getTicket(ticketId) {
      const row: any = db.prepare('SELECT data FROM tickets WHERE id = ?').get(ticketId);
      return row ? (JSON.parse(row.data) as Ticket) : null;
    },

    saveDailyMetric(point) {
      if (!point?.date) return Promise.resolve();
      return safe(`daily metric ${point.date}`, () =>
        db
          .prepare(
            `INSERT INTO metrics_daily (date, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
          )
          .run(point.date, JSON.stringify(point), Date.now())
      );
    },
    async loadDailyMetrics(days) {
      const rows: any[] = db
        .prepare('SELECT data FROM metrics_daily ORDER BY date DESC LIMIT ?')
        .all(days);
      return rows.map((r) => JSON.parse(r.data) as DailyMetricPoint).reverse();
    },

    async close() {
      db.close();
    },
  };
}

function createNoopStore(): Store {
  const noop = () => Promise.resolve();
  return {
    enabled: false,
    stats: () => ({ writeErrors: 0, lastError: null }),
    init: noop,
    loadAll: async () => ({ sessions: [], conversations: [], tickets: [], widgetKeys: [] }),
    saveSession: noop,
    deleteSession: noop,
    saveConversation: noop,
    deleteConversation: noop,
    saveTicket: noop,
    deleteTicket: noop,
    saveWidgetKey: noop,
    deleteWidgetKey: noop,
    getSession: async () => null,
    getConversation: async () => null,
    getTicket: async () => null,
    saveDailyMetric: noop,
    loadDailyMetrics: async () => [],
    close: noop,
  };
}
