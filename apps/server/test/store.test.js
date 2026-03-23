import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { createStore } from '../dist/store/store.js';
import { resetAlertCooldownForTest } from '../dist/store/alert.js';

// 用 pg-mem 模拟 Postgres，无需真实数据库即可验证存储层。
function freshStore() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return createStore({ pool: new Pool() });
}

test('未配置 DATABASE_URL 时回退为 no-op 存储', async () => {
  const store = createStore({ connectionString: null });
  assert.equal(store.enabled, false);
  const data = await store.loadAll();
  assert.deepEqual(data, { sessions: [], conversations: [], tickets: [] });
  // no-op 方法不应抛错
  await store.saveSession({ sessionId: 's1' });
  await store.saveTicket({ id: 't1' });
});

test('init 建表后可写入并重新载入 session/conversation/ticket', async () => {
  const store = freshStore();
  assert.equal(store.enabled, true);
  await store.init();

  const session = { sessionId: 's1', displayName: '访客 A', status: 'bot', priority: 'normal' };
  const messages = [
    { id: 'm1', role: 'user', content: '你好' },
    { id: 'm2', role: 'assistant', content: '你好，有什么可以帮你' },
  ];
  const ticket = { id: 'T-ABC123', sessionId: 's1', status: 'open', priority: 'high' };

  await store.saveSession(session);
  await store.saveConversation('s1', messages);
  await store.saveTicket(ticket);

  const loaded = await store.loadAll();
  assert.deepEqual(loaded.sessions, [['s1', session]]);
  assert.deepEqual(loaded.conversations, [['s1', messages]]);
  assert.deepEqual(loaded.tickets, [ticket]);
});

test('saveSession 对同一 id 是 upsert（覆盖而非重复）', async () => {
  const store = freshStore();
  await store.init();

  await store.saveSession({ sessionId: 's1', status: 'bot' });
  await store.saveSession({ sessionId: 's1', status: 'closed' });

  const loaded = await store.loadAll();
  assert.equal(loaded.sessions.length, 1);
  assert.equal(loaded.sessions[0][1].status, 'closed');
});

test('单条回读 getSession/getConversation/getTicket（内存淘汰后从库取回）', async () => {
  const store = freshStore();
  await store.init();
  await store.saveSession({ sessionId: 's9', status: 'closed' });
  await store.saveConversation('s9', [{ id: 'm1', content: '历史' }]);
  await store.saveTicket({ id: 'T-9', sessionId: 's9', status: 'resolved' });

  assert.equal((await store.getSession('s9')).status, 'closed');
  assert.equal((await store.getConversation('s9'))[0].content, '历史');
  assert.equal((await store.getTicket('T-9')).status, 'resolved');
  assert.equal(await store.getSession('missing'), null);
});

test('每日指标快照：按天 upsert + 读取最近 N 天（升序）', async () => {
  const store = freshStore();
  await store.init();
  await store.saveDailyMetric({ date: '2026-06-18', waiting: 1, assigned: 2, activeSessions: 3 });
  await store.saveDailyMetric({ date: '2026-06-19', waiting: 4, assigned: 5, activeSessions: 6 });
  await store.saveDailyMetric({ date: '2026-06-19', waiting: 9, assigned: 9, activeSessions: 9 }); // 同日覆盖

  const trend = await store.loadDailyMetrics(14);
  assert.equal(trend.length, 2);
  assert.equal(trend[0].date, '2026-06-18');
  assert.equal(trend[1].date, '2026-06-19');
  assert.equal(trend[1].waiting, 9); // upsert 覆盖
});

test('stats 默认无写错误', async () => {
  const store = freshStore();
  await store.init();
  assert.equal(store.stats().writeErrors, 0);
  assert.equal(store.stats().lastError, null);
});

test('写入失败触发 webhook 告警，冷却期内不重复触发', async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const store = createStore({ pool });
  await store.init();
  await pool.query('DROP TABLE sessions'); // 制造后续写入必然失败

  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  resetAlertCooldownForTest();
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}`;
  try {
    await store.saveSession({ sessionId: 's1' }); // 第一次失败 → 应触发一次告警
    await store.saveSession({ sessionId: 's2' }); // 冷却期内的第二次失败 → 不应重复触发
    await new Promise((resolve) => setTimeout(resolve, 100)); // 等待 fire-and-forget 的 fetch 落地

    assert.equal(received.length, 1);
    assert.match(received[0].text, /持久化写入失败/);
    assert.equal(store.stats().writeErrors, 2); // 计数器本身不受冷却影响，仍如实累计
  } finally {
    delete process.env.ALERT_WEBHOOK_URL;
    server.close();
  }
});

test('delete 方法移除对应记录', async () => {
  const store = freshStore();
  await store.init();

  await store.saveSession({ sessionId: 's1' });
  await store.saveConversation('s1', [{ id: 'm1' }]);
  await store.saveTicket({ id: 'T-1' });

  await store.deleteSession('s1');
  await store.deleteConversation('s1');
  await store.deleteTicket('T-1');

  const loaded = await store.loadAll();
  assert.deepEqual(loaded.sessions, []);
  assert.deepEqual(loaded.conversations, []);
  assert.deepEqual(loaded.tickets, []);
});
