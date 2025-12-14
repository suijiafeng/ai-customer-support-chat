const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#chatForm');
const input = document.querySelector('#messageInput');
const statusEl = document.querySelector('#status');
const visitorCodeEl = document.querySelector('#visitorCode');
const modeBannerEl = document.querySelector('#modeBanner');
const modeTextEl = document.querySelector('#modeText');
const quickButtons = document.querySelectorAll('[data-prompt]');
const VISITOR_KEY = 'assistflow.customer.visitor';
const SESSION_KEY = 'assistflow.customer.sessionId';
const HISTORY_PREFIX = 'assistflow.customer.history';
const visitor = getOrCreateVisitor();
let sessionId = getOrCreateSessionId();
const history = loadHistory();
let sessionEvents = null;
let sessionPollTimer = null;

async function boot() {
  renderVisitorCode();
  renderPersistedHistory();
  updateReadyState();

  try {
    const data = await requestJson('/api/health');
    statusEl.dataset.aiStatus = data.aiEnabled ? `${formatProvider(data.aiProvider)} 在线` : '客服助手在线';
  } catch {
    statusEl.dataset.aiStatus = '离线模式';
  }
  updateReadyState();

  connectSessionEvents();
}

function appendMessage(role, content, opts = {}) {
  const article = document.createElement('article');
  article.className = `message ${role}`;

  if (role === 'bot') {
    const avatar = document.createElement('div');
    avatar.className = `bot-avatar ${opts.actor === 'agent' ? 'human-agent' : ''}`.trim();
    avatar.textContent = opts.actor === 'agent' ? 'CS' : 'AI';
    article.appendChild(avatar);
  }

  const body = document.createElement('div');
  body.className = 'message-body';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (opts.typing) {
    bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  } else {
    bubble.textContent = content;
  }

  body.appendChild(bubble);

  if (!opts.typing) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = formatMessageMeta(opts);
    body.appendChild(meta);
  }

  article.appendChild(body);
  messagesEl.appendChild(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  return article;
}

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatMessageMeta(opts = {}) {
  const actorLabel = opts.actor === 'agent' ? '人工客服' : '';
  const timeLabel = opts.createdAt ? formatTime(new Date(opts.createdAt)) : formatTime(new Date());

  return [actorLabel, timeLabel].filter(Boolean).join(' · ');
}

function resolveTyping(typingId, text) {
  const typingEl = document.querySelector(`[data-typing-id="${typingId}"]`);
  if (!typingEl) return;
  const bubble = typingEl.querySelector('.bubble');
  if (bubble) bubble.textContent = text;
  const body = typingEl.querySelector('.message-body');
  if (body && !body.querySelector('.message-meta')) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = formatMessageMeta();
    body.appendChild(meta);
  }
}

function setMode(mode) {
  if (!modeBannerEl || !modeTextEl) return;
  modeBannerEl.classList.toggle('human', mode === 'human');
  modeBannerEl.classList.toggle('typing', mode === 'typing');
  const labels = {
    ai: 'AI 自动接管',
    typing: 'AI 正在回复',
    human: '人工客服已接入',
  };
  modeTextEl.textContent = labels[mode] ?? labels.ai;
}

function renderMessages(messages) {
  messagesEl.replaceChildren();

  if (!messages.length) {
    appendMessage('bot', '你好！我是 AssistFlow 智能客服，很高兴为您服务。可以帮您查询订单、申请退款、开具发票等，请直接描述您的问题。');
    return;
  }

  messages.forEach((message) => {
    appendMessage(message.role === 'user' ? 'user' : 'bot', message.content, {
      actor: message.actor,
      createdAt: message.createdAt,
    });
  });
}

