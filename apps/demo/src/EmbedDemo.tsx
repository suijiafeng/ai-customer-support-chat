import React, { useEffect } from 'react';
import './embed.css';

const WIDGET_SRC = '/widget/widget.js';

/**
 * Widget 嵌入演示：模拟第三方网站，通过 <script src="/widget/widget.js"> 消费
 * 已发布的组件产物——与真实宿主站点完全相同的接入方式，不依赖 widget 源码。
 */
export default function EmbedDemo() {
  useEffect(() => {
    // widget 自行向 body 挂载浮球；重复进入页面时不重复注入
    if (document.getElementById('assistflow-widget-root')) return;
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.dataset.assistflow = '';
    script.dataset.key = 'demo-site';
    script.dataset.title = 'AssistFlow AI 客服系统';
    document.body.appendChild(script);
  }, []);

  return (
    <div className="embed-page">
      <header>
        <div className="brand">
          <span className="brand-mark">AF</span>
          <span>模拟宿主网站</span>
        </div>
        <a href="/workstation/" target="_blank" rel="noopener">打开客服工作台 →</a>
      </header>

      <main>
        <p className="label">WIDGET DEMO</p>
        <h1>一行代码，给网站装上 AI 客服</h1>
        <p className="intro">
          这就是嵌入后的样子——不占页面空间，右下角浮球，点开即聊。
        </p>

        <section className="steps" aria-label="体验步骤">
          <article className="step">
            <span>01</span>
            <strong>点开右下角浮球</strong>
            <p>就像访客打开任意装了它的网站。</p>
          </article>
          <article className="step">
            <span>02</span>
            <strong>随便问一句</strong>
            <p>试试「项目怎么报价」「最近有档期吗」，或说「转人工」。</p>
          </article>
          <article className="step">
            <span>03</span>
            <strong>客服端接管</strong>
            <p>工作台登录工号 9527（密码 123456）回复，AI 自动让位。</p>
          </article>
        </section>
      </main>

      <aside className="float-guide" aria-hidden="true">
        <span>
          <strong>点我开聊</strong>
          <span>试试问「项目怎么报价」</span>
        </span>
        <b>→</b>
      </aside>

      <div className="fab-ping" aria-hidden="true"></div>
    </div>
  );
}
