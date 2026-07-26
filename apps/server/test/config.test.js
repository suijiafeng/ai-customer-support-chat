import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooleanEnv, parseTrustProxy, resolveAiSettings, inferAiProvider } from '../dist/config.js';

test('parseBooleanEnv defaults to enabled', () => {
  assert.equal(parseBooleanEnv(undefined), true);
  assert.equal(parseBooleanEnv(''), true);
});

test('parseBooleanEnv supports common enabled and disabled values', () => {
  assert.equal(parseBooleanEnv('true'), true);
  assert.equal(parseBooleanEnv('1'), true);
  assert.equal(parseBooleanEnv('on'), true);
  assert.equal(parseBooleanEnv('false'), false);
  assert.equal(parseBooleanEnv('0'), false);
  assert.equal(parseBooleanEnv('off'), false);
});

test('parseBooleanEnv uses the provided default for invalid values', () => {
  assert.equal(parseBooleanEnv('invalid', false), false);
});

test('parseTrustProxy defaults to false when unset (direct deployment, anti-spoof)', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('   '), false);
});

test('parseTrustProxy parses hop count, booleans and presets', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
});

test('resolveAiSettings 用 AI_PROVIDER 预设补齐 baseUrl 与模型', () => {
  const s = resolveAiSettings({ AI_PROVIDER: 'qwen', AI_API_KEY: 'sk-x' });
  assert.equal(s.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(s.model, 'qwen-plus');
  assert.equal(s.apiKey, 'sk-x');
});

test('resolveAiSettings 中 AI_BASE_URL / AI_MODEL 覆盖预设', () => {
  const s = resolveAiSettings({
    AI_PROVIDER: 'deepseek',
    AI_BASE_URL: 'https://gateway.internal/v1',
    AI_MODEL: 'my-model',
  });
  assert.equal(s.baseUrl, 'https://gateway.internal/v1');
  assert.equal(s.model, 'my-model');
});

test('resolveAiSettings 兼容旧的 OPENAI_/DEEPSEEK_ 变量名', () => {
  const s = resolveAiSettings({ DEEPSEEK_API_KEY: 'sk-old', DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-chat' });
  assert.equal(s.provider, 'deepseek');
  assert.equal(s.apiKey, 'sk-old');
  assert.equal(s.model, 'deepseek-chat');
});

test('resolveAiSettings 对 ollama 免 Key，未配置时无 Key', () => {
  assert.equal(resolveAiSettings({ AI_PROVIDER: 'ollama' }).apiKey, 'local');
  assert.equal(resolveAiSettings({}).apiKey, '');
  assert.equal(resolveAiSettings({}).provider, 'openai');
});

test('inferAiProvider 命中预设优先，其次取域名主体', () => {
  assert.equal(inferAiProvider('https://api.deepseek.com'), 'deepseek');
  assert.equal(inferAiProvider('https://api.moonshot.cn/v1/'), 'moonshot');
  assert.equal(inferAiProvider('https://llm.corp.example.com/v1'), 'example');
  assert.equal(inferAiProvider(''), 'openai');
});
