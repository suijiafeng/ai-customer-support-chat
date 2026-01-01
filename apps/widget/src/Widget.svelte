<script>
  import { onDestroy, onMount, tick } from "svelte";
  import "emoji-picker-element";
  import {
    loadVisitorId,
    ensureVisitorId,
    isVisitorIdValid,
  } from "./visitorId.js";

  const newId = () => crypto.randomUUID();

  export let apiBase = "";
  export let title = "开发者 AI 助手";
  export let siteKey = "default";
  // 访客标识/会话 ID：首次发送消息后才惰性生成，存于本地并带完整性校验
  export let sessionId = "";
  let open = false;
  let input = "";
  let sending = false;
  let connection = "syncing";
  let messages = [];
  let pending = []; // 待发送图片附件 [{dataUrl,name}]
  let showEmoji = false;
  let listEl, taEl, fileEl;
  let sessionEvents = null;
  let atBottom = true;

  // ---- 悬浮球：固定右下角、不可拖；窗口：居中弹出、可拖动 ----
  let mobile = false;
  let panelEl;
  let panelPos = null; // {x, y} 窗口左上角；null = 居中（由 CSS 控制）
  let pdown = null; // 拖拽起点临时态
  let pdragging = false;

  function computeMobile() {
    mobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 480px), (max-height: 560px)").matches;
  }

  function onHeadDown(e) {
    if (mobile || !panelEl) return;
    if (e.target.closest && e.target.closest(".x")) return; // 关闭按钮不触发拖拽
    const rect = panelEl.getBoundingClientRect();
    panelPos = { x: rect.left, y: rect.top }; // 切到绝对定位，无跳变
    pdown = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
    pdragging = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onHeadMove(e) {
    if (!pdown || !panelEl) return;
    const w = panelEl.offsetWidth;
    const h = panelEl.offsetHeight;
    const nx = pdown.x + (e.clientX - pdown.px);
    const ny = pdown.y + (e.clientY - pdown.py);
    panelPos = {
      x: Math.max(8, Math.min(nx, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(ny, window.innerHeight - h - 8)),
    };
  }
  function onHeadUp() {
    if (!pdown) return;
    pdown = null;
    pdragging = false;
  }

  // 窗口内联定位：拖动后用 left/top，否则留空由 CSS 居中（移动端始终全屏）
  $: panelStyle =
    panelPos && !mobile
      ? `left:${panelPos.x}px; top:${panelPos.y}px; right:auto; bottom:auto; margin:0;`
      : "";

  function scrollToBottom() {
    tick().then(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }
  function onListScroll() {
    if (!listEl) return;
    atBottom =
      listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
  }

  // 时间戳格式化为 HH:MM
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  // 将纯文本切分为文本/链接片段，安全渲染可点击链接
  const URL_RE = /(https?:\/\/[^\s]+)/g;
  function linkParts(text) {
    const parts = [];
    let last = 0;
    let match;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(text)) !== null) {
      if (match.index > last)
        parts.push({ link: false, value: text.slice(last, match.index) });
      parts.push({ link: true, value: match[0] });
      last = match.index + match[0].length;
    }
    if (last < text.length)
      parts.push({ link: false, value: text.slice(last) });
    return parts;
  }
  function normalizeMessages(list = []) {
    return list.map((message) => ({
      ...message,
      from: message.from || message.actor || "system",
    }));
  }

  function setMessages(list, force = false) {
    messages = normalizeMessages(list);
    if (force || atBottom) scrollToBottom();
  }

  async function requestJson(url, options) {
    const response = await fetch(`${apiBase}${url}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data)
      throw new Error(data?.error || `request failed: ${response.status}`);
    return data;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () =>
        resolve({
          id: newId(),
          dataUrl: r.result,
          name: file.name || "image",
          type: file.type,
        });
      r.readAsDataURL(file);
    });
  }
  const imageEnabled = false; // 是否启用图片发送（后端未实现相关接口，暂时隐藏入口）
  async function addFiles(files) {
    if (!imageEnabled) return;
    const imgs = [...files]
      .filter((f) => f && f.type.startsWith("image/") && f.size <= 750 * 1024)
      .slice(0, 4 - pending.length);
    const items = await Promise.all(imgs.map(fileToDataUrl));
    pending = [...pending, ...items].slice(0, 4);
  }
  function onPaste(e) {
    const items = [...(e.clipboardData?.items || [])].filter((i) =>
      i.type.startsWith("image/"),
    );
    if (items.length) {
      e.preventDefault();
      addFiles(items.map((i) => i.getAsFile()).filter(Boolean));
    }
  }
  function onPickFiles(e) {
    addFiles(e.target.files);
    e.target.value = "";
  }
  function removePending(i) {
    pending = pending.filter((_, idx) => idx !== i);
  }

  function addEmoji(e) {
    const ch = e.detail?.unicode || "";
    input += ch;
    showEmoji = false;
    if (taEl) taEl.focus();
  }

  async function activate() {
    sessionEvents?.close();
    try {
      const data = await requestJson(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
      );
      setMessages(data.messages);
    } catch {}

    sessionEvents = new EventSource(
      `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    sessionEvents.onopen = () => {
      connection = "synced";
    };
    sessionEvents.addEventListener("session", (event) => {
      try {
        setMessages(JSON.parse(event.data).messages || []);
      } catch {}
    });
    sessionEvents.onerror = () => {
      connection = "syncing";
    };
  }

  // 确保会话 ID 合法：不存在则生成，已被篡改/损坏则重新生成；返回是否发生了变化
  async function ensureSession() {
    const prev = sessionId;
    if (!sessionId || !isVisitorIdValid(siteKey, sessionId)) {
      sessionId = ensureVisitorId(siteKey);
    }
    if (!sessionEvents || sessionId !== prev) {
      await activate();
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && pending.length === 0) || sending) return;
    const attachments = pending;
    sending = true;
    try {
      await ensureSession();
      const data = await requestJson("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: text,
          attachments,
          visitor: { code: sessionId },
        }),
      });
      input = "";
      pending = [];
      showEmoji = false;
      atBottom = true;
      setMessages(data.messages || messages, true);
    } catch (err) {
      messages = [
        ...messages,
        { id: newId(), from: "system", content: "消息发送失败，请稍后重试。" },
      ];
      scrollToBottom();
    } finally {
      sending = false;
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }
  function toggle() {
    open = !open;
    if (open) {
      panelPos = null;
      atBottom = true;
      scrollToBottom();
    } // 每次打开都居中
  }

  function onResize() {
    computeMobile();
    if (panelPos && panelEl) {
      const w = panelEl.offsetWidth,
        h = panelEl.offsetHeight;
      panelPos = {
        x: Math.max(8, Math.min(panelPos.x, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(panelPos.y, window.innerHeight - h - 8)),
      };
    }
  }

  onMount(async () => {
    computeMobile();
    window.addEventListener("resize", onResize);

    // 回访访客：本地已有合法标识则直接恢复会话；否则等到首次发消息再生成
    const existing = loadVisitorId(siteKey);
    if (existing) {
      sessionId = existing;
      await activate();
    }
  });

  onDestroy(() => {
    sessionEvents?.close();
    if (typeof window !== "undefined")
      window.removeEventListener("resize", onResize);
  });
</script>

<div class="afw">
  {#if open}
    <div
      class="panel"
      class:dragging={pdragging}
      bind:this={panelEl}
      style={panelStyle}
    >
      <div
        class="head"
        on:pointerdown={onHeadDown}
        on:pointermove={onHeadMove}
        on:pointerup={onHeadUp}
        on:pointercancel={onHeadUp}
      >
        <span class="title">
          {title}
          <span class="sub"
            ><span class="dot {connection === 'synced' ? '' : 'off'}"
            ></span>{connection === "synced" ? "消息已同步" : "正在同步"}</span
          >
        </span>
        <button class="x" on:click={toggle} aria-label="关闭">×</button>
      </div>
      <div class="list-wrap">
        <div class="list" bind:this={listEl} on:scroll={onListScroll}>
          {#if messages.length === 0}
            <div class="hint">
              您好，想了解开发服务还是项目进展？<br />试试「项目怎么报价」
            </div>
          {/if}
          {#each messages as m (m.id)}
            <div class="row {m.from}">
              {#if m.from !== "system"}
                <div class="avatar {m.from}">
                  {m.from === "customer" ? "我" : m.from === "ai" ? "AI" : "客"}
                </div>
              {/if}
              <div class="col">
                {#if m.from !== "customer" && m.from !== "system"}
                  <div class="meta">
                    {m.from === "ai" ? "智能助手" : m.agentName || "开发者本人"}
                  </div>
                {/if}
                <div class="bubble">
                  {#if m.content}<div class="txt">
                      {#each linkParts(m.content) as part}{#if part.link}<a
                            href={part.value}
                            target="_blank"
                            rel="noopener noreferrer">{part.value}</a
                          >{:else}{part.value}{/if}{/each}
                    </div>{/if}
                  {#if m.attachments && m.attachments.length}
                    <div class="imgs">
                      {#each m.attachments as a}
                        <button
                          class="image-link"
                          type="button"
                          on:click={() => window.open(a.dataUrl, "_blank")}
                        >
                          <img src={a.dataUrl} alt={a.name} />
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
                {#if m.from !== "system" && fmtTime(m.createdAt)}<div
                    class="time"
                  >
                    {fmtTime(m.createdAt)}
                  </div>{/if}
              </div>
            </div>
          {/each}
          {#if sending}<div class="row ai">
              <div class="avatar ai">AI</div>
              <div class="col">
                <div class="bubble">
                  <span class="typing-dots"><i></i><i></i><i></i></span>
                </div>
              </div>
            </div>{/if}
        </div>
        {#if !atBottom}<button
            class="to-bottom"
            on:click={scrollToBottom}
            aria-label="回到底部">↓</button
          >{/if}
      </div>

      {#if pending.length}
        <div class="previews">
          {#each pending as p, i}
            <div class="thumb">
              <img src={p.dataUrl} alt={p.name} /><button
                on:click={() => removePending(i)}>×</button
              >
            </div>
          {/each}
        </div>
      {/if}

      {#if showEmoji}
        <div class="emoji-pop">
          <emoji-picker on:emoji-click={addEmoji}></emoji-picker>
        </div>
      {/if}

      <div class="composer">
        <textarea
          rows="2"
          placeholder="输入消息，Enter 发送…"
          bind:this={taEl}
          bind:value={input}
          on:keydown={onKey}
          on:paste={onPaste}
        ></textarea>
        <div class="composer-foot">
          <div class="toolbar">
            <button
              class:active={showEmoji}
              class="tool"
              title="表情"
              on:click={() => (showEmoji = !showEmoji)}>😊</button
            >
            {#if imageEnabled}
              <button
                class="tool"
                title="发送图片/截图"
                on:click={() => fileEl.click()}>🖼️</button
              >
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                bind:this={fileEl}
                on:change={onPickFiles}
              />
            {/if}
            <span class="key-hint">Shift + Enter 换行</span>
          </div>
          <button
            class="send"
            on:click={send}
            disabled={sending || (!input.trim() && pending.length === 0)}
          >
            {sending ? "发送中" : "发送"}
          </button>
        </div>
      </div>
    </div>
  {/if}
  {#if !open}
    <button class="fab" on:click={toggle}>{open ? "收起" : "💬"}</button>
  {/if}
</div>
