// 后端基地址：与工作台同源，留空即可
export const API = '';

export const newId = () => crypto.randomUUID();

export async function requestJson(url, options) {
  const response = await fetch(`${API}${url}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || `request failed: ${response.status}`);
  return data;
}

// 开发者身份（本轮先用本地身份占位，下一轮接 JWT 登录替换）
// ID 持久化到 localStorage，刷新/重开后保持同一开发者身份
export function stableAgentId() {
  try {
    let id = localStorage.getItem('assistflow-agent-id');
    if (!id) {
      id = 'agent-' + crypto.randomUUID().slice(0, 8);
      localStorage.setItem('assistflow-agent-id', id);
    }
    return id;
  } catch {
    return 'agent-' + crypto.randomUUID().slice(0, 8);
  }
}

// 服务端消息字段是 actor/role，统一补出 from 供 UI 区分左右
export function normalizeMessages(list = []) {
  return list.map((m) => ({ ...m, from: m.from || m.actor || 'system' }));
}

export const statusTag = (s) =>
  ({ bot: 'info', waiting_human: 'warning', assigned: 'success', resolved: 'info', closed: 'info' }[s] || 'info');

export const statusText = (s) =>
  ({ bot: 'AI 回答', waiting_human: '待本人跟进', assigned: '本人沟通中', resolved: '已解决', closed: '已关闭' }[s] || s);

// 图片附件：转 data URL，供发送使用
export function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve({ id: newId(), dataUrl: r.result, name: file.name || 'image', type: file.type });
    r.readAsDataURL(file);
  });
}

export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 750 * 1024;

// 时间戳格式化为 HH:MM
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 将纯文本切分为 文本/链接 片段，供安全渲染可点击链接
const URL_RE = /(https?:\/\/[^\s]+)/g;
export function linkParts(text) {
  const parts = [];
  let last = 0; let match;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push({ link: false, value: text.slice(last, match.index) });
    parts.push({ link: true, value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ link: false, value: text.slice(last) });
  return parts;
}
