/**
 * 对话本地归档：服务端内存只保留每会话最近 MAX_MESSAGES_PER_SESSION 条（热窗口），
 * 溢出的旧消息由会话双方（访客 widget / 客服工作台）各自归档到浏览器 localStorage。
 * 渲染时「本地归档 ∪ 服务端窗口」按时间合并去重，双方都能看到完整历史，
 * 服务端重启或内存淘汰也不会让界面上的记录消失。
 *
 * 体积控制：图片附件不入档（降级为 [图片] 占位），每会话保留最近 maxMessages 条，
 * 归档会话总数按 LRU 保留 maxSessions 个。
 */

export interface ArchivedMessage {
  id: string;
  role?: string;
  actor?: string;
  content: string;
  agentId?: string | null;
  agentName?: string | null;
  createdAt?: string;
  /** 原消息带图片附件（附件本体不入档） */
  hasAttachments?: boolean;
}

export interface MessageArchive {
  /** 合并一批服务端消息进归档并落盘，返回「归档 ∪ 本批」的完整时间线 */
  merge(sessionId: string, messages: any[]): ArchivedMessage[];
  /** 读取某会话的归档 */
  load(sessionId: string): ArchivedMessage[];
}

export interface ArchiveOptions {
  /** 每会话归档条数上限 */
  maxMessages?: number;
  /** 归档会话数上限（LRU 淘汰最久未活跃的） */
  maxSessions?: number;
}

/** 仅归档服务端确认过的消息（有 actor 字段），跳过前端乐观渲染的临时消息 */
function toArchived(message: any): ArchivedMessage | null {
  if (!message?.id || !message?.actor) return null;
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  return {
    id: String(message.id),
    role: message.role,
    actor: message.actor,
    content: String(message.content || '') || (hasAttachments ? '[图片]' : ''),
    agentId: message.agentId ?? null,
    agentName: message.agentName ?? null,
    createdAt: message.createdAt,
    ...(hasAttachments ? { hasAttachments: true } : {}),
  };
}

function sortByTime(a: ArchivedMessage, b: ArchivedMessage): number {
  return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
}

export function createMessageArchive(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  namespace: string,
  { maxMessages = 300, maxSessions = 50 }: ArchiveOptions = {}
): MessageArchive {
  const sessionKey = (sessionId: string) => `${namespace}.${sessionId}`;
  const indexKey = `${namespace}.index`;

  const readJson = <T>(key: string, fallback: T): T => {
    try {
      const raw = storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key: string, value: unknown) => {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      /* 配额满等异常：归档失败不影响聊天 */
    }
  };

  // LRU 索引：记录归档过的会话，超限删最久未活跃的归档
  const touchIndex = (sessionId: string) => {
    const index = readJson<string[]>(indexKey, []).filter((id) => id !== sessionId);
    index.push(sessionId);
    while (index.length > maxSessions) {
      const evicted = index.shift();
      if (evicted) {
        try {
          storage?.removeItem(sessionKey(evicted));
        } catch {}
      }
    }
    writeJson(indexKey, index);
  };

  return {
    load(sessionId: string): ArchivedMessage[] {
      return readJson<ArchivedMessage[]>(sessionKey(sessionId), []);
    },

    merge(sessionId: string, messages: any[]): ArchivedMessage[] {
      const incoming = (Array.isArray(messages) ? messages : [])
        .map(toArchived)
        .filter((m): m is ArchivedMessage => m !== null);
      const existing = this.load(sessionId);

      const byId = new Map<string, ArchivedMessage>();
      for (const msg of existing) byId.set(msg.id, msg);
      for (const msg of incoming) byId.set(msg.id, msg); // 服务端最新版本覆盖旧档

      const merged = [...byId.values()].sort(sortByTime);
      const trimmed = merged.slice(-maxMessages);

      if (incoming.length) {
        writeJson(sessionKey(sessionId), trimmed);
        touchIndex(sessionId);
      }
      return trimmed;
    },
  };
}