async function sendMessage(message) {
  const cleanMessage = String(message || '').trim();

  if (!cleanMessage) {
    return;
  }
  appendMessage('user', cleanMessage);
  history.push({ role: 'user', content: cleanMessage });
  persistHistory();
  input.value = '';
  input.disabled = true;

  const typingId = `typing-${Date.now()}`;
  const typingEl = appendMessage('bot', '', { typing: true });
  typingEl.dataset.typingId = typingId;
  setMode('typing');

  try {
    const data = await requestJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: cleanMessage, history, visitor }),
    });

    if (data.handledByAgent) {
      resolveTyping(typingId, '已发送给人工客服。');
      setMode('human');
      return;
    }

    const reply = data.reply || '暂时没有处理成功，请稍后再试。';
    resolveTyping(typingId, reply);
    setMode('ai');
    history.push({ role: 'assistant', content: data.reply || '' });
    persistHistory();
  } catch {
    resolveTyping(typingId, '服务暂时不可用，请稍后再试。');
    setMode('ai');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function formatProvider(provider) {
  const labels = {
    openai: 'AI 助手',
    deepseek: 'AI 助手',
  };

  return labels[provider] || 'AI 助手';
}

function getOrCreateSessionId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('sessionId');

  if (fromUrl) {
    safeSetItem(SESSION_KEY, fromUrl);
    return fromUrl;
  }

  const existing = safeGetItem(SESSION_KEY);

  if (existing) {
    writeSessionIdToUrl(existing);
    return existing;
  }

  const nextSessionId = `customer-${visitor.code.toLowerCase()}`;
  safeSetItem(SESSION_KEY, nextSessionId);
  writeSessionIdToUrl(nextSessionId);
  return nextSessionId;
}

function writeSessionIdToUrl(nextSessionId) {
  try {
    const url = new URL(window.location.href);

    if (url.searchParams.get('sessionId') === nextSessionId) {
      return;
    }

    url.searchParams.set('sessionId', nextSessionId);
    window.history.replaceState({}, '', url);
  } catch {
    // URL syncing is optional; chat can continue without history support.
  }
}

function loadHistory() {
  try {
    const parsed = JSON.parse(safeGetItem(getHistoryKey()) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistHistory() {
  safeSetItem(getHistoryKey(), JSON.stringify(history.slice(-12)));
}

function getHistoryKey() {
  return `${HISTORY_PREFIX}.${sessionId}`;
}

function renderPersistedHistory() {
  if (!history.length) {
    return;
  }

  renderMessages(history);
}

function connectSessionEvents() {
  if (sessionEvents) {
    sessionEvents.close();
  }
  stopSessionPolling();

  if (!window.EventSource) {
    startSessionPolling();
    return;
  }

  sessionEvents = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
  sessionEvents.addEventListener('session', (event) => {
    const data = safeParseJson(event.data, {});
    const messages = data.messages || [];

    if (!messages.length) {
      return;
    }

    history.splice(0, history.length, ...messages);
    persistHistory();
    renderMessages(history);
  });
  sessionEvents.addEventListener('error', () => {
    if (sessionEvents) {
      sessionEvents.close();
      sessionEvents = null;
    }
    startSessionPolling();
  });
}

function startSessionPolling() {
  if (sessionPollTimer) {
    return;
  }
  sessionPollTimer = window.setInterval(pollSession, 5000);
}

function stopSessionPolling() {
  if (!sessionPollTimer) {
    return;
  }
  window.clearInterval(sessionPollTimer);
  sessionPollTimer = null;
}

async function pollSession() {
  try {
    const data = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const messages = data.messages || [];

    if (!messages.length) {
      return;
    }

    history.splice(0, history.length, ...messages);
    persistHistory();
    renderMessages(history);
  } catch {
    // Polling is a best-effort fallback for environments without SSE.
  }
}

function getOrCreateVisitor() {
  try {
    const existing = JSON.parse(safeGetItem(VISITOR_KEY) || 'null');
    if (existing?.code) {
      return existing;
    }
  } catch {
  }

  const nextVisitor = {
    code: `U${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  safeSetItem(VISITOR_KEY, JSON.stringify(nextVisitor));
  return nextVisitor;
}

function renderVisitorCode() {
  visitorCodeEl.textContent = `访客码 ${visitor.code}`;
}

function updateReadyState() {
  input.disabled = false;
  input.placeholder = '请输入你的问题';
  quickButtons.forEach((button) => {
    button.disabled = false;
  });
}

quickButtons.forEach((button) => {
  button.addEventListener('click', () => {
    sendMessage(button.dataset.prompt);
  });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

boot();

window.addEventListener('beforeunload', () => {
  if (sessionEvents) {
    sessionEvents.close();
  }
  stopSessionPolling();
});

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
    // Storage can be unavailable in private mode or restricted WebViews.
  }
}
