const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3001';
const runId = `smoke-${Date.now()}`;
const inquirySessionId = `${runId}-inquiry`;
const faqMissSessionId = `${runId}-faq-miss`;
const ticketSessionId = `${runId}-ticket`;
let ticketId = null;

const cases = [
  {
    name: 'health',
    run: () => get('/api/health'),
    assert: (data) => data.ok === true
      && typeof data.aiFeatureEnabled === 'boolean'
      && typeof data.aiConfigured === 'boolean'
      && typeof data.aiEnabled === 'boolean'
      && data.faqCount > 0,
  },
  {
    name: 'project inquiry lookup',
    run: () => post('/api/chat', {
      sessionId: inquirySessionId,
      message: '帮我查一下项目 P1001',
      visitor: { code: `${runId}-1` },
    }),
    assert: (data) => data.intent === 'inquiry_status'
      && data.inquiry?.id === 'P1001'
      && data.needHuman === false
      && data.session?.status === 'bot'
      && data.messages?.at(-2)?.actor === 'customer'
      && data.messages?.at(-1)?.actor === 'ai'
      && Boolean(data.messages?.at(-1)?.content),
  },
  {
    name: 'complaint does not implicitly handoff',
    run: () => post('/api/chat', {
      sessionId: faqMissSessionId,
      message: '这个体验太差了，我要投诉',
      visitor: { code: `${runId}-complaint` },
    }),
    assert: (data) => data.needHuman === false
      && data.ticket === null
      && data.session?.status === 'bot',
  },
  {
    name: 'handoff ticket',
    run: () => post('/api/chat', {
      sessionId: ticketSessionId,
      message: '我想联系开发者本人',
      visitor: { code: `${runId}-2` },
    }),
    assert: (data) => {
      ticketId = data.ticket?.id || null;
      return data.needHuman === true && Boolean(ticketId);
    },
  },
  {
    name: 'session queue',
    run: () => get('/api/sessions'),
    assert: (data) => data.sessions?.some((session) => session.sessionId === ticketSessionId),
  },
  {
    name: 'session profile',
    run: () => post(`/api/sessions/${ticketSessionId}/profile`, { name: '测试用户', contact: '13800000000' }),
    assert: (data) => data.session?.displayName === '测试用户' && data.session?.profile?.contact === '13800000000',
  },
  {
    name: 'agent reply',
    run: () => post(`/api/sessions/${ticketSessionId}/messages`, {
      content: '您好，我是开发者本人，已经接入当前会话。',
      agent: { id: `${runId}-agent-1`, name: '开发者本人' },
    }),
    assert: (data) => data.session?.status === 'assigned'
      && data.session?.workflow?.ticket?.status === 'processing'
      && data.session?.assignedAgentId === `${runId}-agent-1`
      && data.messages?.at(-1)?.actor === 'agent'
      && Boolean(data.messages?.at(-1)?.id),
  },
  {
    name: 'reject competing agent',
    run: () => post(`/api/sessions/${ticketSessionId}/messages`, {
      content: '另一个协作者不应该覆盖接入。',
      agent: { id: `${runId}-agent-2`, name: '其他协作者' },
    }),
    assert: (data) => data.error === 'session is assigned to another agent'
      && data.assignedAgentId === `${runId}-agent-1`,
  },
  {
    name: 'operations metrics',
    run: () => get('/api/metrics'),
    assert: (data) => data.totals?.sessions >= 2
      && data.queue?.assigned >= 1
      && data.workload?.activeTickets >= 1
      && Number.isInteger(data.ai?.automationRate),
  },
  {
    name: 'pause assistant after developer assigned',
    run: () => post('/api/chat', {
      sessionId: ticketSessionId,
      message: '开发者接入后这条不需要 AI 自动回复',
      visitor: { code: `${runId}-2` },
    }),
    assert: (data) => data.handledByAgent === true
      && data.reply === ''
      && data.ticket?.id === ticketId
      && data.ticket?.status === 'processing'
      && data.messages?.at(-1)?.actor === 'customer',
  },
  {
    name: 'resolve session',
    run: () => post(`/api/sessions/${ticketSessionId}/resolve`, { resolution: '冒烟测试标记解决' }),
    assert: (data) => data.session?.status === 'closed'
      && data.session?.needHuman === false
      && data.tickets?.every((ticket) => ticket.status === 'resolved'),
  },
  {
    name: 'resolved ticket lifecycle',
    run: () => get('/api/tickets'),
    assert: (data) => data.tickets?.some((ticket) => ticket.sessionId === ticketSessionId && ticket.status === 'resolved'),
  },
  {
    name: 'reopen after resolved',
    run: () => post('/api/chat', {
      sessionId: ticketSessionId,
      message: '再帮我查一下项目 P1001',
      visitor: { code: `${runId}-2` },
    }),
    assert: (data) => data.handledByAgent !== true
      && data.intent === 'inquiry_status'
      && data.inquiry?.id === 'P1001'
      && data.needHuman === false,
  },
  {
    name: 'reopened session returns to bot queue',
    run: () => get(`/api/sessions/${ticketSessionId}`),
    assert: (data) => data.session?.status === 'bot'
      && data.session?.priority === 'normal'
      && data.session?.ticketId === ticketId,
  },
];

for (const testCase of cases) {
  const data = await testCase.run();

  if (!testCase.assert(data)) {
    console.error(`FAIL ${testCase.name}`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`PASS ${testCase.name}`);
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return response.json();
}
