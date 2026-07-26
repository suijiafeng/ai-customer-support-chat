import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionsService } from '../dist/sessions/sessions.service.js';

function fakeStore() {
  return {
    whenReady: Promise.resolve(),
    getPersisted: () => ({ sessions: new Map(), conversations: new Map() }),
    saveSession: () => {},
    saveConversation: () => {},
  };
}

/** 造一个处于人工接管态的会话，assignedAt 为 minutesAgo 分钟前 */
function assignedSessions({ assignedMinutesAgo = 0, agentReplyMinutesAgo = null, noticeMinutesAgo = null } = {}) {
  const svc = new SessionsService(fakeStore());
  const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
  svc.setSession({
    sessionId: 's1',
    displayName: '访客',
    profile: null,
    visitor: null,
    status: 'assigned',
    priority: 'normal',
    lastMessage: '在吗',
    lastIntent: 'agent_conversation',
    sentiment: 'neutral',
    needHuman: false,
    reason: '',
    inquiryId: null,
    ticketId: null,
    assignedAgentId: 'a1',
    assignedAgentName: '9527',
    assignedAt: at(assignedMinutesAgo),
    workflow: null,
    createdAt: at(60),
    updatedAt: new Date().toISOString(),
  });
  const messages = [];
  if (agentReplyMinutesAgo !== null) {
    messages.push({ id: 'm1', role: 'assistant', actor: 'agent', content: '我在', createdAt: at(agentReplyMinutesAgo) });
  }
  if (noticeMinutesAgo !== null) {
    messages.push({ id: 'm2', role: 'assistant', actor: 'system', content: '已接入', createdAt: at(noticeMinutesAgo) });
  }
  svc.setConversation('s1', messages);
  return svc;
}

test('humanIdleMs 从最后一条客服消息算起', () => {
  const svc = assignedSessions({ assignedMinutesAgo: 30, agentReplyMinutesAgo: 3 });
  const idleMin = svc.humanIdleMs('s1') / 60_000;
  assert.ok(idleMin >= 3 && idleMin < 4, `期望约 3 分钟，实际 ${idleMin}`);
});

test('humanIdleMs 无客服消息时从接管时刻算起，且不受访客消息刷新 updatedAt 影响', () => {
  const svc = assignedSessions({ assignedMinutesAgo: 12 });
  const idleMin = svc.humanIdleMs('s1') / 60_000;
  assert.ok(idleMin >= 12 && idleMin < 13, `期望约 12 分钟，实际 ${idleMin}`);
});

test('humanIdleMs 对非接管态会话返回 0', () => {
  const svc = assignedSessions({ assignedMinutesAgo: 30 });
  svc.releaseToBot('s1', '测试');
  assert.equal(svc.humanIdleMs('s1'), 0);
});

test('releaseToBot 回到 bot 并清空客服归属', () => {
  const svc = assignedSessions({ assignedMinutesAgo: 30 });
  const next = svc.releaseToBot('s1', '客服 10 分钟未回复，自动交还 AI');
  assert.equal(next.status, 'bot');
  assert.equal(next.assignedAgentId, null);
  assert.equal(next.assignedAgentName, null);
  assert.equal(next.assignedAt, null);
  assert.equal(next.needHuman, false);
  assert.equal(svc.isHumanAssigned('s1'), false);
});

test('canPostSystemNotice 按冷却间隔限流', () => {
  const cooldown = 5 * 60_000;
  assert.equal(assignedSessions({ noticeMinutesAgo: 1 }).canPostSystemNotice('s1', cooldown), false);
  assert.equal(assignedSessions({ noticeMinutesAgo: 9 }).canPostSystemNotice('s1', cooldown), true);
  assert.equal(assignedSessions({}).canPostSystemNotice('s1', cooldown), true);
  assert.equal(assignedSessions({ noticeMinutesAgo: 1 }).canPostSystemNotice('s1', 0), true);
});

test('队列里的 lastMessageRole 跳过系统提示，仍标记「访客在等回复」', () => {
  const svc = assignedSessions({ assignedMinutesAgo: 2 });
  const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
  svc.setConversation('s1', [
    { id: 'm1', role: 'user', actor: 'customer', content: '在吗', createdAt: at(2) },
    { id: 'm2', role: 'assistant', actor: 'system', content: '客服已接入，请稍候', createdAt: at(1) },
  ]);
  const [summary] = svc.getSessionsPayload().sessions;
  assert.equal(summary.lastMessageRole, 'user');
});
