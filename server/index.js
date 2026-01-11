import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseBooleanEnv } from './config.js';
import { createStore } from './store.js';
import {
  createFaqSearcher,
  detectIntent,
  detectSentiment,
  extractInquiryId,
  hasAny,
  normalize,
  shouldHandoff,
} from './rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const widgetDir = path.join(rootDir, 'apps', 'widget', 'dist');
const widgetDemoDir = path.join(rootDir, 'apps', 'widget', 'demo');
const workstationDir = path.join(rootDir, 'apps', 'workstation', 'dist');
const faqPath = path.join(rootDir, 'data', 'faqs.json');
const inquiriesPath = path.join(rootDir, 'data', 'inquiries.json');

const app = express();
const port = Number(process.env.PORT || 3001);
const aiFeatureEnabled = parseBooleanEnv(process.env.AI_ENABLED, false);
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
const inquiries = JSON.parse(await fs.readFile(inquiriesPath, 'utf8'));
const inquiryIndex = new Map(inquiries.map((inquiry) => [normalize(inquiry.id), inquiry]));
const searchFaqs = createFaqSearcher(faqs);
const conversations = new Map();
const sessions = new Map();
const tickets = [];
const sessionClients = new Map();
const queueClients = new Set();
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_AI_HISTORY = 8;
const MAX_SESSIONS = 200;
const MAX_TICKETS = 200;

// 持久化：启动时从 Postgres 载入内存；之后所有变更写穿透。
// 初始化失败（库不可达等）时降级为纯内存，保证服务仍能起来。
let store = createStore();
try {
  await store.init();
  const persisted = await store.loadAll();
  for (const [id, data] of persisted.sessions) sessions.set(id, data);
  for (const [id, messages] of persisted.conversations) conversations.set(id, messages);
  for (const ticket of persisted.tickets) tickets.push(ticket);
  if (store.enabled) {
    console.log(`[store] Postgres 持久化已启用，载入 ${sessions.size} 会话 / ${tickets.length} 工单`);
  }
} catch (error) {
  console.error(`[store] 初始化失败，降级为纯内存模式：${error?.message || error}`);
  store = createStore({ connectionString: null });
}

// 写穿透封装：内存仍是运行时事实来源，库作为持久后备同步更新。
function setSession(session) {
  sessions.set(session.sessionId, session);
  store.saveSession(session);
  trimMap(sessions, MAX_SESSIONS, (id) => store.deleteSession(id));
  return session;
}

function setConversation(sessionId, messages) {
  conversations.set(sessionId, messages);
  store.saveConversation(sessionId, messages);
  trimMap(conversations, MAX_CONVERSATIONS, (id) => store.deleteConversation(id));
  return messages;
}

function persistTicket(ticket) {
  if (ticket) store.saveTicket(ticket);
  return ticket;
}

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static(publicDir));
// 嵌入式客户端 widget（供第三方网站 <script> 引用，跨域已由 cors() 放行）
// widget.js 文件名固定（无内容哈希），用 no-cache 强制浏览器每次校验，避免更新后被缓存挡住
app.use('/widget', express.static(widgetDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));
app.use('/widget-demo', express.static(widgetDemoDir));
app.get('/widget-demo', (req, res) => res.sendFile(path.join(widgetDemoDir, 'embed.html')));
app.get('/widget-demo/', (req, res) => res.sendFile(path.join(widgetDemoDir, 'embed.html')));
// React 开发者工作台构建产物（资源带哈希；index.html 用 no-cache 以便总是拉到最新哈希）
app.use('/workstation-demo', express.static(workstationDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiEnabled: Boolean(getActiveAiClient()),
    aiFeatureEnabled,
    aiConfigured: Boolean(getConfiguredAiClient()),
    aiProvider,
    model: getActiveModel(),
    faqCount: faqs.length,
    inquiryCount: inquiries.length,
    ticketCount: tickets.length,
  });
});

app.get('/api/faqs', (req, res) => {
  res.json({ faqs });
});

app.get('/api/tickets', (req, res) => {
  res.json({ tickets: tickets.slice().reverse() });
});

