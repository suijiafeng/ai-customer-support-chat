import test from 'node:test';
import assert from 'node:assert/strict';
import { TicketsService } from '../dist/tickets/tickets.service.js';

function fakeStore(tickets = []) {
  const saved = [];
  return {
    saved,
    whenReady: Promise.resolve(),
    getPersisted: () => ({ sessions: [], conversations: [], tickets, widgetKeys: [] }),
    saveTicket: (t) => { saved.push({ ...t }); },
  };
}

async function makeService(existing = []) {
  const store = fakeStore(existing);
  const svc = new TicketsService(store);
  await svc.onModuleInit();
  return { svc, store };
}

function baseParams(overrides = {}) {
  return {
    sessionId: 's1',
    message: '想了解项目报价',
    intent: 'pricing',
    reason: '访客询问价格',
    inquiry: null,
    ...overrides,
  };
}

// ──────── create ────────

test('create 生成工单并写穿透', async () => {
  const { svc, store } = await makeService();
  const ticket = svc.create(baseParams());

  assert.match(ticket.id, /^T-[0-9A-F]{8}$/);
  assert.equal(ticket.sessionId, 's1');
  assert.equal(ticket.intent, 'pricing');
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.priority, 'normal');
  assert.ok(ticket.createdAt);
  assert.equal(store.saved.length, 1);
});

test('create 重复意图+咨询编号时复用同一工单，不新建', async () => {
  const { svc, store } = await makeService();
  const p = baseParams({ intent: 'inquiry_status', inquiry: { id: 'P1001' } });
  const t1 = svc.create(p);
  const t2 = svc.create({ ...p, message: '再问一次' });

  assert.equal(t1.id, t2.id);
  assert.equal(t2.lastMessage, '再问一次');
  assert.equal(svc.list().length, 1);
  // 初次创建 + 更新各写一次
  assert.equal(store.saved.length, 2);
});

test('create 不同 intent 各自建一个工单', async () => {
  const { svc } = await makeService();
  svc.create(baseParams({ intent: 'pricing' }));
  svc.create(baseParams({ intent: 'collaboration' }));
  assert.equal(svc.list().length, 2);
});

test('create 含紧急关键词时优先级升为 high', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams({ message: '紧急，今天必须联系我' }));
  assert.equal(ticket.priority, 'high');
});

test('create 从 message 中提取咨询编号', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams({ message: '查一下 P1001 进度', intent: 'inquiry_status', inquiry: null }));
  assert.equal(ticket.inquiryId, 'P1001');
});

test('已解决的同意图工单不复用，新建一条 open 工单', async () => {
  const { svc } = await makeService();
  const t1 = svc.create(baseParams());
  svc.update(t1, { status: 'resolved', resolution: '已处理' });

  const t2 = svc.create(baseParams());
  assert.notEqual(t1.id, t2.id);
  assert.equal(t2.status, 'open');
});

// ──────── update ────────

test('update 修改状态并写穿透', async () => {
  const { svc, store } = await makeService();
  const ticket = svc.create(baseParams());
  const updated = svc.update(ticket, { status: 'processing' });

  assert.equal(updated.status, 'processing');
  assert.ok(updated.acceptedAt); // 首次进入 processing 打时间戳
  assert.equal(store.saved.at(-1).status, 'processing');
});

test('update processing → resolved 打 resolvedAt 时间戳', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams());
  svc.update(ticket, { status: 'processing' });
  const resolved = svc.update(ticket, { status: 'resolved', resolution: '已解答' });

  assert.equal(resolved.status, 'resolved');
  assert.ok(resolved.resolvedAt);
  assert.equal(resolved.resolution, '已解答');
});

test('update resolution 截断超 120 字符的文本', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams());
  const long = 'x'.repeat(200);
  svc.update(ticket, { status: 'resolved', resolution: long });
  assert.equal(ticket.resolution.length, 120);
});

test('update 修改优先级', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams());
  svc.update(ticket, { priority: 'high' });
  assert.equal(ticket.priority, 'high');
});

// ──────── addNote ────────

test('addNote 追加备注并写穿透', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams());
  svc.addNote(ticket, { agentId: 'a1', agentName: '客服小明', text: '已致电访客' });

  assert.equal(ticket.notes.length, 1);
  assert.equal(ticket.notes[0].agentName, '客服小明');
  assert.match(ticket.notes[0].id, /^[0-9a-f-]{36}$/);
});

