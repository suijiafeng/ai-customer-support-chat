import React from 'react';

// 轻量安全 Markdown 渲染：解析为 React 节点（不使用 dangerouslySetInnerHTML，天然防 XSS）。
// 支持常见 AI 输出：标题、有/无序列表、围栏代码块、行内代码、粗体、斜体、链接、段落与换行。

const URL_RE = /(https?:\/\/[^\s]+)/g;

// 行内：按 代码`` > 链接 > 粗体** > 斜体* 顺序切分为节点
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 先按行内代码分段，代码段内不再二次解析
  const codeParts = text.split(/(`[^`]+`)/g);
  codeParts.forEach((part, ci) => {
    if (/^`[^`]+`$/.test(part)) {
      nodes.push(<code key={`${keyPrefix}-c${ci}`} className="md-code">{part.slice(1, -1)}</code>);
      return;
    }
    let rest = part;
    let mi = 0;
    // 粗体 **x**
    const boldSplit = rest.split(/(\*\*[^*]+\*\*)/g);
    boldSplit.forEach((seg, bi) => {
      if (/^\*\*[^*]+\*\*$/.test(seg)) {
        nodes.push(<strong key={`${keyPrefix}-b${ci}-${bi}`}>{seg.slice(2, -2)}</strong>);
        return;
      }
      // 斜体 *x*
      const italSplit = seg.split(/(\*[^*]+\*)/g);
      italSplit.forEach((s2, ii) => {
        if (/^\*[^*]+\*$/.test(s2)) {
          nodes.push(<em key={`${keyPrefix}-i${ci}-${bi}-${ii}`}>{s2.slice(1, -1)}</em>);
          return;
        }
        // 链接
        URL_RE.lastIndex = 0;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = URL_RE.exec(s2)) !== null) {
          if (m.index > last) nodes.push(<span key={`${keyPrefix}-t${mi++}`}>{s2.slice(last, m.index)}</span>);
          nodes.push(
            <a key={`${keyPrefix}-l${mi++}`} href={m[0]} target="_blank" rel="noopener noreferrer">{m[0]}</a>
          );
          last = m.index + m[0].length;
        }
        if (last < s2.length) nodes.push(<span key={`${keyPrefix}-t${mi++}`}>{s2.slice(last)}</span>);
      });
    });
  });
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块 ```
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // 跳过结束 ```
      blocks.push(<pre key={key++} className="md-pre"><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    // 标题 #..######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <div key={key++} className={`md-h md-h${level}`}>{renderInline(h[2], `h${key}`)}</div>
      );
      i++;
      continue;
    }

    // 列表（连续的 - / * / 数字.）
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        items.push(<li key={items.length}>{renderInline(content, `li${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(ordered
        ? <ol key={key++} className="md-list">{items}</ol>
        : <ul key={key++} className="md-list">{items}</ul>);
      continue;
    }

    // 空行跳过
    if (line.trim() === '') { i++; continue; }

    // 普通段落：合并连续非空行
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i].trim())
      && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    blocks.push(
      <p key={key++} className="md-p">
        {para.map((l, li) => (
          <React.Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(l, `p${key}-${li}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="md">{blocks}</div>;
}