app.get('/api/metrics', (req, res) => {
  res.json(buildMetrics());
});

app.get('/api/sessions', (req, res) => {
  res.json(getSessionsPayload());
});

app.get('/api/sessions/events', (req, res) => {
  const heartbeat = setupSse(res);
  queueClients.add(res);
  sendSse(res, 'sessions', getSessionsPayload());

  req.on('close', () => {
    clearInterval(heartbeat);
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

  const heartbeat = setupSse(res);
  addSessionClient(sessionId, res);
  sendSse(res, 'session', getSessionPayload(sessionId));

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSessionClient(sessionId, res);
  });
});

app.post('/api/sessions/:sessionId/resolve', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  const resolution = String(req.body?.resolution || '开发者本人已标记解决').trim().slice(0, 120);

  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  if (session.status === 'closed') {
    return res.json({
      session,
      tickets: tickets.filter((ticket) => ticket.sessionId === req.params.sessionId && ticket.status === 'resolved'),
      metrics: buildMetrics(),
    });
  }

  const resolvedTickets = resolveTicketsForSession(req.params.sessionId, resolution);
  const updatedSession = {
    ...session,
    status: 'closed',
    needHuman: false,
    reason: resolution,
    workflow: session.workflow
      ? {
          ...session.workflow,
          needHuman: false,
          reason: resolution,
          ticket: resolvedTickets[0] || session.workflow.ticket || null,
        }
      : session.workflow,
    resolvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  setSession(updatedSession);
  notifySession(req.params.sessionId);
  notifyQueue();

  res.json({
    session: updatedSession,
    tickets: resolvedTickets,
    metrics: buildMetrics(),
  });
});

app.post('/api/sessions/:sessionId/messages', (req, res) => {
  const actor = req.body?.actor === 'customer' ? 'customer' : 'agent';
  const session = sessions.get(req.params.sessionId);
  const content = String(req.body?.content || '').trim();
  const agent = normalizeAgent(req.body?.agent);
  const attachments = normalizeAttachments(req.body?.attachments);

  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (!content && attachments.length === 0) {
    return res.status(400).json({ error: 'content or attachments required' });
  }
  if (actor === 'customer') {
    return res.status(400).json({ error: 'customer messages must use /api/chat' });
  }
  if (session.assignedAgentId && session.assignedAgentId !== agent.id) {
    return res.status(409).json({
      error: 'session is assigned to another agent',
      assignedAgentId: session.assignedAgentId,
      assignedAgentName: session.assignedAgentName,
    });
  }

  const currentMessages = conversations.get(req.params.sessionId) || [];
  const nextMessages = appendMessages(currentMessages, createMessage({
    role: 'assistant',
    actor: 'agent',
    content,
    agentId: agent.id,
    agentName: agent.name,
    attachments,
  }));
  const linkedTicket = moveOpenTicketToProcessing(req.params.sessionId);
  const updatedSession = {
    ...session,
    status: 'assigned',
    assignedAgentId: session.assignedAgentId || agent.id,
    assignedAgentName: session.assignedAgentName || agent.name,
    lastMessage: content,
    ticketId: linkedTicket?.id || session.ticketId,
    workflow: session.workflow
      ? {
          ...session.workflow,
          ticket: linkedTicket || session.workflow.ticket || null,
        }
      : session.workflow,
    updatedAt: new Date().toISOString(),
  };

  setConversation(req.params.sessionId, nextMessages);
  setSession(updatedSession);
  notifySession(req.params.sessionId);
  notifyQueue();

  res.json({
    session: updatedSession,
    messages: nextMessages,
  });
});