test('addNote 超过 50 条时保留最新 50 条', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams());
  for (let i = 0; i < 55; i++) {
    svc.addNote(ticket, { agentId: 'a1', agentName: '客服', text: `备注${i}` });
  }
  assert.equal(ticket.notes.length, 50);
  assert.equal(ticket.notes.at(-1).text, '备注54');
});

test('addNote 截断超 500 字符的文本', async () => {
  const { svc } = await makeService();
  const ticket = svc.create(baseParams());
  svc.addNote(ticket, { agentId: 'a1', agentName: '客服', text: 'x'.repeat(600) });
  assert.equal(ticket.notes[0].text.length, 500);
});

// ──────── moveOpenToProcessing ────────

test('moveOpenToProcessing 将首个 open 工单推进到 processing', async () => {
  const { svc } = await makeService();
  svc.create(baseParams());
  const result = svc.moveOpenToProcessing('s1');

  assert.equal(result?.status, 'processing');
  assert.ok(result?.acceptedAt);
});

test('moveOpenToProcessing 没有 open 工单时返回 null', async () => {
  const { svc } = await makeService();
  svc.create(baseParams());
  svc.moveOpenToProcessing('s1'); // 第一次推进
  const result = svc.moveOpenToProcessing('s1'); // 无 open 可推
  assert.equal(result, null);
});

test('moveOpenToProcessing 会话不存在时返回 null', async () => {
  const { svc } = await makeService();
  assert.equal(svc.moveOpenToProcessing('no-such-session'), null);
});

// ──────── resolveForSession ────────

test('resolveForSession 关闭该会话下所有未解决工单', async () => {
  const { svc } = await makeService();
  const t1 = svc.create(baseParams({ intent: 'pricing' }));
  const t2 = svc.create(baseParams({ intent: 'collaboration' }));
  svc.update(t1, { status: 'processing' });

  const resolved = svc.resolveForSession('s1', '统一结单');
  assert.equal(resolved.length, 2);
  assert.ok(resolved.every((t) => t.status === 'resolved'));
  assert.ok(resolved.every((t) => t.resolution === '统一结单'));
});

test('resolveForSession 跳过已解决的工单', async () => {
  const { svc } = await makeService();
  const t1 = svc.create(baseParams({ intent: 'pricing' }));
  svc.update(t1, { status: 'resolved', resolution: '已处理' });
  svc.create(baseParams({ intent: 'collaboration' }));

  const resolved = svc.resolveForSession('s1', '批量关闭');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].intent, 'collaboration');
});

// ──────── canTransition ────────

test('canTransition 遵守状态机规则', async () => {
  const { svc } = await makeService();
  assert.equal(svc.canTransition('open', 'processing'), true);
  assert.equal(svc.canTransition('open', 'resolved'), true);
  assert.equal(svc.canTransition('processing', 'resolved'), true);
  assert.equal(svc.canTransition('resolved', 'open'), false);
  assert.equal(svc.canTransition('resolved', 'processing'), false);
  assert.equal(svc.canTransition('unknown', 'open'), false);
});

// ──────── list / getLatestForSession ────────

test('list 以创建时间倒序返回工单', async () => {
  const { svc } = await makeService();
  const t1 = svc.create(baseParams({ intent: 'pricing' }));
  const t2 = svc.create(baseParams({ intent: 'collaboration' }));
  const list = svc.list();
  assert.equal(list[0].id, t2.id);
  assert.equal(list[1].id, t1.id);
});

test('getLatestForSession 返回最新更新的工单', async () => {
  const { svc } = await makeService();
  const t1 = svc.create(baseParams({ intent: 'pricing' }));
  svc.create(baseParams({ intent: 'collaboration' }));
  svc.update(t1, { priority: 'high' }); // 让 t1 成为最近更新的

  const latest = svc.getLatestForSession('s1');
  assert.equal(latest?.id, t1.id);
});

test('getLatestForSession 会话不存在时返回 null', async () => {
  const { svc } = await makeService();
  assert.equal(svc.getLatestForSession('no-such-session'), null);
});

// ──────── 初始化从 store 恢复 ────────

test('onModuleInit 从持久化存储恢复已有工单', async () => {
  const existing = [{
    id: 'T-ABCD1234',
    sessionId: 's9',
    status: 'open',
    priority: 'normal',
    intent: 'pricing',
    reason: '历史工单',
    inquiryId: null,
    lastMessage: '旧消息',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }];
  const { svc } = await makeService(existing);

  assert.equal(svc.list().length, 1);
  assert.equal(svc.findById('T-ABCD1234')?.intent, 'pricing');
  assert.equal(svc.getLatestForSession('s9')?.id, 'T-ABCD1234');
});
