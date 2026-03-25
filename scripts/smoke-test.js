const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3001';
const runId = `smoke-${Date.now()}`;

// 客服账号（apps/server/data/agents.json，演示密码 123456）
let agentToken = null;   // 客服 9527
let agentToken2 = null;  // 客服 9528
const inquirySessionId = `${runId}-inquiry`;
const faqMissSessionId = `${runId}-faq-miss`;
const ticketSessionId = `${runId}-ticket`;
const patchTicketSessionId = `${runId}-patch-ticket`;
let ticketId = null;

const cases = [
  {
    name: 'agent login',
    run: async () => {
      const a = await post('/api/auth/login', { agentNo: '9527', password: '123456' });
      const b = await post('/api/auth/login', { agentNo: '9528', password: '123456' });
      agentToken = a.token || null;
      agentToken2 = b.token || null;
      return { a, b };
    },
    assert: ({ a, b }) => Boolean(agentToken) && Boolean(agentToken2)
      && a.agent?.name === '客服9527' && b.agent?.name === '客服9528',
  },
  {
    name: 'login rejects wrong password',
    run: () => post('/api/auth/login', { agentNo: '9527', password: 'wrong' }),
    assert: (data) => data.error === 'invalid agent number or password',
  },
  {
    name: 'queue requires auth',
    run: () => get('/api/sessions', { auth: false }),
    assert: (data) => data.error === 'agent authentication required',
  },
  {
    name: 'chat stream emits done event',
    run: async () => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: `${runId}-stream`, message: '在吗', siteKey: 'demo-site' }),
      });
      const text = await response.text();
      const block = text.split('\n\n').find((b) => b.includes('event: done'));
      const dataLine = block?.split('\n').find((l) => l.startsWith('data:'));
      return { contentType: response.headers.get('content-type'), done: dataLine ? JSON.parse(dataLine.slice(5)) : null };
    },
    assert: ({ contentType, done }) => String(contentType).includes('text/event-stream')
      && Boolean(done?.reply)
      && done?.intent === 'small_talk:greeting'
      && done?.sessionId === `${runId}-stream`,
  },
  {
    name: 'duplicate clientMessageId is idempotent',
    run: async () => {
      const payload = {
        sessionId: `${runId}-idem`,
        message: '项目怎么报价？',
        siteKey: 'demo-site',
        clientMessageId: `${runId}-msg-1`,
      };
      const first = await post('/api/chat', payload);
      const second = await post('/api/chat', payload);
      return { first, second };
    },
    assert: ({ first, second }) => first.messages?.length === 2
      && second.messages?.length === 2
      && second.reply === first.reply
      && second.messages?.[0]?.id === first.messages?.[0]?.id,
  },
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
      siteKey: 'demo-site',
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
      siteKey: 'demo-site',
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
      message: '我要转人工',
      siteKey: 'demo-site',
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
    name: 'agent reply uses token identity',
    run: () => post(`/api/sessions/${ticketSessionId}/messages`, {
      content: '您好，我是客服9527，已经接入当前会话。',
    }),
    assert: (data) => data.session?.status === 'assigned'
      && data.session?.workflow?.ticket?.status === 'processing'
      && data.session?.assignedAgentId === '9527'
      && data.messages?.at(-1)?.agentName === '客服9527'
      && data.messages?.at(-1)?.actor === 'agent'
      && Boolean(data.messages?.at(-1)?.id),
  },
  {
    name: 'reject competing agent',
    run: () => post(`/api/sessions/${ticketSessionId}/messages`, {
      content: '另一个客服不应该覆盖接入。',
    }, { token: () => agentToken2 }),
    assert: (data) => data.error === 'session is assigned to another agent'
      && data.assignedAgentId === '9527',
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
      siteKey: 'demo-site',
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
      siteKey: 'demo-site',
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
  {
    name: 'PATCH ticket transitions cascade to session (processing)',
    run: async () => {
      const handoff = await post('/api/chat', {
        sessionId: patchTicketSessionId,
        message: '我要转人工',
        siteKey: 'demo-site',
        visitor: { code: `${runId}-patch` },
      });
      return patch(`/api/tickets/${handoff.ticket.id}`, { status: 'processing' });
    },
    assert: (data) => data.ticket?.status === 'processing'
      && data.ticket?.ownerAgentId === null
      && data.session?.status === 'assigned'
      && Boolean(data.metrics),
  },
  {
    name: 'PATCH ticket transitions cascade to session (resolved)',
    run: async () => {
      const current = await get(`/api/sessions/${patchTicketSessionId}`);
      return patch(`/api/tickets/${current.session.ticketId}`, {
        status: 'resolved',
        resolution: '冒烟测试 PATCH',
      });
    },
    assert: (data) => data.ticket?.status === 'resolved'
      && data.session?.status === 'closed'
      && Boolean(data.metrics),
  },
  {
    name: 'chat with unregistered site key is rejected',
    run: () => post('/api/chat', {
      sessionId: `${runId}-badkey`,
      message: '你好',
      siteKey: `${runId}-never-registered`,
    }),
    assert: (data) => data.error === 'invalid_site_key',
  },
  {
    name: 'admin can create and use a new widget key; disabling it blocks chat',
    run: async () => {
      const created = await post('/api/widget-keys', { key: `${runId}-wk`, name: '冒烟测试站点' });
      const chatOk = await post('/api/chat', {
        sessionId: `${runId}-wk-session`,
        message: '你好',
        siteKey: `${runId}-wk`,
      });
      await patch(`/api/widget-keys/${runId}-wk`, { active: false });
      const chatAfterDisable = await post('/api/chat', {
        sessionId: `${runId}-wk-session`,
        message: '还在吗',
        siteKey: `${runId}-wk`,
      });
      return { created, chatOk, chatAfterDisable };
    },
    assert: ({ created, chatOk, chatAfterDisable }) => created.key?.key === `${runId}-wk`
      && created.key?.active === true
      && Boolean(chatOk.reply || chatOk.session)
      && chatAfterDisable.error === 'invalid_site_key',
  },
];

// 等待服务就绪后再跑用例（避免 `npm start &` 仍在构建/启动时冒烟连接失败）
await waitForReady();

for (const testCase of cases) {
  const data = await testCase.run();

  if (!testCase.assert(data)) {
    console.error(`FAIL ${testCase.name}`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`PASS ${testCase.name}`);
}

// 轮询 /api/health，直到服务就绪或超时（默认 30s）
async function waitForReady(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch {
      /* 服务尚未监听，稍后重试 */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  console.error(`服务未就绪：${baseUrl}（等待 ${timeoutMs}ms 超时）。请先启动服务再跑冒烟。`);
  process.exit(1);
}

// 客服侧请求默认带 9527 的 token；{ auth: false } 测未授权，{ token } 可换身份
function authHeaders({ auth = true, token } = {}) {
  const value = token ? token() : agentToken;
  return auth && value ? { Authorization: `Bearer ${value}` } : {};
}

async function get(path, options) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders(options) });
  return response.json();
}

async function post(path, body, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(options) },
    body: JSON.stringify(body),
  });

  return response.json();
}

async function patch(path, body, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(options) },
    body: JSON.stringify(body),
  });

  return response.json();
}
