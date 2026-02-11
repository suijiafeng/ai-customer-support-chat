// 模拟访客 ↔ 客服两个对话框相互发消息，校验消息排序和双方位置。
// 需要服务已在运行（npm start）。客服侧接口走 JWT（演示账号见 apps/server/data/agents.json）。
const BASE = process.env.SMOKE_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3001';
const sessionId = `dialog-test-${Date.now()}`;
const agent = { id: '9527', name: '客服9527' };
let agentToken = '';
let otherToken = '';

async function login(agentNo) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentNo, password: '123456' }),
  });
  if (!r.ok) throw new Error(`login ${agentNo} ${r.status}`);
  return (await r.json()).token;
}

const assert = (cond, msg) => {
  if (!cond) { console.error('  ✗', msg); process.exitCode = 1; }
  else console.log('  ✓', msg);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function customerSay(text) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, message: text, visitor: { id: 'v-test', name: '访客小明' } }),
  });
  if (!r.ok) throw new Error(`/api/chat ${r.status}`);
  return r.json();
}

async function agentSay(text) {
  const r = await fetch(`${BASE}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ content: text }),
  });
  if (!r.ok) throw new Error(`agent reply ${r.status}: ${await r.text()}`);
  return r.json();
}

async function fetchSession() {
  const r = await fetch(`${BASE}/api/sessions/${sessionId}`);
  if (!r.ok) throw new Error(`get session ${r.status}`);
  return r.json();
}

(async () => {
  console.log('Session:', sessionId);

  console.log('\n[Step 0] 客服登录（9527 / 9528）');
  agentToken = await login('9527');
  otherToken = await login('9528');

  console.log('\n[Step 1] 访客发起咨询');
  await customerSay('你好，我想了解前端开发服务');
  await sleep(50);

  console.log('[Step 2] 访客明确要求联系开发者本人 (触发跟进事项)');
  await customerSay('我想联系开发者本人');
  await sleep(50);

  console.log('[Step 3] 客服接入并回复');
  await agentSay('您好，我是开发者本人，已接手您的咨询');
  await sleep(50);

  console.log('[Step 4] 访客继续提问 (开发者接入后 AI 应静默)');
  const r4 = await customerSay('我想补充一下项目需求');
  assert(r4.handledByAgent === true, '开发者接入后 /api/chat 返回 handledByAgent=true');
  assert(!r4.reply, '开发者接入后 AI 不再生成回复');
  await sleep(50);

  console.log('[Step 5] 开发者再次回复');
  await agentSay('收到，我会根据需求范围整理下一步建议');
  await sleep(50);

  console.log('\n[校验] 拉取会话消息');
  const { messages, session } = await fetchSession();
  console.log(`  共 ${messages.length} 条消息`);
  messages.forEach((m, i) => {
    const side = m.actor === 'customer' ? '左(访客)' : '右(开发者/AI)';
    const who = m.actor === 'agent' ? `${m.agentName}` : m.actor;
    console.log(`   #${i + 1} [${side}] (${who}) ${m.content?.slice(0, 40) || ''}`);
  });

  // 1) 排序：createdAt 单调递增
  const times = messages.map((m) => new Date(m.createdAt).getTime());
  const sorted = times.every((t, i) => i === 0 || t >= times[i - 1]);
  assert(sorted, '消息按 createdAt 升序排列');

  // 2) 双方位置：actor 字段是否正确驱动左右气泡
  //    customer.js 里通常用 role==='user' 或 actor==='customer' 决定左侧
  const customerMsgs = messages.filter((m) => m.actor === 'customer');
  const agentMsgs = messages.filter((m) => m.actor === 'agent');
  const aiMsgs = messages.filter((m) => m.actor === 'ai');
  assert(customerMsgs.length === 3, `访客消息数为 3 (实际 ${customerMsgs.length})`);
  assert(agentMsgs.length === 2, `开发者消息数为 2 (实际 ${agentMsgs.length})`);
  assert(customerMsgs.every((m) => m.role === 'user'), '访客消息 role=user (访客端左侧)');
  assert(agentMsgs.every((m) => m.role === 'assistant'), '开发者消息 role=assistant (访客端右侧)');
  assert(agentMsgs.every((m) => m.agentId === agent.id && m.agentName === agent.name), '客服身份来自 token（9527/客服9527）');

  // 3) 交互顺序：访客1 → (AI?) → 访客2 → 开发者1 → 访客3 → 开发者2
  const sequence = messages.map((m) => m.actor);
  console.log('  实际 actor 顺序:', sequence.join(' → '));
  const idxCust1 = sequence.indexOf('customer');
  const idxAgent1 = sequence.indexOf('agent');
  const idxCust3 = sequence.lastIndexOf('customer');
  const idxAgent2 = sequence.lastIndexOf('agent');
  assert(idxCust1 < idxAgent1, '访客首条消息出现在开发者首条之前');
  assert(idxAgent1 < idxCust3, '开发者回复在访客后续提问之前');
  assert(idxCust3 < idxAgent2, '访客最后提问在开发者最后回复之前');

  // 4) 会话状态
  assert(session.status === 'assigned', `会话状态 = assigned (实际 ${session.status})`);
  assert(session.assignedAgentId === agent.id, '会话已分配给客服9527');

  // 5) 唯一 ID
  const ids = new Set(messages.map((m) => m.id));
  assert(ids.size === messages.length, '消息 ID 唯一');

  // 6) 模拟「另一个协作者」抢答 -> 应被服务端拒绝
  console.log('\n[Step 6] 另一个客服（9528）尝试覆盖回复');
  const conflict = await fetch(`${BASE}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${otherToken}` },
    body: JSON.stringify({ content: '我是另一个客服' }),
  });
  assert(conflict.status === 409, `其他客服回复被拒绝 (409) — 实际 ${conflict.status}`);

  console.log('[Step 7] 未登录请求客服接口应 401');
  const unauth = await fetch(`${BASE}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '无 token' }),
  });
  assert(unauth.status === 401, `未鉴权被拒绝 (401) — 实际 ${unauth.status}`);

  console.log('\n完成。');
})().catch((e) => { console.error(e); process.exit(1); });
