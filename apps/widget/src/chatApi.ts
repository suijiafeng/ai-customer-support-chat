import type { Message } from '@assistflow/shared';

export const newId = () => crypto.randomUUID();

export type UiMessage = Partial<Message> & {
  id: string;
  from: string;
  content?: string;
  status?: 'sending' | 'failed'; // 访客乐观消息的发送状态
  retryText?: string; // 失败后重试用的原文
};

export interface PendingImage {
  id: string;
  dataUrl: string;
  name: string;
  type: string;
}

export function normalizeMessages(list: any[] = []): UiMessage[] {
  return list.map((message) => ({
    ...message,
    from: message.from || message.actor || 'system',
  }));
}

/**
 * 流式对话：POST /api/chat/stream 返回 SSE。
 * 逐块解析 delta 事件交给 onDelta，结束返回 done 事件的完整响应。
 */
export async function streamChat(
  apiBase: string,
  payload: unknown,
  onDelta: (text: string) => void
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    // 请求根本没到服务端：调用方可以安全重试
    throw Object.assign(new Error(err?.message || 'request failed'), { phase: 'request' });
  }
  if (!response.ok || !response.body) {
    throw Object.assign(new Error(`stream failed: ${response.status}`), {
      phase: 'request',
      status: response.status,
      retryAfter: Number(response.headers.get('retry-after')) || 0,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: any = null;

  const parseSseData = (data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      throw new Error(`invalid stream event data: ${data.slice(0, 120)}`);
    }
  };

  const handleBlock = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];

    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line || line.startsWith(':')) continue; // 空行/注释（心跳）

      // 规范允许 data: 后跟一个空格，去一个即可，不能 trim（会丢 delta 里的空格）
      if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }

    if (!dataLines.length) return;
    const parsed = parseSseData(dataLines.join('\n')); // 多行 data 按规范以换行拼接

    if (event === 'delta') onDelta(parsed.text || '');
    else if (event === 'done') done = parsed;
    else if (event === 'error') throw new Error(parsed?.error || 'stream error');
  };

  const drain = () => {
    let sep: number;
    // 兼容 \n\n 与 \r\n\r\n 分隔
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
      handleBlock(block);
    }
  };

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
  }

  // flush 解码器尾部 + 处理最后一段没有以空行收尾的事件
  buffer += decoder.decode();
  drain();
  if (buffer.trim()) handleBlock(buffer);

  // 流已建立但中途断开/异常：服务端可能已在处理，调用方不应盲目重发
  if (!done) throw Object.assign(new Error('stream ended without done event'), { phase: 'stream' });
  return done;
}
