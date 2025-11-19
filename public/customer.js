const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#chatForm');
const input = document.querySelector('#messageInput');
const statusEl = document.querySelector('#status');
const customerNameInput = document.querySelector('#customerName');
const customerContactInput = document.querySelector('#customerContact');
const visitorCodeEl = document.querySelector('#visitorCode');
const quickButtons = document.querySelectorAll('[data-prompt]');
const VISITOR_KEY = 'assistflow.customer.visitor';
const SESSION_KEY = 'assistflow.customer.sessionId';
const PROFILE_KEY = 'assistflow.customer.profile';
const HISTORY_PREFIX = 'assistflow.customer.history';
const visitor = getOrCreateVisitor();
let sessionId = getOrCreateSessionId();
const history = loadHistory();
let sessionEvents = null;

async function boot() {
  restoreProfile();
  renderVisitorCode();
  renderPersistedHistory();
  await saveProfile({ skipEmpty: true });
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
    appendMessage(
      'bot',
      '你好，请直接描述你的问题。如果要查订单，可以输入订单号，例如 A1001。'
    );
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
  appendMessage('bot', '正在为你查询');
  messagesEl.lastElementChild.dataset.typingId = typingId;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: cleanMessage, history, profile: getProfile(), visitor }),
    });
    const data = await response.json();
    const typingBubble = document.querySelector(`[data-typing-id="${typingId}"] .bubble`);

    if (!response.ok) {
      if (typingBubble) {
        typingBubble.textContent = '暂时没有处理成功，请稍后再试。';
      }
      return;
    }

    if (data.handledByAgent) {
      if (typingBubble) {
        typingBubble.textContent = '已发送给人工客服。';
      }
      return;
    }

    if (typingBubble) {
      typingBubble.textContent = data.reply || '暂时没有处理成功，请稍后再试。';
      history.push({ role: 'assistant', content: data.reply || '' });
      persistHistory();
    }
  } catch {
    const typingBubble = document.querySelector(`[data-typing-id="${typingId}"] .bubble`);
    if (typingBubble) {
      typingBubble.textContent = '服务暂时不可用，请稍后再试。';
    }
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

function restoreProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    customerNameInput.value = profile.name || '';
    customerContactInput.value = profile.contact || '';
  } catch {
    customerNameInput.value = '';
    customerContactInput.value = '';
  }
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
  statusEl.textContent = customerNameInput.value.trim()
    ? `${customerNameInput.value.trim()} · ${visitor.code}`
    : `访客 ${visitor.code}`;
}

function getProfile() {
  return {
    name: customerNameInput.value.trim(),
    contact: customerContactInput.value.trim(),
  };
}

async function saveProfile(options = {}) {
  const profile = getProfile();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

  if (options.skipEmpty && !profile.name && !profile.contact) {
    return;
  }

  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
  } catch {
    // Profile is best-effort for the demo; chat still works without it.
  }
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

customerNameInput.addEventListener('change', () => {
  updateReadyState();
  saveProfile();
});
customerContactInput.addEventListener('change', () => saveProfile());

boot();

window.addEventListener('beforeunload', () => {
  if (sessionEvents) {
    sessionEvents.close();
  }
});