app.patch('/api/tickets/:ticketId', (req, res) => {
  const ticket = tickets.find((item) => item.id === req.params.ticketId);

  if (!ticket) {
    return res.status(404).json({ error: 'ticket not found' });
  }

  const nextStatus = req.body?.status ? String(req.body.status) : ticket.status;
  const nextPriority = req.body?.priority ? String(req.body.priority) : ticket.priority;

  if (!['open', 'processing', 'resolved'].includes(nextStatus)) {
    return res.status(400).json({ error: 'invalid ticket status' });
  }
  if (!canTransitionTicket(ticket.status, nextStatus)) {
    return res.status(409).json({
      error: 'invalid ticket transition',
      currentStatus: ticket.status,
      nextStatus,
    });
  }
  if (!['normal', 'high'].includes(nextPriority)) {
    return res.status(400).json({ error: 'invalid ticket priority' });
  }

  const updatedTicket = updateTicket(ticket, {
    status: nextStatus,
    priority: nextPriority,
    resolution: req.body?.resolution,
  });
  const session = syncSessionFromTicket(updatedTicket);

  notifyQueue();
  if (updatedTicket.sessionId) {
    notifySession(updatedTicket.sessionId);
  }

  res.json({
    ticket: updatedTicket,
    session,
    metrics: buildMetrics(),
  });
});

app.post('/api/sessions/:sessionId/profile', (req, res) => {
  const profile = normalizeProfile(req.body);
  const current = sessions.get(req.params.sessionId);
  const updatedSession = {
    ...(current || createEmptySession(req.params.sessionId)),
    profile,
    displayName: buildDisplayName(req.params.sessionId, sessions.size + 1, current?.inquiryId, profile),
    updatedAt: new Date().toISOString(),
  };

  setSession(updatedSession);
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
    const attachments = normalizeAttachments(req.body?.attachments);
    const storedHistory = conversations.get(sessionId) || [];
    const history = storedHistory.slice(-MAX_AI_HISTORY);

    // 允许「纯图片」消息：有文字或有图片即可
    if (!message && attachments.length === 0) {
      return res.status(400).json({ error: 'message or attachments required' });
    }

    if (isHumanAssigned(sessionId)) {
      const activeTicket = getLatestTicketForSession(sessionId);
      const nextHistory = appendMessages(storedHistory, createMessage({
        role: 'user',
        actor: 'customer',
        content: message,
        attachments,
      }));
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
        reason: '开发者本人已接入，暂停 AI 自动回复',
        inquiry: findInquiry(message),
        ticket: activeTicket,
        sources: [],
      };

      setConversation(sessionId, nextHistory);
      upsertSession({ sessionId, message, workflow, profile, visitor, forceStatus: 'assigned' });
      notifySession(sessionId);
      notifyQueue();

      return res.json({
        sessionId,
        reply: '',
        handledByAgent: true,
        session: sessions.get(sessionId),
        messages: nextHistory,
        ...workflow,
      });
    }

    const matchedFaqs = searchFaqs(message);
    const inquiry = findInquiry(message);
    const intent = detectIntent(message, matchedFaqs);
    const sentiment = detectSentiment(message);
    const handoff = shouldHandoff(message, intent, matchedFaqs, sentiment, inquiry, Boolean(getActiveAiClient()));
    const ticket = handoff.needHuman ? createTicket({ sessionId, message, intent, reason: handoff.reason, inquiry }) : null;
    const replyResult = await buildReply({ message, history, matchedFaqs, intent, handoff, inquiry, ticket });
    const reply = replyResult.text;
    const nextHistory = appendMessages(
      storedHistory,
      createMessage({ role: 'user', actor: 'customer', content: message, attachments }),
      createMessage({ role: 'assistant', actor: 'ai', content: reply })
    );
    const workflow = {
      ai: replyResult.ai,
      intent,
      sentiment,
      needHuman: handoff.needHuman,
      reason: handoff.reason,
      inquiry,
      ticket,
      sources: matchedFaqs.map((faq) => ({
        id: faq.id,
        question: faq.question,
        score: Number(faq.score.toFixed(2)),
      })),
    };

    setConversation(sessionId, nextHistory);
    upsertSession({ sessionId, message, workflow, profile, visitor });
    notifySession(sessionId);
    notifyQueue();

    res.json({
      sessionId,
      reply,
      session: sessions.get(sessionId),
      messages: nextHistory,
      ...workflow,
    });
  } catch (error) {
    console.error('[POST /api/chat] 处理失败:', error);
    res.status(500).json({
      error: 'chat workflow failed',
      detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
    });
  }
});

