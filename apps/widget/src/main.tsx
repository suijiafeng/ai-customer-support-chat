import React from 'react';
import { createRoot } from 'react-dom/client';
import Widget from './Widget';
import css from './styles.js';


// 嵌入入口：读取 <script> 上的配置，挂载到隔离的 Shadow DOM
// 宿主通过 data-key、data-name、data-api-base、data-title 覆盖默认值；
// 默认回退到内置 demo 种子租户，方便零配置本地试用。
function readConfig() {
  const el = (document.currentScript ||
    document.querySelector('script[data-assistflow]') ||
    document.querySelector('script[src*="widget.js"]')) as HTMLScriptElement | null;
  const ds: DOMStringMap = el ? el.dataset : ({} as DOMStringMap);
  return {
    apiBase: (ds.apiBase || window.location.origin).replace(/\/$/, ''),
    siteKey: ds.key || 'd0KX6-CDtI-Gaxc-fR1K',
    tenantId: ds.name || 'tn_846ad88eee',
    title: ds.title || 'AssistFlow AI 客服系统',
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
      apiBase={cfg.apiBase}
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
