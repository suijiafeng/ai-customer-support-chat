export default `
.quick-pop { position: absolute; bottom: 104px; left: 10px; max-width: min(360px, calc(100% - 20px));
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 32px rgba(15,23,42,.14);
  padding: 6px; display: flex; flex-direction: column; z-index: 6; }
.quick-pop button { background: none; border: none; border-radius: 8px; color: #334155; cursor: pointer;
  font-size: 14px; padding: 8px 10px; text-align: left; font-family: inherit; }
.quick-pop button:hover { background: #f1f5f9; }

.afw { position: fixed; right: 20px; bottom: 128px; z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
.fab { width: 50px; height: 50px; border-radius: 50%; border: none; cursor: pointer;
  background: #2457c5; color: #fff; font-size: 22px; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 22px rgba(36,87,197,.4);
  transition: transform .15s ease, box-shadow .15s ease, left .22s ease, top .22s ease; }
.fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 12px 28px rgba(36,87,197,.45); }
.fab:active { transform: scale(.96); }
/* 拖动中：关闭位移过渡（跟手），松手后过渡生效产生吸附动画 */
.fab.dragging { transition: none; cursor: grabbing; }
.fab.dragging:hover, .fab.dragging:active { transform: none; }
.fab { position: relative; }
.fab-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 6px;
  border-radius: 12px; background: #ef4444; color: #fff; font-size: 12px; font-weight: 700; line-height: 18px;
  text-align: center; box-shadow: 0 0 0 2px #fff; }
/* 访客消息发送状态 / 失败重试 */
.msg-status { font-size: 12px; color: #94a3b8; margin: 4px 4px 0; text-align: right; }
.msg-status.failed { color: #ef4444; }
.retry-link { margin-left: 6px; border: none; background: none; color: #2457c5; font-size: 12px;
  cursor: pointer; padding: 0; text-decoration: underline; }
.backdrop { position: fixed; inset: 0; z-index: 2147483001; border: 0; padding: 0; cursor: default;
  background: rgba(15,23,42,.34); backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
  animation: afw-fade .18s ease-out; touch-action: none; }
@keyframes afw-fade { from { opacity: 0; } to { opacity: 1; } }
/* 面板：与悬浮球分离，固定在视口居中（inset+margin auto 居中，避免与弹出动画 transform 冲突） */
.panel { position: fixed; inset: 0; margin: auto;
  width: min(480px, calc(100vw - 40px)); height: min(720px, calc(100vh - 100px));
  background: #fff; border-radius: 16px; box-shadow: 0 28px 80px rgba(15,23,42,.38);
  display: flex; flex-direction: column; overflow: hidden; z-index: 2147483002;
  animation: afw-pop .18s cubic-bezier(.2,.8,.2,1); }
@keyframes afw-pop { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
/* 窗口边缘/角落的拉伸手柄（移动端全屏时不渲染） */
.rs { position: absolute; z-index: 9; touch-action: none; background: transparent; }
.rs-n { top: 0; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.rs-s { bottom: 0; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.rs-e { top: 14px; bottom: 14px; right: 0; width: 6px; cursor: ew-resize; }
.rs-w { top: 14px; bottom: 14px; left: 0; width: 6px; cursor: ew-resize; }
.rs-ne { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.rs-nw { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.rs-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.rs-sw { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.head { background: #2457c5; color: #fff; padding: 14px 16px;
  font-weight: 600; display: flex; justify-content: space-between; align-items: center;
  cursor: grab; touch-action: none; user-select: none; }
.panel.dragging .head { cursor: grabbing; }
.panel.dragging { box-shadow: 0 24px 60px rgba(15,23,42,.32); }
.head .title { display: flex; gap: 16px; }
.head .sub { font-size: 12px; font-weight: 400; opacity: .85; display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; display: inline-block; }
.dot.off { background: #fcd34d; }
.x { background: transparent; border: none; color: #fff; font-size: 22px; cursor: pointer; line-height: 1;
  width: 30px; height: 30px; border-radius: 8px; transition: background .15s; }
.x:hover { background: rgba(255,255,255,.18); }
.list-wrap { position: relative; flex: 1; display: flex; min-height: 0; }
.list { flex: 1; overflow-y: auto; padding: 14px 12px; background: #f1f3f6; scroll-behavior: smooth; overscroll-behavior: contain; }

.row { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; margin: 14px 0; }
.row.customer { flex-direction: row-reverse; }
.row.system { justify-content: center; }
.avatar { flex-shrink: 0; width: 34px; height: 34px; border-radius: 8px; display: flex;
  align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
  color: #fff; background: #94a3b8; }
.avatar.customer { background: #2457c5; }
.avatar.ai { background: #8097b8; }
.avatar.agent { background: #2457c5; }
.col { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: 78%; }
.row.customer .col { align-items: flex-end; }
.meta { font-size: 12px; color: #94a3b8; margin: 0 2px 4px; }
.bubble { position: relative; max-width: 100%; padding: 10px 12px; border-radius: 12px; font-size: 14px;
  line-height: 1.55; word-break: break-word; box-shadow: 0 1px 2px rgba(20,30,55,.08); }
.customer .bubble { background: #2457c5; color: #fff; border-bottom-right-radius: 4px; }
.ai .bubble, .agent .bubble { background: #fff; color: #1e293b; border-bottom-left-radius: 4px; }
.system .bubble { background: #eef2fb; color: #2457c5; font-size: 12px; border-radius: 8px; box-shadow: none; }
.bubble a { color: #2457c5; text-decoration: underline; word-break: break-all; }
.customer .bubble a { color: rgba(255,255,255,.85); }
.time { font-size: 12px; color: #94a3b8; margin: 4px 4px 0; }
.row.customer .time { text-align: right; }
.typing-dots { display: inline-flex; gap: 4px; align-items: center; padding: 2px 0; }
.typing-dots i { width: 6px; height: 6px; border-radius: 50%; background: #94a3b8; display: inline-block;
  animation: afw-blink 1.2s infinite ease-in-out; }
.typing-dots i:nth-child(2) { animation-delay: .2s; }
.typing-dots i:nth-child(3) { animation-delay: .4s; }
@keyframes afw-blink { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
.to-bottom { position: absolute; right: 14px; bottom: 14px; width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid #e2e8f0; background: #fff; color: #2457c5; font-size: 16px; cursor: pointer;
  box-shadow: 0 4px 12px rgba(15,23,42,.16); display: flex; align-items: center; justify-content: center;
  transition: transform .15s, opacity .15s; }
.to-bottom:hover { transform: translateY(-1px); }
.composer { margin: 8px 10px 10px; border: 1px solid #cbd5e1; border-radius: 12px;
  background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.04); transition: border-color .2s, box-shadow .2s; }
.composer:focus-within { border-color: #2457c5; box-shadow: 0 0 0 3px rgba(36,87,197,.12); }
textarea { box-sizing: border-box; width: 100%; min-height: 56px; max-height: 120px; resize: none;
  border: 0; border-radius: 12px; padding: 10px 12px 4px; font-size: 14px; line-height: 1.5;
  outline: none; font-family: inherit; background: transparent; }
/* 移动端输入框 16px：避免 iOS Safari 聚焦时自动缩放页面 */
@media (max-width: 640px) {
  textarea { font-size: 16px; }
}
.composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 8px; }
.send { border: none; background: #2457c5; color: #fff; border-radius: 12px;
  min-width: 68px; height: 32px; padding: 0 16px; font-weight: 600; cursor: pointer; transition: opacity .15s, transform .1s; }
.send:hover:not(:disabled) { opacity: .92; }
.send:active:not(:disabled) { transform: scale(.97); }
.send:disabled { opacity: .45; cursor: not-allowed; }
.txt { white-space: pre-wrap; }
/* Markdown 渲染（AI/客服消息）：容器不再 pre-wrap，由块级元素控制排版 */
.txt .md { white-space: normal; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md-p { margin: 6px 0; }
.md-h { font-weight: 600; margin: 8px 0 4px; }
.md-h1 { font-size: 16px; } .md-h2 { font-size: 14px; } .md-h3, .md-h4, .md-h5, .md-h6 { font-size: 14px; }
.md-list { margin: 6px 0; padding-left: 20px; }
.md-list li { margin: 2px 0; }
.md-code { background: rgba(0,0,0,.06); border-radius: 4px; padding: 2px 4px; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.md-pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px;
  overflow-x: auto; margin: 6px 0; }
.md-pre code { background: none; padding: 0; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.imgs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.imgs img { max-width: 140px; max-height: 140px; border-radius: 12px; cursor: pointer; display: block; }
.image-link { padding: 0; border: 0; background: transparent; cursor: pointer; }
.toolbar { display: flex; align-items: center; gap: 4px; min-width: 0; }
.tool { background: transparent; border: none; font-size: 18px; cursor: pointer; line-height: 1;
  width: 30px; height: 30px; padding: 0; border-radius: 8px; transition: background .15s;
  display: flex; align-items: center; justify-content: center; }
.tool:hover, .tool.active { background: #eef2fb; }
.key-hint { margin-left: 4px; color: #94a3b8; font-size: 12px; white-space: nowrap; }
.cooldown-bar { margin: 0 10px 8px; padding: 8px 12px; font-size: 14px; line-height: 1.4;
  color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; }
.key-invalid-bar { margin: 4px 0; padding: 10px 12px; font-size: 14px; line-height: 1.5;
  color: #dc2626; background: #fef2f2; border: 1px solid #fef2f2; border-radius: 8px; }
.hint { color: #94a3b8; font-size: 14px; text-align: center; margin: 22px 12px 10px; line-height: 1.7; }
.previews { display: flex; gap: 8px; padding: 8px 10px 0; flex-wrap: wrap; }
.thumb { position: relative; }
.thumb img { width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; }
.thumb button { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%;
  border: none; background: #64748b; color: #fff; font-size: 12px; line-height: 1; cursor: pointer; }
.emoji-pop { position: absolute; bottom: 110px; right: 10px; left: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,.18); border-radius: 12px; overflow: hidden; background: #fff;
  z-index: 5; border: 1px solid #e2e8f0; }
.ep { display: flex; flex-direction: column; }
.ep-tabs { display: flex; border-bottom: 1px solid #e2e8f0; padding: 4px 6px 0; gap: 2px; }
.ep-tab { background: none; border: none; cursor: pointer; font-size: 18px; padding: 6px 8px;
  border-radius: 8px 8px 0 0; line-height: 1; border-bottom: 2px solid transparent; transition: background .1s; }
.ep-tab:hover { background: #f8fafc; }
.ep-tab.active { border-bottom-color: #2457c5; background: #eef2fb; }
.ep-grid { display: grid; grid-template-columns: repeat(8, 1fr); padding: 6px; gap: 2px;
  max-height: 220px; overflow-y: auto; }
.ep-btn { background: none; border: none; cursor: pointer; font-size: 20px; padding: 4px;
  border-radius: 8px; line-height: 1; transition: background .1s; text-align: center; }
.ep-btn:hover { background: #eef2fb; }

/* 窄屏（≤600px）：略收窄面板，留出边距 */
.afw.narrow .panel { width: min(420px, calc(100vw - 24px)); }
.afw.narrow .col { max-width: 80%; }

/* 移动端（≤480px 或矮屏）：全屏面板 */
.afw.mobile { right: 0; bottom: 0; }
.afw.mobile .fab { position: fixed; right: 18px; bottom: calc(44px + env(safe-area-inset-bottom, 0px)); }
.afw.mobile .panel {
  position: fixed; inset: 0; width: 100vw; height: 100dvh; border-radius: 0; bottom: 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.afw.mobile .col { max-width: 82%; }
.afw.mobile .emoji-pop { bottom: 96px; }
.afw.mobile .key-hint { display: none; }
.afw.mobile .tool { width: 36px; height: 36px; }
.afw.mobile .quick-pop { left: 0; right: 0; max-width: 100%; border-radius: 12px 12px 0 0; bottom: 100px; }
`;
