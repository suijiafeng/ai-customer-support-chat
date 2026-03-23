import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionTicketService } from '../dist/workflow/session-ticket.service.js';

function fakeSessions(overrides = {}) {
  return {
    get: () => null,
    getSessionPayload: (id) => ({ session: null, messages: [], sessionId: id }),
    getSessionsPayload: () => ({ sessions: [] }),
    syncFromTicket: (ticket) => ({ sessionId: ticket.sessionId, synced: true }),
    ...overrides,
  };
}

function fakeTickets(overrides = {}) {
  return {
    all: [],
    resolveForSession: () => [],
    moveOpenToProcessing: () => null,
    ...overrides,
  };
}

function fakeSse() {
  const calls = { notifySession: [], notifyQueue: [] };
  return {
    calls,
    notifySession: (id, payload) => calls.notifySession.push([id, payload]),
    notifyQueue: (payload) => calls.notifyQueue.push(payload),
  };
}

test('notify 调用 notifySession 与 notifyQueue', () => {
  const sessions = fakeSessions();
  const sse = fakeSse();
  const svc = new SessionTicketService(sessions, fakeTickets(), sse);

  svc.notify('s1');

  assert.equal(sse.calls.notifySession.length, 1);
  assert.equal(sse.calls.notifySession[0][0], 's1');
  assert.equal(sse.calls.notifyQueue.length, 1);
});

test('resolvedTicketsForSession 只返回该会话下已解决的工单', () => {
  const tickets = fakeTickets({
    all: [
      { id: 't1', sessionId: 's1', status: 'resolved' },
      { id: 't2', sessionId: 's1', status: 'open' },
      { id: 't3', sessionId: 's2', status: 'resolved' },
    ],
  });
  const svc = new SessionTicketService(fakeSessions(), tickets, fakeSse());

  const result = svc.resolvedTicketsForSession('s1');
  assert.deepEqual(result.map((t) => t.id), ['t1']);
});

test('resolveSessionTickets 委托给 tickets.resolveForSession', () => {
  let received = null;
  const tickets = fakeTickets({
    resolveForSession: (sessionId, resolution) => {
      received = [sessionId, resolution];
      return [{ id: 't1' }];
    },
  });
  const svc = new SessionTicketService(fakeSessions(), tickets, fakeSse());

  const result = svc.resolveSessionTickets('s1', '已解决');
  assert.deepEqual(received, ['s1', '已解决']);
  assert.equal(result[0].id, 't1');
});

test('advanceTicketOnFirstReply 委托给 tickets.moveOpenToProcessing', () => {
  let received = null;
  const tickets = fakeTickets({
    moveOpenToProcessing: (sessionId) => {
      received = sessionId;
      return { id: 't1', status: 'processing' };
    },
  });
  const svc = new SessionTicketService(fakeSessions(), tickets, fakeSse());

  const result = svc.advanceTicketOnFirstReply('s1');
  assert.equal(received, 's1');
  assert.equal(result.status, 'processing');
});

test('withOwner 附加会话的接待客服信息', () => {
  const sessions = fakeSessions({
    get: (sessionId) =>
      sessionId === 's1' ? { assignedAgentId: '9527', assignedAgentName: '客服9527' } : undefined,
  });
  const svc = new SessionTicketService(sessions, fakeTickets(), fakeSse());

  const result = svc.withOwner({ id: 't1', sessionId: 's1' });
  assert.equal(result.ownerAgentId, '9527');
  assert.equal(result.ownerAgentName, '客服9527');
});

test('withOwner 会话不存在或未认领时归属字段为 null', () => {
  const svc = new SessionTicketService(fakeSessions(), fakeTickets(), fakeSse());
  const result = svc.withOwner({ id: 't1', sessionId: 'missing' });
  assert.equal(result.ownerAgentId, null);
  assert.equal(result.ownerAgentName, null);
});

test('assertCanOperate 管理员可操作任意工单', () => {
  const sessions = fakeSessions({ get: () => ({ assignedAgentId: 'someone-else' }) });
  const svc = new SessionTicketService(sessions, fakeTickets(), fakeSse());
  assert.doesNotThrow(() =>
    svc.assertCanOperate({ id: 't1', sessionId: 's1' }, { id: '9527', role: 'admin' })
  );
});

test('assertCanOperate 普通客服可操作未认领工单', () => {
  const sessions = fakeSessions({ get: () => ({ assignedAgentId: null }) });
  const svc = new SessionTicketService(sessions, fakeTickets(), fakeSse());
  assert.doesNotThrow(() =>
    svc.assertCanOperate({ id: 't1', sessionId: 's1' }, { id: '9528', role: 'agent' })
  );
});

test('assertCanOperate 普通客服操作他人工单抛 ForbiddenException', () => {
  const sessions = fakeSessions({ get: () => ({ assignedAgentId: '9527' }) });
  const svc = new SessionTicketService(sessions, fakeTickets(), fakeSse());
  assert.throws(() =>
    svc.assertCanOperate({ id: 't1', sessionId: 's1' }, { id: '9528', role: 'agent' })
  );
});

test('syncTicketToSession 委托给 sessions.syncFromTicket', () => {
  const svc = new SessionTicketService(fakeSessions(), fakeTickets(), fakeSse());
  const result = svc.syncTicketToSession({ id: 't1', sessionId: 's1', status: 'resolved' });
  assert.equal(result.sessionId, 's1');
  assert.equal(result.synced, true);
});
