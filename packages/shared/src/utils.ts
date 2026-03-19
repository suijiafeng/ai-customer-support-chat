/** 跨端共享工具函数（UI 渲染辅助） */

/** 将 ISO 时间戳格式化为 HH:MM（24 小时制，中文 locale）。无效输入返回空字符串。 */
export function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export interface LinkPart {
  link: boolean;
  value: string;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** 将纯文本切分为「文本片段 / 链接片段」数组，供安全渲染可点击链接使用。 */
export function linkParts(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push({ link: false, value: text.slice(last, match.index) });
    parts.push({ link: true, value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ link: false, value: text.slice(last) });
  return parts;
}
