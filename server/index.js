import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const faqPath = path.join(rootDir, 'data', 'faqs.json');
const ordersPath = path.join(rootDir, 'data', 'orders.json');

const app = express();
const port = Number(process.env.PORT || 3001);
const aiProvider = process.env.AI_PROVIDER || 'openai';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o';
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI() : null;
const deepseekClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    })
  : null;

const faqs = JSON.parse(await fs.readFile(faqPath, 'utf8'));
const orders = JSON.parse(await fs.readFile(ordersPath, 'utf8'));
const indexedFaqs = faqs.map((faq) => ({
  ...faq,
  normalizedQuestion: normalize(faq.question),
  normalizedKeywords: faq.keywords.map(normalize),
}));
const conversations = new Map();
const sessions = new Map();
const tickets = [];
const sessionClients = new Map();
const queueClients = new Set();
const MAX_CONVERSATIONS = 200;
const MAX_SESSIONS = 200;
const MAX_TICKETS = 200;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiEnabled: Boolean(getActiveAiClient()),
    aiProvider,
    model: getActiveModel(),
    faqCount: faqs.length,
    orderCount: orders.length,
    ticketCount: tickets.length,
  });
});

app.get('/api/faqs', (req, res) => {
  res.json({ faqs });
});

app.get('/api/tickets', (req, res) => {
  res.json({ tickets: tickets.slice().reverse() });
});

app.get('/api/sessions', (req, res) => {
  res.json(getSessionsPayload());
});

app.get('/api/sessions/events', (req, res) => {
  setupSse(res);
  queueClients.add(res);
  sendSse(res, 'sessions', getSessionsPayload());

  req.on('close', () => {
    queueClients.delete(res);
  });
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);

  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  res.json({
    session,
    messages: conversations.get(req.params.sessionId) || [],
  });
});

app.get('/api/sessions/:sessionId/events', (req, res) => {
  const { sessionId } = req.params;

  setupSse(res);
  addSessionClient(sessionId, res);
  sendSse(res, 'session', getSessionPayload(sessionId));

  req.on('close', () => {
    removeSessionClient(sessionId, res);
  });
});

app.post('/api/sessions/:sessionId/messages', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  const content = String(req.body?.content || '').trim();

  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }

  const currentMessages = conversations.get(req.params.sessionId) || [];
  const nextMessages = [
    ...currentMessages,
    {
      role: 'assistant',
      actor: 'agent',
      content,
      createdAt: new Date().toISOString(),
    },
  ].slice(-12);
  const updatedSession = {
    ...session,
    status: 'assigned',
    lastMessage: content,
    updatedAt: new Date().toISOString(),
  };

  conversations.set(req.params.sessionId, nextMessages);
  sessions.set(req.params.sessionId, updatedSession);
  notifySession(req.params.sessionId);
  notifyQueue();

  res.json({
    session: updatedSession,
    messages: nextMessages,
  });
});

app.post('/api/sessions/:sessionId/profile', (req, res) => {
  const profile = normalizeProfile(req.body);
  const current = sessions.get(req.params.sessionId);
  const updatedSession = {
    ...(current || createEmptySession(req.params.sessionId)),
    profile,
    displayName: buildDisplayName(req.params.sessionId, sessions.size + 1, current?.orderId, profile),
    updatedAt: new Date().toISOString(),
  };

  sessions.set(req.params.sessionId, updatedSession);
  trimMap(sessions, MAX_SESSIONS);
  notifySession(req.params.sessionId);
  notifyQueue();

  res.json({ session: updatedSession });
});

