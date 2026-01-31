import React from 'react';
import { DEMO_ENTRIES, DEMO_STEPS } from './fixtures.js';

export default function App() {
  return (
    <main className="page">
      <header className="header">
        <a className="brand" href="/">
          <span className="brand-mark">AF</span>
          <span>AssistFlow</span>
        </a>
        <a className="health-link" href="/api/health">API Health</a>
      </header>

      <section className="intro">
        <p className="label">CHAT DEMO</p>
        <h1>消息同步演示</h1>
        <p>同时打开访客端和客服端，即可测试文字、表情、图片和实时消息同步。</p>
      </section>

      <section className="guide" aria-labelledby="guide-title">
        <h2 id="guide-title">演示步骤</h2>
        <ol>
          {DEMO_STEPS.map((step, i) => {
            const [before, after] = step.text.split(step.linkText);
            return (
              <li key={i}>
                {before}
                <a className="step-btn" href={step.path} target="_blank" rel="noopener">
                  {step.linkText}
                </a>
                {after}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="entries" aria-label="演示入口">
        {DEMO_ENTRIES.map((entry) => (
          <a key={entry.number} className={`entry${entry.secondary ? ' secondary' : ''}`} href={entry.path}>
            <span className="entry-number">{entry.number}</span>
            <div>
              <h2>{entry.title}</h2>
              <p>{entry.description}</p>
              <code>{entry.path}</code>
            </div>
          </a>
        ))}
      </section>

      <footer>
        <span>React Widget · React Workstation · NestJS · SSE</span>
        <span>消息持久化到 Postgres（未配置时为服务端内存）</span>
      </footer>
    </main>
  );
}
