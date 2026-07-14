import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

export function parseBooleanEnv(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined || value === null || String(value).trim() === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const raw = (value ?? '').trim();
  if (raw === '') return false;
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..', '..');

for (const file of ['.env.local', '.env']) {
  loadEnv({ path: path.join(repoRoot, file) });
}

export const appConfig = {
  port: Number(process.env.PORT || 3001),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  aiFeatureEnabled: parseBooleanEnv(process.env.AI_ENABLED, false),
  // 静态站点开关（默认全开）：按需关闭后对应路径返回 404，API 不受影响。
  // demo=根路径演示站，widget=/widget 嵌入脚本，workstation=/workstation 客服工作台。
  // 拆分部署（前端走 CDN/独立容器）时通常全关，server 只保留 API。
  demoEnabled: parseBooleanEnv(process.env.DEMO_ENABLED, true),
  widgetEnabled: parseBooleanEnv(process.env.WIDGET_ENABLED, true),
  workstationEnabled: parseBooleanEnv(process.env.WORKSTATION_ENABLED, true),
  aiProvider: process.env.AI_PROVIDER || 'openai',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  dataDir: process.env.DATA_DIR || path.join(repoRoot, 'apps', 'server', 'data'),
  staticDirs: {
    widget: path.join(repoRoot, 'apps', 'widget', 'dist'),
    workstation: path.join(repoRoot, 'apps', 'workstation', 'dist'),
    demo: path.join(repoRoot, 'apps', 'demo', 'dist'),
  },
};