app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.sessionId || 'default');
    const profile = req.body?.profile ? normalizeProfile(req.body.profile) : null;
    const visitor = normalizeVisitor(req.body?.visitor);
    const storedHistory = conversations.get(sessionId) || [];
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : storedHistory.slice(-8);

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    if (isHumanAssigned(sessionId)) {
      const nextHistory = [...storedHistory, { role: 'user', content: message }].slice(-12);
      const workflow = {
        ai: {
          provider: aiProvider,
          model: getActiveModel(),
          used: false,
          fallback: false,
          error: null,
        },
        intent: 'agent_conversation',
        sentiment: detectSentiment(message),
        needHuman: false,
        reason: '人工客服已接入，暂停 AI 自动回复',
        order: findOrder(message),
        ticket: null,
        sources: [],
      };

      conversations.set(sessionId, nextHistory);
      trimMap(conversations, MAX_CONVERSATIONS);
      upsertSession({ sessionId, message, workflow, profile, visitor, forceStatus: 'assigned' });
      notifySession(sessionId);
      notifyQueue();

      return res.json({
        sessionId,
        reply: '',
        handledByAgent: true,
        ...workflow,
      });
    }

    const matchedFaqs = searchFaqs(message);
    const order = findOrder(message);
    const intent = detectIntent(message, matchedFaqs);
    const sentiment = detectSentiment(message);
    const handoff = shouldHandoff(message, intent, matchedFaqs, sentiment, order);
    const ticket = handoff.needHuman ? createTicket({ sessionId, message, intent, reason: handoff.reason, order }) : null;
    const replyResult = await buildReply({ message, history, matchedFaqs, intent, handoff, order, ticket });
    const reply = replyResult.text;
    const nextHistory = [...storedHistory, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-12);
    const workflow = {
      ai: replyResult.ai,
      intent,
      sentiment,
      needHuman: handoff.needHuman,
      reason: handoff.reason,
      order,
      ticket,
      sources: matchedFaqs.map((faq) => ({
        id: faq.id,
        question: faq.question,
        score: Number(faq.score.toFixed(2)),
      })),
    };

    conversations.set(sessionId, nextHistory);
    trimMap(conversations, MAX_CONVERSATIONS);
    upsertSession({ sessionId, message, workflow, profile, visitor });
    notifySession(sessionId);
    notifyQueue();

    res.json({
      sessionId,
      reply,
      ...workflow,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'chat workflow failed' });
  }
});

function searchFaqs(message) {
  const normalized = normalize(message);

  return indexedFaqs
    .map((faq) => {
      const keywordScore = faq.normalizedKeywords.reduce((score, keyword) => {
        return normalized.includes(keyword) ? score + 3 : score;
      }, 0);
      const questionScore = faq.normalizedQuestion
        .split('')
        .filter((char) => normalized.includes(char)).length;
      const score = keywordScore + questionScore / 20;

      return {
        ...faq,
        score,
      };
    })
    .filter((faq) => faq.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ normalizedQuestion, normalizedKeywords, ...faq }) => faq);
}

function detectIntent(message, matchedFaqs) {
  const normalized = normalize(message);

  if (hasAny(normalized, ['人工', '真人', '投诉', '主管'])) {
    return 'human_handoff';
  }
  if (hasAny(normalized, ['退款', '退货', '取消订单', '退钱'])) {
    return 'refund';
  }
  if (hasAny(normalized, ['物流', '快递', '发货', '什么时候到'])) {
    return 'shipping';
  }
  if (extractOrderId(message)) {
    return 'order_status';
  }
  if (hasAny(normalized, ['发票', '税号', '抬头'])) {
    return 'invoice';
  }

  return matchedFaqs[0]?.intent || 'general';
}

function shouldHandoff(message, intent, matchedFaqs, sentiment, order) {
  const normalized = normalize(message);
  const highRiskTerms = ['投诉', '律师', '起诉', '曝光', '赔偿', '主管', '人工'];

  if (intent === 'human_handoff') {
    return { needHuman: true, reason: '用户明确要求人工客服' };
  }
  if (hasAny(normalized, highRiskTerms)) {
    return { needHuman: true, reason: '包含投诉、法律或升级处理关键词' };
  }
  if (intent === 'refund' && hasAny(normalized, ['大额', '全部订单', '赔偿'])) {
    return { needHuman: true, reason: '退款请求可能需要人工审核' };
  }
  if (sentiment === 'negative') {
    return { needHuman: true, reason: '用户情绪较强，建议人工接管' };
  }
  if (intent === 'order_status' && !order) {
    return { needHuman: true, reason: '用户提供的订单号未查询到' };
  }
  if (order) {
    return { needHuman: false, reason: '订单查询已命中' };
  }
  if (matchedFaqs.length === 0) {
    return { needHuman: true, reason: '知识库未命中' };
  }

  return { needHuman: false, reason: 'FAQ 可处理' };
}