async function buildReply({ message, history, matchedFaqs, intent, handoff, inquiry, ticket }) {
  const fallback = buildFallbackReply(matchedFaqs, handoff, inquiry, ticket);
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
        error: aiFeatureEnabled ? 'AI provider is not configured' : 'AI feature is disabled',
      },
    };
  }

  const knowledge = matchedFaqs
    .map((faq, index) => `${index + 1}. ${faq.question}\n${faq.answer}`)
    .join('\n\n');
  const compactHistory = history
    .map((item) => `${item.role === 'user' ? '访客' : '助手或开发者'}：${item.content}`)
    .join('\n');

  const instructions = [
      '你是独立前端开发者个人主页上的中文 AI 助手。',
      '优先根据提供的本地 FAQ、项目或咨询信息以及最近对话回答。',
      '你可以介绍开发服务、报价方式、合作流程、技术栈、作品集、档期、招聘合作和开发者背景。',
      '知识库未命中时，可以回答与前端开发和合作咨询相关的通用问题；涉及具体报价、档期、未公开案例或承诺时必须说明需要开发者本人确认。',
      '语气简洁、礼貌、可执行。',
      '只有访客明确要求联系开发者本人或转人工时，needHuman 才会为 true。',
      '如果 needHuman 为 true，不要代替开发者承诺，只说明已建立跟进事项，并请访客留下联系方式和需求摘要。',
      '不要编造报价、档期、项目经历、合作承诺或项目进展。',
    ].join('\n');
  const prompt = [
      `意图：${intent}`,
      `needHuman：${handoff.needHuman}`,
      `联系开发者本人原因：${handoff.reason}`,
      `项目或咨询信息：\n${inquiry ? JSON.stringify(inquiry, null, 2) : '无'}`,
      `跟进事项：\n${ticket ? JSON.stringify(ticket, null, 2) : '无'}`,
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
  if (!aiFeatureEnabled) {
    return null;
  }

  return getConfiguredAiClient();
}

function getConfiguredAiClient() {
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

function buildFallbackReply(matchedFaqs, handoff, inquiry, ticket) {
  if (handoff.needHuman) {
    const ticketText = ticket ? `已建立跟进事项 ${ticket.id}。` : '';
    const inquiryText = inquiry ? `已关联 ${inquiry.type} ${inquiry.id}（${inquiry.title}）。` : '';
    return `${handoff.reason}。${inquiryText}${ticketText}请留下联系方式和需求摘要，开发者本人会继续跟进。`;
  }

  if (inquiry) {
    return `查到${inquiry.type} ${inquiry.id}：${inquiry.title}。当前状态：${inquiry.statusText}。下一步：${inquiry.nextStep}。${inquiry.eta}。`;
  }

  return matchedFaqs[0]?.answer || '我暂时没有在本地知识库中找到对应答案。你可以补充需求范围、预算、期望时间，或明确要求联系开发者本人。';
}

function findInquiry(message) {
  const inquiryId = extractInquiryId(message);
  return inquiryId ? inquiryIndex.get(normalize(inquiryId)) || null : null;
}

function createMessage({ role, actor, content, agentId = null, agentName = null, attachments = [] }) {
  return {
    id: randomUUID(),
    role,
    actor,
    content,
    agentId,
    agentName,
    attachments: normalizeAttachments(attachments),
    createdAt: new Date().toISOString(),
  };
}

// 图片附件：仅接受 image/* 的 base64 data URL，限制数量与大小（base64 存内存）
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 单图约 2MB（base64 原文）
function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a) => a && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/'))
    .slice(0, MAX_ATTACHMENTS)
    .filter((a) => a.dataUrl.length <= MAX_ATTACHMENT_BYTES)
    .map((a) => ({
      type: 'image',
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 64) : randomUUID(),
      dataUrl: a.dataUrl,
      name: typeof a.name === 'string' ? a.name.slice(0, 80) : 'image',
    }));
}

