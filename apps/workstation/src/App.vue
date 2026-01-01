<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { ElMessage } from 'element-plus';

// 后端基地址：与工作台同源，留空即可
const API = '';

// 客服身份（本轮先用本地身份占位，下一轮接 JWT 登录替换）
const agent = reactive({ id: 'agent-' + Math.random().toString(36).slice(2, 7), name: '客服小安' });

const sessions = ref([]);
const activeId = ref(null);
const messages = ref([]);
const reply = ref('');
const loading = ref(false);

let queueES = null;
let sessionES = null;
const listEl = ref(null);

const activeSession = computed(() => sessions.value.find((s) => s.sessionId === activeId.value) || null);

const statusTag = (s) => ({ bot: 'info', waiting_human: 'warning', assigned: 'success', resolved: '', closed: 'info' }[s] || 'info');
const statusText = (s) => ({ bot: 'AI 接待', waiting_human: '待接入', assigned: '人工中', resolved: '已解决', closed: '已关闭' }[s] || s);

function scrollBottom() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; });
}

// 队列 SSE：实时刷新会话列表
function connectQueue() {
  queueES = new EventSource(`${API}/api/sessions/events`);
  queueES.addEventListener('sessions', (e) => {
    try { sessions.value = JSON.parse(e.data).sessions || []; } catch (err) {}
  });
}

// 单会话 SSE：实时刷新当前会话消息
function openSession(id) {
  if (activeId.value === id) return;
  activeId.value = id;
  messages.value = [];
  if (sessionES) { sessionES.close(); sessionES = null; }
  sessionES = new EventSource(`${API}/api/sessions/${encodeURIComponent(id)}/events`);
  sessionES.addEventListener('session', (e) => {
    try { messages.value = JSON.parse(e.data).messages || []; scrollBottom(); } catch (err) {}
  });
}

async function send() {
  const content = reply.value.trim();
  if (!content || !activeId.value || loading.value) return;
  loading.value = true;
  try {
    const res = await fetch(`${API}/api/sessions/${encodeURIComponent(activeId.value)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, agent }),
    });
    if (res.status === 409) { ElMessage.warning('该会话已被其他客服接入'); return; }
    if (!res.ok) { ElMessage.error('发送失败'); return; }
    reply.value = '';
  } catch (err) { ElMessage.error('网络异常'); }
  finally { loading.value = false; }
}

async function resolve() {
  if (!activeId.value) return;
  try {
    await fetch(`${API}/api/sessions/${encodeURIComponent(activeId.value)}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent }),
    });
    ElMessage.success('已标记解决');
  } catch (err) { ElMessage.error('操作失败'); }
}

onMounted(connectQueue);
onBeforeUnmount(() => { if (queueES) queueES.close(); if (sessionES) sessionES.close(); });
</script>

<template>
  <el-container class="app">
    <el-header class="topbar">
      <span class="brand">AssistFlow 客服工作台</span>
      <span class="me">{{ agent.name }}（一人接待多会话）</span>
    </el-header>
    <el-container>
      <!-- 多会话队列 -->
      <el-aside width="300px" class="queue">
        <div class="queue-head">会话队列 <el-badge :value="sessions.length" type="primary" /></div>
        <el-scrollbar>
          <div
            v-for="s in sessions" :key="s.sessionId"
            class="sess" :class="{ active: s.sessionId === activeId }"
            @click="openSession(s.sessionId)">
            <div class="sess-top">
              <span class="name">{{ s.displayName }}</span>
              <el-tag size="small" :type="statusTag(s.status)">{{ statusText(s.status) }}</el-tag>
            </div>
            <div class="last">{{ s.lastMessage || '（暂无消息）' }}</div>
          </div>
          <el-empty v-if="!sessions.length" description="暂无会话" :image-size="60" />
        </el-scrollbar>
      </el-aside>

      <!-- 当前会话 -->
      <el-main class="chat">
        <template v-if="activeSession">
          <div class="chat-head">
            <span>{{ activeSession.displayName }}</span>
            <el-button size="small" type="success" plain @click="resolve">标记解决</el-button>
          </div>
          <div ref="listEl" class="msgs">
            <div v-for="(m, i) in messages" :key="i" class="row" :class="m.actor">
              <div class="meta">{{ m.actor === 'customer' ? '客户' : m.actor === 'agent' ? (m.agentName || '客服') : 'AI' }}</div>
              <div class="bubble">{{ m.content }}</div>
            </div>
            <el-empty v-if="!messages.length" description="加载中…" :image-size="60" />
          </div>
          <div class="composer">
            <el-input v-model="reply" type="textarea" :rows="2" resize="none"
              placeholder="输入回复，Enter 发送" @keydown.enter.prevent="send" />
            <el-button type="primary" :loading="loading" @click="send">发送</el-button>
          </div>
        </template>
        <el-empty v-else description="从左侧选择一个会话开始接待" />
      </el-main>
    </el-container>
  </el-container>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
.app { height: 100vh; }
.topbar { background: #2457c5; color: #fff; display: flex; align-items: center; justify-content: space-between; }
.brand { font-weight: 600; }
.me { font-size: 13px; opacity: .9; }
.queue { border-right: 1px solid #eee; background: #fafbfd; }
.queue-head { padding: 12px 14px; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.sess { padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f0f0f0; }
.sess:hover { background: #eef2fb; }
.sess.active { background: #e3ecfd; }
.sess-top { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 500; }
.last { color: #999; font-size: 12px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat { display: flex; flex-direction: column; padding: 0; }
.chat-head { padding: 12px 16px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
.msgs { flex: 1; overflow-y: auto; padding: 16px; background: #f5f7fb; }
.row { margin: 8px 0; display: flex; flex-direction: column; }
.row.customer { align-items: flex-start; }
.row.ai, .row.agent { align-items: flex-end; }
.meta { font-size: 11px; color: #aaa; margin-bottom: 2px; }
.bubble { max-width: 70%; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.customer .bubble { background: #fff; border: 1px solid #e4e8f0; }
.ai .bubble { background: #eef2fb; }
.agent .bubble { background: #2f855a; color: #fff; }
.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; align-items: flex-end; }
.composer .el-textarea { flex: 1; }
</style>
