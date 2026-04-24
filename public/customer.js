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

async function boot() {
  renderVisitorCode();
  renderPersistedHistory();
  updateReadyState();

  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    statusEl.dataset.aiStatus = data.aiEnabled ? `${formatProvider(data.aiProvider)} 在线` : '客服助手在线';
  } catch {
    statusEl.dataset.aiStatus = '连接中';
  }
  updateReadyState();

  connectSessionEvents();
}

function appendMessage(role, content, opts = {}) {
  const article = document.createElement('article');
  article.className = `message ${role}`;

  if (role === 'bot') {
    const avatar = document.createElement('div');
    avatar.className = 'bot-avatar';
    avatar.textContent = 'AI';
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
    meta.textContent = formatTime(new Date());
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

function resolveTyping(typingId, text) {
  const typingEl = document.querySelector(`[data-typing-id="${typingId}"]`);
  if (!typingEl) return;
  const bubble = typingEl.querySelector('.bubble');
  if (bubble) bubble.textContent = text;
  const body = typingEl.querySelector('.message-body');
  if (body && !body.querySelector('.message-meta')) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = formatTime(new Date());
    body.appendChild(meta);
  }
}

function setMode(mode) {
  if (!modeBannerEl) return;
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
    appendMessage(message.role === 'user' ? 'user' : 'bot', message.content);
  });
}

async function sendMessage(message) {
  const cleanMessage = message.trim();

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
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: cleanMessage, history, visitor }),
    });
    const data = await response.json();

    if (!response.ok) {
      resolveTyping(typingId, '暂时没有处理成功，请稍后再试。');
      setMode('ai');
      return;
    }

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
    localStorage.setItem(SESSION_KEY, fromUrl);
    return fromUrl;
  }

  const existing = localStorage.getItem(SESSION_KEY);

  if (existing) {
    writeSessionIdToUrl(existing);
    return existing;
  }

  const nextSessionId = `customer-${visitor.code.toLowerCase()}`;
  localStorage.setItem(SESSION_KEY, nextSessionId);
  writeSessionIdToUrl(nextSessionId);
  return nextSessionId;
}

function writeSessionIdToUrl(nextSessionId) {
  const url = new URL(window.location.href);

  if (url.searchParams.get('sessionId') === nextSessionId) {
    return;
  }

  url.searchParams.set('sessionId', nextSessionId);
  window.history.replaceState({}, '', url);
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(getHistoryKey()) || '[]');
  } catch {
    return [];
  }
}

function persistHistory() {
  localStorage.setItem(getHistoryKey(), JSON.stringify(history.slice(-12)));
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

  sessionEvents = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
  sessionEvents.addEventListener('session', (event) => {
    const data = JSON.parse(event.data);
    const messages = data.messages || [];

    if (!messages.length) {
      return;
    }

    history.splice(0, history.length, ...messages);
    persistHistory();
    renderMessages(history);
  });
}

function getOrCreateVisitor() {
  try {
    const existing = JSON.parse(localStorage.getItem(VISITOR_KEY) || 'null');
    if (existing?.code) {
      return existing;
    }
  } catch {
  }

  const nextVisitor = {
    code: `U${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(VISITOR_KEY, JSON.stringify(nextVisitor));
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
});
