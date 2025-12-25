const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#chatForm');
const input = document.querySelector('#messageInput');
const statusEl = document.querySelector('#status');
const modeBadgeEl = document.querySelector('#modeBadge');
const intentEl = document.querySelector('#intent');
const sentimentEl = document.querySelector('#sentiment');
const aiStatusEl = document.querySelector('#aiStatus');
const handoffEl = document.querySelector('#handoff');
const reasonEl = document.querySelector('#reason');
const sourcesEl = document.querySelector('#sources');
const orderEl = document.querySelector('#order');
const ticketEl = document.querySelector('#ticket');
const ticketListEl = document.querySelector('#ticketList');
const refreshTicketsButton = document.querySelector('#refreshTickets');
const exportTranscriptButton = document.querySelector('#exportTranscript');
const resolveSessionButton = document.querySelector('#resolveSession');
const metricWaitingEl = document.querySelector('#metricWaiting');
const metricHighEl = document.querySelector('#metricHigh');
const metricAssignedEl = document.querySelector('#metricAssigned');
const metricAutomationEl = document.querySelector('#metricAutomation');
const quickButtons = document.querySelectorAll('[data-reply]');
const sessionListEl = document.querySelector('#sessionList');
const queueCountEl = document.querySelector('#queueCount');
const AGENT_KEY = 'assistflow.agent.profile';

let selectedSessionId = null;
let selectedMessages = [];
let sessions = [];
let agentProfile = getAgentProfile();
let queueEvents = null;
let sessionEvents = null;
let queuePollTimer = null;
let sessionPollTimer = null;

async function boot() {
  try {
    const data = await requestJson('/api/health');
    statusEl.textContent = data.aiEnabled
      ? `${formatProvider(data.aiProvider)} / ${data.model} · ${agentProfile.name}`
      : `本地规则模式 · ${agentProfile.name}`;
    modeBadgeEl.textContent = `${data.faqCount} FAQ / ${data.orderCount} 订单`;
    selectedSessionId = new URLSearchParams(window.location.search).get('sessionId');
    await refreshSessions();
    await refreshTickets();
    await refreshMetrics();
    connectQueueEvents();
  } catch {
    statusEl.textContent = '服务未连接';
  }
}

