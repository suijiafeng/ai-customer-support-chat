#!/usr/bin/env node
// Unified launcher for `npm run start`.
// Modes:
//   dev   - hot reload (npm run dev:all)
//   prod  - build + run packaged server (default)
//   demo  - build all, run server, serve demo (vite preview) against prod artifacts
// Selected by an explicit arg (`npm run start -- dev|prod|demo`) or NODE_ENV.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const arg = (process.argv[2] || '').toLowerCase();
const env = (process.env.NODE_ENV || '').toLowerCase();

let mode;
if (arg === 'dev' || arg === 'development') mode = 'dev';
else if (arg === 'prod' || arg === 'production') mode = 'prod';
else if (arg === 'demo') mode = 'demo';
else if (env === 'production') mode = 'prod';
else if (env === 'development') mode = 'dev';
else mode = 'prod'; // default: production

const scriptName = { dev: 'start:dev', prod: 'start:prod', demo: 'start:demo' }[mode];
const nodeEnv = mode === 'dev' ? 'development' : 'production';

// 按 NODE_ENV 解析 PORT，与 config.ts 的加载优先级保持一致：
// 真实环境变量 > .env.[mode] > .env（默认 3001）
function resolvePort() {
  if (process.env.PORT) return process.env.PORT;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of [`.env.${nodeEnv}`, '.env']) {
    try {
      const m = readFileSync(join(root, file), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
      if (m) return m[1];
    } catch {}
  }
  return '3001';
}

function backendUrl() {
  return `http://localhost:${resolvePort()}`;
}

const childEnv = {
  ...process.env,
  NODE_ENV: nodeEnv,
};
// dev 与 demo 都依赖前端代理打到后端，统一注入 BACKEND_URL 消除端口漂移
if (mode === 'dev' || mode === 'demo') {
  childEnv.BACKEND_URL = process.env.BACKEND_URL || backendUrl();
}

console.log(`[start] mode=${mode} -> npm run ${scriptName}`);
if (childEnv.BACKEND_URL) console.log(`[start] proxy backend = ${childEnv.BACKEND_URL}`);

const child = spawn('npm', ['run', scriptName], { stdio: 'inherit', env: childEnv });
child.on('exit', (code) => process.exit(code ?? 0));