function appendMessages(currentMessages, ...nextMessages) {
  return [...currentMessages, ...nextMessages].slice(-MAX_MESSAGES_PER_SESSION);
}

function normalizeAgent(value = {}) {
  const id = String(value.id || '').trim().slice(0, 48);
  const name = String(value.name || '').trim().slice(0, 40);

  return {
    id: id || 'agent-local',
    name: name || '开发者本人',
  };
}

function createTicket({ sessionId, message, intent, reason, inquiry }) {
  const inquiryId = inquiry?.id || extractInquiryId(message) || null;
  const existingTicket = tickets.find((ticket) => {
    return ticket.status === 'open'
      && ticket.sessionId === sessionId
      && ticket.intent === intent
      && ticket.inquiryId === inquiryId;
  });

  if (existingTicket) {
    existingTicket.lastMessage = message;
    existingTicket.reason = reason;
    existingTicket.updatedAt = new Date().toISOString();
    return persistTicket(existingTicket);
  }

  const priority = hasAny(normalize(message), ['紧急', '尽快', '马上', '今天联系'])
    ? 'high'
    : 'normal';
  const ticket = {
    id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
    sessionId,
    status: 'open',
    priority,
    intent,
    reason,
    inquiryId,
    lastMessage: message,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  tickets.push(ticket);
  if (tickets.length > MAX_TICKETS) {
    const evicted = tickets.splice(0, tickets.length - MAX_TICKETS);
    evicted.forEach((item) => store.deleteTicket(item.id));
  }
  return persistTicket(ticket);
}

function getLatestTicketForSession(sessionId) {
  return tickets
    .filter((ticket) => ticket.sessionId === sessionId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
}

function moveOpenTicketToProcessing(sessionId) {
  const ticket = tickets.find((item) => item.sessionId === sessionId && item.status === 'open');

  if (!ticket) {
    return null;
  }

  return updateTicket(ticket, { status: 'processing' });
}

function resolveTicketsForSession(sessionId, resolution) {
  return tickets
    .filter((ticket) => ticket.sessionId === sessionId && ticket.status !== 'resolved')
    .map((ticket) => updateTicket(ticket, { status: 'resolved', resolution }));
}

function canTransitionTicket(currentStatus, nextStatus) {
  const transitions = {
    open: ['open', 'processing', 'resolved'],
    processing: ['processing', 'resolved'],
    resolved: ['resolved'],
  };

  return transitions[currentStatus]?.includes(nextStatus) ?? false;
}

function updateTicket(ticket, updates = {}) {
  const now = new Date().toISOString();

  if (updates.status) {
    ticket.status = updates.status;
  }
  if (updates.priority) {
    ticket.priority = updates.priority;
  }
  if (typeof updates.resolution === 'string' && updates.resolution.trim()) {
    ticket.resolution = updates.resolution.trim().slice(0, 120);
  }

  ticket.updatedAt = now;
  if (ticket.status === 'processing' && !ticket.acceptedAt) {
    ticket.acceptedAt = now;
  }
  if (ticket.status === 'resolved') {
    ticket.resolvedAt = ticket.resolvedAt || now;
  }

  return persistTicket(ticket);
}

function syncSessionFromTicket(ticket) {
  const session = sessions.get(ticket.sessionId);

  if (!session) {
    return null;
  }

  const isResolved = ticket.status === 'resolved';
  const nextSession = {
    ...session,
    status: isResolved ? 'closed' : ticket.status === 'processing' ? 'assigned' : session.status,
    priority: ticket.priority,
    needHuman: isResolved ? false : session.needHuman,
    reason: ticket.resolution || session.reason,
    ticketId: ticket.id,
    workflow: session.workflow
      ? {
          ...session.workflow,
          needHuman: isResolved ? false : session.workflow.needHuman,
          reason: ticket.resolution || session.workflow.reason,
          ticket,
        }
      : session.workflow,
    resolvedAt: isResolved ? ticket.resolvedAt : session.resolvedAt,
    updatedAt: new Date().toISOString(),
  };

  setSession(nextSession);
  return nextSession;
}

function buildMetrics() {
  const sessionList = [...sessions.values()];
  const messageCount = [...conversations.values()].reduce((total, messages) => total + messages.length, 0);
  const totalSessions = sessionList.length;
  const automatedSessions = sessionList.filter((session) => session.status === 'bot' && !session.needHuman).length;
  const openTicketCount = tickets.filter((ticket) => ticket.status === 'open').length;
  const processingTicketCount = tickets.filter((ticket) => ticket.status === 'processing').length;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      sessions: totalSessions,
      messages: messageCount,
      tickets: tickets.length,
    },
    queue: {
      waitingHuman: sessionList.filter((session) => session.status === 'waiting_human').length,
      assigned: sessionList.filter((session) => session.status === 'assigned').length,
      closed: sessionList.filter((session) => session.status === 'closed').length,
      highPriority: sessionList.filter((session) => session.priority === 'high').length,
    },
    tickets: {
      open: openTicketCount,
      processing: processingTicketCount,
      resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
      highPriority: tickets.filter((ticket) => ticket.priority === 'high').length,
    },
    ai: {
      automationRate: totalSessions ? Math.round((automatedSessions / totalSessions) * 100) : 100,
      handoffRate: totalSessions
        ? Math.round((sessionList.filter((session) => session.needHuman).length / totalSessions) * 100)
        : 0,
    },
    workload: {
      activeTickets: openTicketCount + processingTicketCount,
      activeSessions: sessionList.filter((session) => session.status !== 'closed').length,
    },
  };
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
  res.write(': connected\n\n');

  return setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);
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

  return session?.status === 'assigned';
}

