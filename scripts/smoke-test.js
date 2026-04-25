const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3001';
const runId = `smoke-${Date.now()}`;
const orderSessionId = `${runId}-order`;
const ticketSessionId = `${runId}-ticket`;

const cases = [
  {
    name: 'health',
    run: () => get('/api/health'),
    assert: (data) => data.ok === true && data.faqCount > 0,
  },
  {
    name: 'order lookup',
    run: () => post('/api/chat', {
      sessionId: orderSessionId,
      message: '帮我查一下订单 A1001',
      visitor: { code: `${runId}-1` },
    }),
    assert: (data) => data.intent === 'order_status' && data.order?.id === 'A1001' && data.needHuman === false,
  },
  {
    name: 'handoff ticket',
    run: () => post('/api/chat', {
      sessionId: ticketSessionId,
      message: '我要投诉，找人工客服',
      visitor: { code: `${runId}-2` },
    }),
    assert: (data) => data.needHuman === true && Boolean(data.ticket?.id),
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
    run: () => post(`/api/sessions/${ticketSessionId}/messages`, { content: '您好，人工客服已接入，请提供订单号。' }),
    assert: (data) => data.session?.status === 'assigned' && data.messages?.at(-1)?.actor === 'agent',
  },
  {
    name: 'pause ai after agent assigned',
    run: () => post('/api/chat', {
      sessionId: ticketSessionId,
      message: '人工接入后这条不需要 AI 自动回复',
      visitor: { code: `${runId}-2` },
    }),
    assert: (data) => data.handledByAgent === true && data.reply === '',
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