function appendMessage(role, content) {
  const article = document.createElement('article');
  article.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;

  article.appendChild(bubble);
  messagesEl.appendChild(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages(messages) {
  messagesEl.replaceChildren();

  if (!messages.length) {
    appendMessage('bot', '从左侧选择一个客户会话，查看聊天记录和 AI 诊断。');
    return;
  }

  messages.forEach((message) => {
    appendMessage(message.role === 'user' ? 'bot customer' : 'user agent', message.content);
  });
}

async function sendMessage(message) {
  const cleanMessage = message.trim();

  if (!cleanMessage || !selectedSessionId) {
    return;
  }

  appendMessage('user', cleanMessage);
  selectedMessages.push({
    role: 'assistant',
    actor: 'agent',
    content: cleanMessage,
    agentId: agentProfile.id,
    agentName: agentProfile.name,
    createdAt: new Date().toISOString(),
  });
  input.value = '';
  input.disabled = true;

  try {
    const data = await requestJson(`/api/sessions/${encodeURIComponent(selectedSessionId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: cleanMessage, agent: agentProfile }),
    });

    selectedMessages = data.messages || selectedMessages;
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
    await refreshSessions({ keepSelection: true });
    await refreshTickets();
    await refreshMetrics();
  } catch (error) {
    appendMessage('bot', `消息发送失败：${error.message}`);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function refreshSessions(options = {}) {
  try {
    const data = await requestJson('/api/sessions');
    sessions = data.sessions || [];
    queueCountEl.textContent = sessions.length;
    renderSessions();
    await refreshMetrics();

    if (selectedSessionId && sessions.some((session) => session.sessionId === selectedSessionId)) {
      if (!options.keepSelection && selectedMessages.length === 0) {
        await selectSession(selectedSessionId, { updateUrl: false });
      }
      return;
    }

    if (selectedSessionId) {
      selectedSessionId = null;
    }

    if (!selectedSessionId && sessions.length > 0) {
      await selectSession(sessions[0].sessionId);
      return;
    }

    if (options.keepSelection && selectedSessionId) {
      const latest = sessions.find((session) => session.sessionId === selectedSessionId);
      if (latest) {
        updateWorkflowFromSession(latest);
      }
    }
  } catch {
    sessionListEl.innerHTML = '<p class="empty-state">队列加载失败</p>';
  }
}

function renderSessions() {
  if (sessions.length === 0) {
    sessionListEl.innerHTML = '<p class="empty-state">暂无客户会话</p>';
    return;
  }

  sessionListEl.replaceChildren(
    ...sessions.map((session) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = [
        'queue-card',
        session.sessionId === selectedSessionId ? 'active' : '',
        session.priority === 'high' ? 'warning' : '',
        session.status === 'closed' ? 'closed' : '',
      ]
        .filter(Boolean)
        .join(' ');
      button.innerHTML = `
        <div>
          <strong>${escapeHtml(session.displayName)}</strong>
          <span>${escapeHtml(formatSessionSubtitle(session))}</span>
        </div>
        <em>${formatSessionStatus(session)}</em>
      `;
      button.addEventListener('click', () => selectSession(session.sessionId));
      return button;
    })
  );
}

async function selectSession(sessionId, options = {}) {
  selectedSessionId = sessionId;
  if (options.updateUrl !== false) {
    writeSelectedSessionToUrl(sessionId);
  }
  renderSessions();

  try {
    const data = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
    selectedMessages = data.messages || [];
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
    input.disabled = false;
    input.placeholder = `回复 ${data.session.displayName}`;
    resolveSessionButton.disabled = data.session.status === 'closed';
    connectSessionEvents(sessionId);
  } catch {
    selectedMessages = [];
    renderMessages([]);
    input.disabled = true;
    input.placeholder = '会话加载失败';
    resolveSessionButton.disabled = true;
  }
}

function connectQueueEvents() {
  if (queueEvents) {
    queueEvents.close();
  }
  stopQueuePolling();

  if (!window.EventSource) {
    startQueuePolling();
    return;
  }

  queueEvents = new EventSource('/api/sessions/events');
  queueEvents.addEventListener('sessions', async (event) => {
    const data = safeParseJson(event.data, {});
    sessions = data.sessions || [];
    queueCountEl.textContent = sessions.length;
    renderSessions();
    refreshMetrics();

    if (selectedSessionId) {
      const latest = sessions.find((session) => session.sessionId === selectedSessionId);
      if (latest) {
        updateWorkflowFromSession(latest);
      }
      return;
    }

    if (sessions.length > 0) {
      await selectSession(sessions[0].sessionId);
    }
  });
  queueEvents.addEventListener('error', () => {
    if (queueEvents) {
      queueEvents.close();
      queueEvents = null;
    }
    startQueuePolling();
  });
}

function connectSessionEvents(sessionId) {
  if (sessionEvents) {
    sessionEvents.close();
  }
  stopSessionPolling();

  if (!window.EventSource) {
    startSessionPolling(sessionId);
    return;
  }

  sessionEvents = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
  sessionEvents.addEventListener('session', (event) => {
    const data = safeParseJson(event.data, {});

    if (data.session?.sessionId !== selectedSessionId) {
      return;
    }

    selectedMessages = data.messages || [];
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
  });
  sessionEvents.addEventListener('error', () => {
    if (sessionEvents) {
      sessionEvents.close();
      sessionEvents = null;
    }
    startSessionPolling(sessionId);
  });
}

function writeSelectedSessionToUrl(sessionId) {
  const url = new URL(window.location.href);

  if (url.searchParams.get('sessionId') === sessionId) {
    return;
  }

  url.searchParams.set('sessionId', sessionId);
  window.history.replaceState({}, '', url);
}

async function refreshMetrics() {
  try {
    const data = await requestJson('/api/metrics');
    metricWaitingEl.textContent = data.queue?.waitingHuman ?? 0;
    metricHighEl.textContent = data.queue?.highPriority ?? 0;
    metricAssignedEl.textContent = data.queue?.assigned ?? 0;
    metricAutomationEl.textContent = `${data.ai?.automationRate ?? 100}%`;
  } catch {
    metricWaitingEl.textContent = '-';
    metricHighEl.textContent = '-';
    metricAssignedEl.textContent = '-';
    metricAutomationEl.textContent = '-';
  }
}

async function refreshTickets() {
  try {
    const data = await requestJson('/api/tickets');
    const tickets = data.tickets || [];

    if (tickets.length === 0) {
      ticketListEl.textContent = '暂无工单';
      return;
    }

    ticketListEl.replaceChildren(
      ...tickets.slice(0, 6).map((ticket) => {
        const item = document.createElement('article');
        item.className = `ticket-card ${ticket.priority === 'high' ? 'high' : ''}`;
        item.innerHTML = `
          <strong>${escapeHtml(ticket.id)}</strong>
          <span>${ticket.priority === 'high' ? '高优先级' : '普通'} / ${formatTicketStatus(ticket.status)} / ${escapeHtml(ticket.intent)}</span>
          <p>${escapeHtml(ticket.reason)}</p>
          <div class="ticket-actions">
            <button type="button" data-ticket-action="processing" data-ticket-id="${escapeHtml(ticket.id)}">处理中</button>
            <button type="button" data-ticket-action="resolved" data-ticket-id="${escapeHtml(ticket.id)}">解决</button>
          </div>
        `;
        return item;
      })
    );
  } catch {
    ticketListEl.textContent = '工单加载失败';
  }
}

async function updateTicketStatus(ticketId, status) {
  try {
    const payload = {
      status,
      resolution: status === 'resolved' ? '客服工作台手动标记解决' : undefined,
    };
    const data = await requestJson(`/api/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (data.session?.sessionId === selectedSessionId) {
      updateWorkflowFromSession(data.session);
    }
    await refreshSessions({ keepSelection: true });
    await refreshTickets();
    await refreshMetrics();
  } catch {
    ticketListEl.textContent = '工单状态更新失败，请稍后再试。';
  }
}

async function resolveSelectedSession() {
  if (!selectedSessionId) {
    return;
  }

  resolveSessionButton.disabled = true;

  try {
    const data = await requestJson(`/api/sessions/${encodeURIComponent(selectedSessionId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: '客服工作台标记当前会话已解决' }),
    });

    updateWorkflowFromSession(data.session);
    await refreshSessions({ keepSelection: true });
    await refreshTickets();
    await refreshMetrics();
  } catch {
    resolveSessionButton.disabled = false;
  }
}

function exportTranscript() {
  if (!selectedSessionId) {
    return;
  }

  const session = sessions.find((item) => item.sessionId === selectedSessionId);
  const payload = {
    exportedAt: new Date().toISOString(),
    session,
    messages: selectedMessages,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${selectedSessionId}-transcript.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function updateWorkflowFromSession(session) {
  if (!session?.workflow) {
    updateWorkflow({});
    return;
  }

  updateWorkflow(session.workflow);
}

function updateWorkflow(data) {
  intentEl.textContent = data.intent || '-';
  sentimentEl.textContent = formatSentiment(data.sentiment);
  aiStatusEl.textContent = formatAiStatus(data.ai);
  handoffEl.textContent = data.needHuman ? '是' : '否';
  reasonEl.textContent = data.reason || '-';
  sourcesEl.textContent = data.sources?.length
    ? data.sources.map((source) => `${source.question} (${source.score})`).join('，')
    : '-';
  orderEl.textContent = data.order
    ? `${data.order.id} / ${data.order.statusText} / ${data.order.eta}`
    : '-';
  ticketEl.textContent = data.ticket
    ? `${data.ticket.id} / ${data.ticket.priority} / ${data.ticket.status}`
    : '-';
}

function formatSessionStatus(session) {
  if (session.status === 'closed') {
    return '已解决';
  }
  if (session.status === 'waiting_human') {
    return '待接入';
  }
  if (session.priority === 'high') {
    return '高';
  }
  return formatRelativeTime(session.updatedAt);
}

function formatTicketStatus(status) {
  const labels = {
    open: '待处理',
    processing: '处理中',
    resolved: '已解决',
  };

  return labels[status] || status || '-';
}

function formatSessionSubtitle(session) {
  const parts = [];

  if (session.profile?.contact) {
    parts.push(maskContact(session.profile.contact));
  }
  if (session.orderId) {
    parts.push(session.orderId);
  }
  if (session.lastMessage) {
    parts.push(session.lastMessage);
  }

  return parts.join(' · ') || '暂无消息';
}

function maskContact(contact) {
  const value = String(contact);

  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }

  if (value.length >= 7) {
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
  }

  return value;
}

function getAgentProfile() {
  const params = new URLSearchParams(window.location.search);
  const urlAgentId = params.get('agentId');
  const urlAgentName = params.get('agentName');

  if (urlAgentId || urlAgentName) {
    const profile = {
      id: sanitizeAgentId(urlAgentId || urlAgentName),
      name: (urlAgentName || urlAgentId || '本地客服').slice(0, 40),
    };
    safeSetItem(AGENT_KEY, JSON.stringify(profile));
    return profile;
  }

  const stored = safeParseJson(safeGetItem(AGENT_KEY), null);

  if (stored?.id) {
    return {
      id: sanitizeAgentId(stored.id),
      name: String(stored.name || stored.id).slice(0, 40),
    };
  }

  const profile = {
    id: `agent-${Math.random().toString(16).slice(2, 8)}`,
    name: '本地客服',
  };
  safeSetItem(AGENT_KEY, JSON.stringify(profile));
  return profile;
}

function sanitizeAgentId(value) {
  return String(value || 'agent-local').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'agent-local';
}

function formatRelativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));

  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.floor(minutes / 60)}h`;
}

function formatSentiment(sentiment) {
  const labels = {
    positive: '正向',
    neutral: '中性',
    negative: '负向',
  };

  return labels[sentiment] || '-';
}

function formatProvider(provider) {
  const labels = {
    openai: 'OpenAI 模式',
    deepseek: 'DeepSeek 模式',
  };

  return labels[provider] || provider || 'AI 模式';
}

function formatAiStatus(ai) {
  if (!ai) {
    return '-';
  }

  if (ai.used) {
    return `${formatProvider(ai.provider)} / ${ai.model}`;
  }

  if (ai.fallback) {
    return `本地回退${ai.error ? `：${ai.error}` : ''}`;
  }

  return '-';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

quickButtons.forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.reply;
    input.focus();
  });
});

refreshTicketsButton.addEventListener('click', refreshTickets);
exportTranscriptButton.addEventListener('click', exportTranscript);
resolveSessionButton.addEventListener('click', resolveSelectedSession);
ticketListEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-ticket-action]');

  if (!button) {
    return;
  }

  updateTicketStatus(button.dataset.ticketId, button.dataset.ticketAction);
});
window.addEventListener('beforeunload', () => {
  if (queueEvents) {
    queueEvents.close();
  }
  if (sessionEvents) {
    sessionEvents.close();
  }
  stopQueuePolling();
  stopSessionPolling();
});

input.disabled = true;
boot();

function startQueuePolling() {
  if (queuePollTimer) {
    return;
  }
  queuePollTimer = window.setInterval(() => refreshSessions({ keepSelection: true }), 5000);
}

function stopQueuePolling() {
  if (!queuePollTimer) {
    return;
  }
  window.clearInterval(queuePollTimer);
  queuePollTimer = null;
}

function startSessionPolling(sessionId) {
  if (sessionPollTimer) {
    return;
  }
  sessionPollTimer = window.setInterval(() => pollSelectedSession(sessionId), 5000);
}

function stopSessionPolling() {
  if (!sessionPollTimer) {
    return;
  }
  window.clearInterval(sessionPollTimer);
  sessionPollTimer = null;
}

async function pollSelectedSession(sessionId) {
  if (sessionId !== selectedSessionId) {
    stopSessionPolling();
    return;
  }

  try {
    const data = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
    selectedMessages = data.messages || [];
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
  } catch {
    // Polling is a best-effort fallback for environments without SSE.
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? safeParseJson(text, null) : {};

  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  if (data === null) {
    throw new Error('Invalid JSON response');
  }

  return data;
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeGetItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The workbench still runs in restricted storage modes.
  }
}
