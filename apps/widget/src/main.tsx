import React from 'react';
import { createRoot } from 'react-dom/client';
import Widget from './Widget';
import css from './styles.js';


// 嵌入入口：读取 <script> 上的配置，挂载到隔离的 Shadow DOM
function readConfig() {
  const el = (document.currentScript ||
    document.querySelector('script[data-assistflow]') ||
    document.querySelector('script[src*="widget.js"]')) as HTMLScriptElement | null;
  const ds: DOMStringMap = el ? el.dataset : ({} as DOMStringMap);
  return {
    apiBase: window.location.origin,
    siteKey: "4B15-64On-dN1y-qIV4",
    tenantId: "tn_8dfd32ad0d", // 租户ID（必填），与 data-key 成对校验
    title: 'AssistFlow AI 客服系统',
  };
}

function mount() {
  const cfg = readConfig();
  console.log('[AssistFlow] mounting widget with config:', cfg);
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

  createRoot(target).render(
    <Widget
      apiBase={cfg.apiBase.replace(/\/$/, '')}
      title={cfg.title}
      // 标识由 widget 在首次发消息时惰性生成并校验，这里只传租户身份（key + ID）
      siteKey={cfg.siteKey}
      tenantId={cfg.tenantId}
    />
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
