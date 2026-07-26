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

export interface AiProviderPreset {
  /** 展示名 */
  label: string;
  /** OpenAI 兼容接口地址；空串表示用 SDK 默认（OpenAI 官方） */
  baseUrl: string;
  /** 未设 AI_MODEL 时使用的默认模型 */
  model: string;
  /** 本地推理等无需鉴权的服务：缺 AI_API_KEY 时用占位串 */
  keyOptional?: boolean;
}

/**
 * 主流厂商预设：都提供 OpenAI 兼容接口，所以只需一套 AI_* 变量。
 * 设 AI_PROVIDER=<key> 即可拿到 baseUrl/model 默认值；AI_BASE_URL / AI_MODEL 可单独覆盖。
 */
export const AI_PROVIDER_PRESETS: Record<string, AiProviderPreset> = {
  openai: { label: 'OpenAI', baseUrl: '', model: 'gpt-4o' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
  },
  zhipu: { label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5' },
  moonshot: { label: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  siliconflow: {
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  xai: { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', model: 'grok-4' },
  ollama: { label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', keyOptional: true },
  custom: { label: '自定义', baseUrl: '', model: 'gpt-4o' },
};

/** 从 base URL 推断 provider（未显式设 AI_PROVIDER 时用），命中预设优先，否则取域名主体。 */
export function inferAiProvider(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (raw === '') return 'openai';
  for (const [key, preset] of Object.entries(AI_PROVIDER_PRESETS)) {
    if (preset.baseUrl && preset.baseUrl.replace(/\/+$/, '') === raw) return key;
  }
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    // api.deepseek.com -> deepseek；dashscope.aliyuncs.com -> dashscope
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return 'custom';
  }
}

/** 合并「预设 + 环境变量覆盖 + 旧变量名兜底」，得出最终 AI 连接参数。 */
export function resolveAiSettings(env: NodeJS.ProcessEnv = process.env) {
  const explicitBaseUrl = env.AI_BASE_URL || env.DEEPSEEK_BASE_URL || '';
  const provider = env.AI_PROVIDER?.trim() || inferAiProvider(explicitBaseUrl);
  const preset = AI_PROVIDER_PRESETS[provider];
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY || env.DEEPSEEK_API_KEY || '';
  return {
    provider,
    providerLabel: preset?.label || provider,
    apiKey: apiKey || (preset?.keyOptional ? 'local' : ''),
    baseUrl: explicitBaseUrl || preset?.baseUrl || '',
    model: env.AI_MODEL || env.OPENAI_MODEL || env.DEEPSEEK_MODEL || preset?.model || 'gpt-4o',
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..', '..');

for (const file of ['.env.local', '.env']) {
  loadEnv({ path: path.join(repoRoot, file) });
}

const aiSettings = resolveAiSettings();

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
  // 任意 OpenAI 兼容服务：AI_PROVIDER 选预设，AI_BASE_URL / AI_MODEL / AI_API_KEY 覆盖。
  // OPENAI_* / DEEPSEEK_* 为旧变量名，仅作向后兼容的兜底。
  aiApiKey: aiSettings.apiKey,
  aiBaseUrl: aiSettings.baseUrl,
  aiModel: aiSettings.model,
  aiProvider: aiSettings.provider,
  dataDir: process.env.DATA_DIR || path.join(repoRoot, 'apps', 'server', 'data'),
  staticDirs: {
    widget: path.join(repoRoot, 'apps', 'widget', 'dist'),
    workstation: path.join(repoRoot, 'apps', 'workstation', 'dist'),
    demo: path.join(repoRoot, 'apps', 'demo', 'dist'),
  },
};