function upsertSession({ sessionId, message, workflow, profile, visitor, forceStatus }) {
  const now = new Date().toISOString();
  const current = sessions.get(sessionId);
  const nextProfile = profile || current?.profile || null;
  const nextVisitor = visitor || current?.visitor || inferVisitorFromSessionId(sessionId);
  const status = forceStatus || resolveSessionStatus(current, workflow);
  const keepHighPriority = current?.priority === 'high' && current?.status !== 'closed';
  const priority = keepHighPriority || workflow.needHuman ? 'high' : 'normal';
  const inquiryId = workflow.inquiry?.id || current?.inquiryId || extractInquiryId(message) || null;
  const displayName = buildDisplayName(sessionId, sessions.size + 1, inquiryId, nextProfile, nextVisitor);
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
    inquiryId,
    ticketId: workflow.ticket?.id || current?.ticketId || null,
    assignedAgentId: status === 'assigned' ? current?.assignedAgentId || null : null,
    assignedAgentName: status === 'assigned' ? current?.assignedAgentName || null : null,
    workflow,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };

  setSession(session);
}

function resolveSessionStatus(current, workflow) {
  if (current?.status === 'closed') {
    return workflow.needHuman ? 'waiting_human' : 'bot';
  }
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
    inquiryId: null,
    ticketId: null,
    assignedAgentId: null,
    assignedAgentName: null,
    workflow: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildDisplayName(sessionId, index, inquiryId, profile, visitor) {
  if (profile?.name) {
    return profile.name;
  }
  if (visitor?.code) {
    return `访客 ${visitor.code}`;
  }
  if (inquiryId) {
    return `咨询 ${inquiryId}`;
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

function trimMap(map, maxEntries, onEvict) {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
    if (onEvict) onEvict(firstKey);
  }
}

const server = app.listen(port, () => {
  console.log(`Developer AI assistant running at http://localhost:${port}`);
  console.log(
    `AI mode: ${getActiveAiClient() ? `${aiProvider} ${getActiveModel()}` : aiFeatureEnabled ? 'local rules only' : 'disabled'}`
  );
  console.log(`Storage: ${store.enabled ? 'Postgres (持久化)' : '内存（未配置 DATABASE_URL）'}`);
});

// Render 重新部署/缩容时发 SIGTERM：优雅关闭 HTTP 与数据库连接池。
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
  });
}