async function buildReply({ message, history, matchedFaqs, intent, handoff, order, ticket }) {
  const fallback = buildFallbackReply(matchedFaqs, handoff, order, ticket);
  const fallbackResult = {
    text: fallback,
    ai: {
      provider: aiProvider,
      model: getActiveModel(),
      used: false,
      fallback: true,
      error: null,
    },
  };

  const activeClient = getActiveAiClient();

  if (!activeClient) {
    return {
      ...fallbackResult,
      ai: {
        ...fallbackResult.ai,
        provider: aiProvider,
        model: getActiveModel(),
        error: 'AI provider is not configured',
      },
    };
  }

  const knowledge = matchedFaqs
    .map((faq, index) => `${index + 1}. ${faq.question}\n${faq.answer}`)
    .join('\n\n');
  const compactHistory = history
    .map((item) => `${item.role === 'user' ? '用户' : '客服'}：${item.content}`)
    .join('\n');

  const instructions = [
      '你是一个中文电商客服机器人。',
      '只根据提供的知识库和当前用户消息回答。',
      '语气简洁、礼貌、可执行。',
      '如果 needHuman 为 true，不要承诺解决结果，只说明已建议转人工，并询问订单号或联系方式。',
      '不要编造政策、价格、物流状态或订单信息。',
    ].join('\n');
  const prompt = [
      `意图：${intent}`,
      `needHuman：${handoff.needHuman}`,
      `转人工原因：${handoff.reason}`,
      `订单信息：\n${order ? JSON.stringify(order, null, 2) : '无'}`,
      `工单信息：\n${ticket ? JSON.stringify(ticket, null, 2) : '无'}`,
      `最近对话：\n${compactHistory || '无'}`,
      `知识库：\n${knowledge || '无命中'}`,
      `用户消息：${message}`,
    ].join('\n\n');

  if (aiProvider === 'deepseek') {
    try {
      const completion = await activeClient.chat.completions.create({
        model: getActiveModel(),
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: prompt },
        ],
      });

      const text = completion.choices[0]?.message?.content?.trim();
      return {
        text: text || fallback,
        ai: {
          provider: aiProvider,
          model: getActiveModel(),
          used: Boolean(text),
          fallback: !text,
          error: null,
        },
      };
    } catch (error) {
      const formattedError = formatAiError(error);
      console.warn(`DeepSeek 请求失败，降级为本地规则：${formattedError}`);
      return {
        ...fallbackResult,
        ai: {
          ...fallbackResult.ai,
          error: formattedError,
        },
      };
    }
  }

  let response;

  try {
    response = await activeClient.responses.create({
      model: getActiveModel(),
      instructions,
      input: prompt,
    });
  } catch (error) {
    const formattedError = formatAiError(error);
    console.warn(`OpenAI request failed, using local fallback: ${formattedError}`);
    return {
      ...fallbackResult,
      ai: {
        ...fallbackResult.ai,
        error: formattedError,
      },
    };
  }

  const text = response.output_text?.trim();
  return {
    text: text || fallback,
    ai: {
      provider: aiProvider,
      model: getActiveModel(),
      used: Boolean(text),
      fallback: !text,
      error: null,
    },
  };
}

function formatAiError(error) {
  const status = error?.status ? `${error.status} ` : '';
  const message = error?.error?.message || error?.message || 'unknown error';

  return `${status}${message}`;
}

function getActiveAiClient() {
  if (aiProvider === 'deepseek') {
    return deepseekClient;
  }

  return openaiClient;
}

function getActiveModel() {
  if (aiProvider === 'deepseek') {
    return deepseekModel;
  }

  return openaiModel;
}

