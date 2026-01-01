// 访客端标识（会话 ID）管理
// 规则：
//   1. 标识存储在访客浏览器本地（localStorage）
//   2. 不存在时由调用方在「首次发送消息」后惰性生成
//   3. 存储时附带校验和，读取时校验，判断是否被手动篡改/损坏
//   4. 校验异常则视为无效，重新生成
// 注意：浏览器端无法保存真正的密钥，这里的校验和只用于检测「本地存储被改动/损坏」，
//       并非防伪造的安全签名。

const STORE_KEY = (siteKey) => `assistflow.visitor.${siteKey}`;
const ID_PREFIX = 'v-';
const ID_PATTERN = /^v-[a-z0-9]{6,48}$/;

// FNV-1a 轻量校验和，输出 base36 字符串
function checksum(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function isValidFormat(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function generateId() {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function persist(siteKey, id) {
  try {
    window.localStorage.setItem(STORE_KEY(siteKey), JSON.stringify({ id, sig: checksum(id) }));
  } catch {}
}

// 读取并校验本地标识；不存在、格式非法或校验和不符（被篡改）一律返回 null
export function loadVisitorId(siteKey) {
  let raw;
  try {
    raw = window.localStorage.getItem(STORE_KEY(siteKey));
  } catch {
    return null;
  }
  if (!raw) return null;

  // 兼容旧版「纯字符串」格式：迁移为带校验和的结构，保留原有身份
  if (isValidFormat(raw)) {
    persist(siteKey, raw);
    return raw;
  }

  try {
    const data = JSON.parse(raw);
    const id = data?.id;
    const sig = data?.sig;
    if (isValidFormat(id) && sig === checksum(id)) {
      return id;
    }
  } catch {}

  return null; // 校验失败 = 被修改/损坏
}

// 确保有一个合法标识：已存在且未被篡改则复用，否则重新生成并落盘
export function ensureVisitorId(siteKey) {
  const existing = loadVisitorId(siteKey);
  if (existing) return existing;
  const fresh = generateId();
  persist(siteKey, fresh);
  return fresh;
}

// 校验给定标识是否仍与本地存储一致且未被篡改
export function isVisitorIdValid(siteKey, id) {
  return Boolean(id) && loadVisitorId(siteKey) === id;
}
