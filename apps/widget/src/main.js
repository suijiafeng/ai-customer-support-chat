import Widget from './Widget.svelte';
import css from './styles.js';

// 嵌入入口：读取 <script> 上的配置，挂载到隔离的 Shadow DOM
function readConfig() {
  const el =
    document.currentScript ||
    document.querySelector('script[data-assistflow]') ||
    document.querySelector('script[src*="widget.js"]');
  const ds = el ? el.dataset : {};
  return {
    apiBase: ds.apiBase || ds.api || window.location.origin,
    siteKey: ds.key || 'default',
    title: ds.title || '在线客服',
  };
}

function getVisitorId(siteKey) {
  const k = `assistflow.visitor.${siteKey}`;
  let id = null;
  try { id = window.localStorage.getItem(k); } catch (e) {}
  if (!id) {
    id = 'v-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { window.localStorage.setItem(k, id); } catch (e) {}
  }
  return id;
}

function mount() {
  const cfg = readConfig();
  const host = document.createElement('div');
  host.id = 'assistflow-widget-root';
  document.body.appendChild(host);
  // Shadow DOM 做样式隔离，避免污染宿主网站、也不被其样式干扰
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  shadow.appendChild(styleEl);
  const target = document.createElement('div');
  shadow.appendChild(target);

  new Widget({
    target,
    props: {
      apiBase: cfg.apiBase.replace(/\/$/, ''),
      siteKey: cfg.siteKey,
      title: cfg.title,
      sessionId: getVisitorId(cfg.siteKey),
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
