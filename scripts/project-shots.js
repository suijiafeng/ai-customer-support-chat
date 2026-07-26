#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function argValue(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1] || fallback;
}

const BASE_URL = argValue('--base', process.env.SCREENSHOT_BASE_URL || 'http://localhost:3001');
const OUT_DIR = path.resolve(process.cwd(), argValue('--out', 'docs/screenshots'));
const AGENT_NO = process.env.SHOT_AGENT_NO || '9527';
const AGENT_PASSWORD = process.env.SHOT_AGENT_PASSWORD || '123456';
const CHROME_PATH = argValue('--chrome-path', process.env.SHOT_CHROME_PATH || '');

async function launchBrowser() {
  // 默认优先使用系统已安装的 Google Chrome（无需下载 Playwright Chromium）
  try {
    if (CHROME_PATH) {
      return await chromium.launch({ headless: true, executablePath: CHROME_PATH });
    }
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (error) {
    const reason = String(error?.message || error || 'unknown');
    throw new Error(
      `启动本机 Chrome 失败：${reason}\n` +
      '请确认已安装 Google Chrome，或通过 --chrome-path / SHOT_CHROME_PATH 指定可执行文件路径。'
    );
  }
}

async function ensureServerReady(baseUrl) {
  const health = `${baseUrl.replace(/\/$/, '')}/api/health`;
  try {
    const res = await fetch(health);
    if (!res.ok) {
      throw new Error(`health check failed: ${res.status}`);
    }
  } catch (error) {
    throw new Error(
      `无法连接到 ${health}。请先启动项目（例如 npm run start），或使用 --base 指向已运行站点。`
    );
  }
}

async function shot(page, name, fn) {
  await fn();
  const output = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: output, fullPage: true });
  console.log(`saved ${output}`);
}

async function sendDemoMessage(page, keyword) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('.embed-page').waitFor({ state: 'visible' });
  await page.locator('button.fab').click();
  await page.locator('.panel').waitFor({ state: 'visible' });
  await page.getByPlaceholder('输入消息，Enter 发送…').fill(`${keyword}，我想做一个官网，怎么报价？`);
  await page.getByRole('button', { name: '发送' }).click();
  await page.locator('.row.customer .txt', { hasText: keyword }).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('.row.ai .txt').first().waitFor({ state: 'visible', timeout: 25000 });
}

async function loginWorkstation(page) {
  await page.goto(`${BASE_URL.replace(/\/$/, '')}/workstation/`, { waitUntil: 'networkidle' });
  // 用 label 而非 placeholder 定位：placeholder 是展示文案（工号那栏现在是 "0000"），
  // 改文案就会让脚本静默失效；label 文字是结构的一部分，稳定得多
  await page.getByLabel('工号').fill(AGENT_NO);
  await page.getByLabel('密码').fill(AGENT_PASSWORD);
  // 同理按结构定位：按钮文案已从「登录」改为「签到上岗」，绑文案的选择器早晚会失效
  await page.locator('form button[type=submit]').click();
  await page.locator('.app .topbar').waitFor({ state: 'visible', timeout: 15000 });
}

async function run() {
  await ensureServerReady(BASE_URL);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const keyword = `自动化演示${Date.now().toString().slice(-6)}`;

  const browser = await launchBrowser();

  try {
    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktop = await desktopCtx.newPage();

    await shot(desktop, 'demo-home-desktop', async () => {
      await desktop.goto(BASE_URL, { waitUntil: 'networkidle' });
      await desktop.locator('.embed-page').waitFor({ state: 'visible' });
    });

    await shot(desktop, 'demo-widget-chat-effect-desktop', async () => {
      await sendDemoMessage(desktop, keyword);
    });

    await shot(desktop, 'workstation-login-desktop', async () => {
      await desktop.goto(`${BASE_URL.replace(/\/$/, '')}/workstation/`, { waitUntil: 'networkidle' });
      await desktop.locator('.login-card').waitFor({ state: 'visible' });
    });

    await loginWorkstation(desktop);

    await shot(desktop, 'workstation-chat-effect-desktop', async () => {
      await desktop.locator('.app .body').waitFor({ state: 'visible' });
      // 部分匹配：搜索框文案尾部改过（原「/ 编号」已去掉），绑全文会失效
      await desktop.getByPlaceholder(/搜索访客/).fill(keyword);
      // 队列容器类名由 .queue 改为 .queue-scroll
      const firstSession = desktop.locator('.queue-scroll .sess').first();
      await firstSession.waitFor({ state: 'visible', timeout: 15000 });
      await firstSession.click();
      await desktop.getByPlaceholder('输入回复…').fill(`已收到你的咨询（${keyword}），我这边先帮你梳理报价范围。`);
      await desktop.getByRole('button', { name: '发送' }).click();
      await desktop.locator('.row.agent .txt').first().waitFor({ state: 'visible', timeout: 15000 });
    });

    await desktopCtx.close();

    console.log(`done. screenshots are in ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
