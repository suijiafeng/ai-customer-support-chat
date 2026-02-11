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
        <p className="intro">
          这个页面用于模拟任意网站嵌入 AssistFlow Widget 后的效果。
          聊天功能不会占用页面主体空间，访客需要时点击浮球即可打开。
        </p>

        <section className="steps" aria-label="体验步骤">
          <article className="step">
            <span>01</span>
            <strong>点击聊天浮球</strong>
            <p>浮球固定在页面右下角。</p>
          </article>
          <article className="step">
            <span>02</span>
            <strong>发送测试消息</strong>
            <p>输入文字或表情，测试消息发送。</p>
          </article>
          <article className="step">
            <span>03</span>
            <strong>打开客服工作台</strong>
            <p>前往客服端查看并回复当前会话。</p>
          </article>
        </section>
      </main>

      <aside className="float-guide" aria-hidden="true">
        <span>
          <strong>点击浮球开始聊天</strong>
          <span>浮球位于页面右下角</span>
        </span>
        <b>→</b>
      </aside>

      <div className="fab-ping" aria-hidden="true"></div>
    </div>
  );
}
