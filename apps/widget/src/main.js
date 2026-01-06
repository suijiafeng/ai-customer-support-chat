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
    title: ds.title || 'AssistFlow AI 客服系统',
  };
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
      title: cfg.title,
      // 标识由 widget 在首次发消息时惰性生成并校验，这里只传 siteKey
      siteKey: cfg.siteKey,
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