function buildFallbackReply(matchedFaqs, handoff, order, ticket) {
  if (handoff.needHuman) {
    const ticketText = ticket ? `已生成工单 ${ticket.id}。` : '';
    const orderText = order ? `我也查到了订单 ${order.id}，当前状态是：${order.statusText}。` : '';
    return `这个问题建议转人工处理。${handoff.reason}。${orderText}${ticketText}请提供联系方式，人工客服会继续跟进。`;
  }

  if (order) {
    const tracking = order.trackingNo ? `物流单号：${order.trackingNo}，承运商：${order.carrier}。` : '';
    return `查到订单 ${order.id} 当前状态是：${order.statusText}。${tracking}预计时间：${order.eta}。`;
  }

  return matchedFaqs[0]?.answer || '我暂时没有找到对应答案。请补充订单号或更具体的问题，我会继续帮你处理。';
}

function findOrder(message) {
  const orderId = extractOrderId(message);

  if (!orderId) {
    return null;
  }

  return orders.find((order) => normalize(order.id) === normalize(orderId)) || null;
}

function extractOrderId(message) {
  const match = String(message).match(/\b[A-Z]\d{4,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function detectSentiment(message) {
  const normalized = normalize(message);
  const negativeTerms = ['生气', '太差', '垃圾', '骗人', '恶心', '失望', '投诉', '离谱'];
  const positiveTerms = ['谢谢', '感谢', '很好', '满意'];

  if (hasAny(normalized, negativeTerms)) {
    return 'negative';
  }
  if (hasAny(normalized, positiveTerms)) {
    return 'positive';
  }

  return 'neutral';
}

function createTicket({ sessionId, message, intent, reason, order }) {
  const orderId = order?.id || extractOrderId(message) || null;
  const existingTicket = tickets.find((ticket) => {
    return ticket.status === 'open' && ticket.sessionId === sessionId && ticket.intent === intent && ticket.orderId === orderId;
  });

  if (existingTicket) {
    existingTicket.lastMessage = message;
    existingTicket.reason = reason;
    existingTicket.updatedAt = new Date().toISOString();
    return existingTicket;
  }

  const priority = reason.includes('投诉') || reason.includes('情绪') || hasAny(normalize(message), ['投诉', '律师', '起诉'])
    ? 'high'
    : 'normal';
  const ticket = {
    id: `T${Date.now().toString().slice(-8)}`,
    sessionId,
    status: 'open',
    priority,
    intent,
    reason,
    orderId,
    lastMessage: message,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  tickets.push(ticket);
  if (tickets.length > MAX_TICKETS) {
    tickets.splice(0, tickets.length - MAX_TICKETS);
  }
  return ticket;
}

function getSessionsPayload() {
  return {
    sessions: [...sessions.values()]
      .sort(sortSessions)
      .map((session) => ({
        ...session,
        messageCount: conversations.get(session.sessionId)?.length || 0,
      })),
  };
}

function getSessionPayload(sessionId) {
  return {
    session: sessions.get(sessionId) || null,
    messages: conversations.get(sessionId) || [],
  };
}

function setupSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addSessionClient(sessionId, res) {
  const clients = sessionClients.get(sessionId) || new Set();
  clients.add(res);
  sessionClients.set(sessionId, clients);
}

function removeSessionClient(sessionId, res) {
  const clients = sessionClients.get(sessionId);

  if (!clients) {
    return;
  }

  clients.delete(res);
  if (clients.size === 0) {
    sessionClients.delete(sessionId);
  }
}

function notifySession(sessionId) {
  const clients = sessionClients.get(sessionId);

  if (!clients) {
    return;
  }

  const payload = getSessionPayload(sessionId);
  clients.forEach((client) => sendSse(client, 'session', payload));
}

function notifyQueue() {
  const payload = getSessionsPayload();
  queueClients.forEach((client) => sendSse(client, 'sessions', payload));
}

function isHumanAssigned(sessionId) {
  const session = sessions.get(sessionId);
  const messages = conversations.get(sessionId) || [];

  return session?.status === 'assigned' || messages.some((message) => message.actor === 'agent');
}

function upsertSession({ sessionId, message, workflow, profile, visitor, forceStatus }) {
  const now = new Date().toISOString();
  const current = sessions.get(sessionId);
  const nextProfile = profile || current?.profile || null;
  const nextVisitor = visitor || current?.visitor || inferVisitorFromSessionId(sessionId);
  const status = forceStatus || resolveSessionStatus(current, workflow);
  const priority = workflow.sentiment === 'negative' || workflow.needHuman ? 'high' : 'normal';
  const orderId = workflow.order?.id || current?.orderId || extractOrderId(message) || null;
  const displayName = buildDisplayName(sessionId, sessions.size + 1, orderId, nextProfile, nextVisitor);
  const session = {
    sessionId,
    displayName,
    profile: nextProfile,
    visitor: nextVisitor,
    status,
    priority,
    lastMessage: message,
    lastIntent: workflow.intent,
    sentiment: workflow.sentiment,
    needHuman: workflow.needHuman,
    reason: workflow.reason,
    orderId,
    ticketId: workflow.ticket?.id || current?.ticketId || null,
    workflow,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };

  sessions.set(sessionId, session);
  trimMap(sessions, MAX_SESSIONS);
}

function resolveSessionStatus(current, workflow) {
  if (current?.status === 'assigned') {
    return 'assigned';
  }
  if (workflow.needHuman) {
    return 'waiting_human';
  }

  return current?.status || 'bot';
}

function createEmptySession(sessionId) {
  const now = new Date().toISOString();
  return {
    sessionId,
    displayName: buildDisplayName(sessionId, sessions.size + 1, null, null, inferVisitorFromSessionId(sessionId)),
    profile: null,
    visitor: inferVisitorFromSessionId(sessionId),
    status: 'bot',
    priority: 'normal',
    lastMessage: '',
    lastIntent: 'general',
    sentiment: 'neutral',
    needHuman: false,
    reason: '',
    orderId: null,
    ticketId: null,
    workflow: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildDisplayName(sessionId, index, orderId, profile, visitor) {
  if (profile?.name) {
    return profile.name;
  }
  if (visitor?.code) {
    return `访客 ${visitor.code}`;
  }
  if (orderId) {
    return `订单 ${orderId}`;
  }

  const suffix = sessionId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || String(index).padStart(2, '0');
  return `访客 ${suffix}`;
}

function normalizeProfile(value = {}) {
  return {
    name: String(value.name || '').trim().slice(0, 24),
    contact: String(value.contact || '').trim().slice(0, 40),
  };
}

function normalizeVisitor(value = {}) {
  const code = String(value.code || '').trim().slice(0, 20);

  if (!code) {
    return null;
  }

  return {
    code,
    createdAt: value.createdAt || null,
  };
}

function inferVisitorFromSessionId(sessionId) {
  const match = String(sessionId).match(/customer-([a-z0-9]+)/i);

  if (!match) {
    return null;
  }

  return {
    code: match[1].toUpperCase(),
    createdAt: null,
  };
}

function sortSessions(a, b) {
  const priorityRank = { high: 0, normal: 1 };
  const statusRank = { waiting_human: 0, bot: 1, assigned: 2, closed: 3 };
  const rankA = priorityRank[a.priority] ?? 1;
  const rankB = priorityRank[b.priority] ?? 1;

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const statusA = statusRank[a.status] ?? 9;
  const statusB = statusRank[b.status] ?? 9;

  if (statusA !== statusB) {
    return statusA - statusB;
  }

  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function trimMap(map, maxEntries) {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

function normalize(value) {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

function hasAny(value, terms) {
  return terms.some((term) => value.includes(normalize(term)));
}

app.listen(port, () => {
  console.log(`Customer support bot running at http://localhost:${port}`);
  console.log(
    `AI mode: ${getActiveAiClient() ? `${aiProvider} ${getActiveModel()}` : 'local rules only'}`
  );
});
