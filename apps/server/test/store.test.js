import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createStore } from '../dist/store/store.js';

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

test('stats 默认无写错误', async () => {
  const store = freshStore();
  await store.init();
  assert.equal(store.stats().writeErrors, 0);
  assert.equal(store.stats().lastError, null);
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
