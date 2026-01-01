<script>
  import { onDestroy, tick } from 'svelte';

  export let apiBase = '';
  export let siteKey = 'default';
  export let title = '在线客服';
  export let sessionId = 'default';

  let open = false;
  let input = '';
  let sending = false;
  let messages = [];
  let listEl;
  let es = null; // SSE 连接

  function scrollToBottom() {
    tick().then(() => { if (listEl) listEl.scrollTop = listEl.scrollHeight; });
  }

  function push(msg) {
    messages = [...messages, msg];
    scrollToBottom();
  }

  // 订阅会话 SSE：接收人工客服的回复（AI 让位后由客服推送）
  function connectStream() {
    if (es) return;
    try {
      es = new EventSource(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/events`);
      es.addEventListener('session', (e) => {
        try {
          const data = JSON.parse(e.data);
          const list = (data.messages || []).filter((m) => m.actor === 'agent');
          // 只追加尚未显示的客服消息
          const shown = new Set(messages.filter((m) => m.from === 'agent').map((m) => m.content));
          list.forEach((m) => { if (!shown.has(m.content)) push({ from: 'agent', content: m.content }); });
        } catch (err) {}
      });
    } catch (err) {}
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    input = '';
    push({ from: 'customer', content: text });
    sending = true;
    connectStream();
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, visitor: { source: siteKey } }),
      });
      const data = await res.json();
      if (data.handledByAgent) {
        push({ from: 'system', content: '已转接人工客服，请稍候…' });
      } else if (data.reply) {
        push({ from: 'ai', content: data.reply });
      }
    } catch (err) {
      push({ from: 'system', content: '网络异常，请重试。' });
    } finally {
      sending = false;
    }
  }

  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
  function toggle() { open = !open; if (open) { connectStream(); scrollToBottom(); } }

  onDestroy(() => { if (es) es.close(); });
</script>

<div class="afw">
  {#if open}
    <div class="panel">
      <div class="head">
        <span>{title}</span>
        <button class="x" on:click={toggle} aria-label="关闭">×</button>
      </div>
      <div class="list" bind:this={listEl}>
        {#if messages.length === 0}
          <div class="hint">您好，请问有什么可以帮您？试试「帮我查一下订单 A1001」</div>
        {/if}
        {#each messages as m}
          <div class="row {m.from}">
            <div class="bubble">{m.content}</div>
          </div>
        {/each}
        {#if sending}<div class="row ai"><div class="bubble typing">正在回复…</div></div>{/if}
      </div>
      <div class="inputbar">
        <textarea rows="1" placeholder="输入消息…" bind:value={input} on:keydown={onKey}></textarea>
        <button class="send" on:click={send} disabled={sending}>发送</button>
      </div>
    </div>
  {/if}
  <button class="fab" on:click={toggle}>{open ? '收起' : '💬'}</button>
</div>

