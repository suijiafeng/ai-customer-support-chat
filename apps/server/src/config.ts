import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

/** 解析布尔环境变量；空值返回默认值。 */
export function parseBooleanEnv(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/config.js → apps/server/dist → 仓库根目录
export const repoRoot = path.resolve(__dirname, '..', '..', '..');

// 加载 env 文件，固定在仓库根目录（与 cwd 无关）。
// 优先级（高 → 低）：真实环境变量 > .env.local > .env（兜底）
// dotenv 默认不覆盖已存在的变量，因此先加载 .env.local、再加载 .env。
for (const file of ['.env.local', '.env']) {
  loadEnv({ path: path.join(repoRoot, file) });
}

export const appConfig = {
  port: Number(process.env.PORT || 3001),
  aiFeatureEnabled: parseBooleanEnv(process.env.AI_ENABLED, false),
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
