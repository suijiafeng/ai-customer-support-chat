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
const quickButtons = document.querySelectorAll('[data-reply]');
const sessionListEl = document.querySelector('#sessionList');
const queueCountEl = document.querySelector('#queueCount');

let selectedSessionId = null;
let selectedMessages = [];
let sessions = [];
let queueEvents = null;
let sessionEvents = null;

async function boot() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    statusEl.textContent = data.aiEnabled
      ? `${formatProvider(data.aiProvider)} / ${data.model}`
      : '本地规则模式';
    modeBadgeEl.textContent = `${data.faqCount} FAQ / ${data.orderCount} 订单`;
    selectedSessionId = new URLSearchParams(window.location.search).get('sessionId');
    await refreshSessions();
    await refreshTickets();
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
    appendMessage(message.role === 'user' ? 'bot' : 'user', message.content);
  });
}

async function sendMessage(message) {
  const cleanMessage = message.trim();

  if (!cleanMessage || !selectedSessionId) {
    return;
  }

  appendMessage('user', cleanMessage);
  selectedMessages.push({ role: 'user', content: cleanMessage });
  input.value = '';
  input.disabled = true;

  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: cleanMessage }),
    });
    const data = await response.json();

    selectedMessages = data.messages || selectedMessages;
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
    await refreshSessions({ keepSelection: true });
    await refreshTickets();
  } catch {
    appendMessage('bot', '消息发送失败，请稍后再试。');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function refreshSessions(options = {}) {
  try {
    const response = await fetch('/api/sessions');
    const data = await response.json();
    sessions = data.sessions || [];
    queueCountEl.textContent = sessions.length;
    renderSessions();

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
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const data = await response.json();
    selectedMessages = data.messages || [];
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
    input.disabled = false;
    input.placeholder = `回复 ${data.session.displayName}`;
    connectSessionEvents(sessionId);
  } catch {
    selectedMessages = [];
    renderMessages([]);
    input.disabled = true;
    input.placeholder = '会话加载失败';
  }
}

function connectQueueEvents() {
  if (queueEvents) {
    queueEvents.close();
  }

  queueEvents = new EventSource('/api/sessions/events');
  queueEvents.addEventListener('sessions', async (event) => {
    const data = JSON.parse(event.data);
    sessions = data.sessions || [];
    queueCountEl.textContent = sessions.length;
    renderSessions();

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
}

function connectSessionEvents(sessionId) {
  if (sessionEvents) {
    sessionEvents.close();
  }

  sessionEvents = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
  sessionEvents.addEventListener('session', (event) => {
    const data = JSON.parse(event.data);

    if (data.session?.sessionId !== selectedSessionId) {
      return;
    }

    selectedMessages = data.messages || [];
    renderMessages(selectedMessages);
    updateWorkflowFromSession(data.session);
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

async function refreshTickets() {
  try {
    const response = await fetch('/api/tickets');
    const data = await response.json();
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
          <span>${ticket.priority === 'high' ? '高优先级' : '普通'} / ${escapeHtml(ticket.intent)}</span>
          <p>${escapeHtml(ticket.reason)}</p>
        `;
        return item;
      })
    );
  } catch {
    ticketListEl.textContent = '工单加载失败';
  }
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
  if (session.status === 'waiting_human') {
    return '待接入';
  }
  if (session.priority === 'high') {
    return '高';
  }
  return formatRelativeTime(session.updatedAt);
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
window.addEventListener('beforeunload', () => {
  if (queueEvents) {
    queueEvents.close();
  }
  if (sessionEvents) {
    sessionEvents.close();
  }
});

input.disabled = true;
boot();
