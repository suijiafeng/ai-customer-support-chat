import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { LIMITS } from '@assistflow/shared';
import type {
  Attachment,
  Message,
  Profile,
  Session,
  SessionSummary,
  Ticket,
  VisitorInfo,
  Workflow,
} from '@assistflow/shared';
import { extractInquiryId } from '../rules/rules.js';
import { inferVisitorFromSessionId } from '../common/normalize.js';
import { StoreService } from '../store/store.service.js';

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly sessions = new Map<string, Session>();
  private readonly conversations = new Map<string, Message[]>();

  constructor(private readonly store: StoreService) {}

  async onModuleInit() {
    await this.store.whenReady;
    const persisted = this.store.getPersisted();
    for (const [id, data] of persisted.sessions) this.sessions.set(id, data);
    for (const [id, messages] of persisted.conversations) this.conversations.set(id, messages);
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getMessages(sessionId: string): Message[] {
    return this.conversations.get(sessionId) || [];
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  get messageCount(): number {
    return [...this.conversations.values()].reduce((total, messages) => total + messages.length, 0);
  }

  isHumanAssigned(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'assigned';
  }

  /**
   * 人工侧静默了多久（毫秒）：从「最后一条客服消息」算起，没有客服消息则从接管时刻算起。
   * 注意不能用 session.updatedAt——访客每发一条都会刷新它，那样永远等不到超时。
   */
  humanIdleMs(sessionId: string, now = Date.now()): number {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'assigned') return 0;
    const messages = this.conversations.get(sessionId) || [];
    const lastAgentAt = [...messages].reverse().find((m) => m.actor === 'agent')?.createdAt;
    const since = lastAgentAt || session.assignedAt || session.updatedAt;
    const sinceMs = new Date(since).getTime();
    return Number.isFinite(sinceMs) ? Math.max(0, now - sinceMs) : 0;
  }

  /** 把会话从人工交还给 AI：清空归属并回到 bot 状态（超时自动 / 访客主动都走这里）。 */
  releaseToBot(sessionId: string, reason: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.setSession({
      ...session,
      status: 'bot',
      assignedAgentId: null,
      assignedAgentName: null,
      assignedAt: null,
      needHuman: false,
      reason,
      updatedAt: new Date().toISOString(),
    });
  }

  /** 距上一条系统提示是否已超过冷却时间（避免访客每发一条就刷一条提示）。 */
  canPostSystemNotice(sessionId: string, cooldownMs: number, now = Date.now()): boolean {
    if (cooldownMs <= 0) return true;
    const messages = this.conversations.get(sessionId) || [];
    const lastNoticeAt = [...messages].reverse().find((m) => m.actor === 'system')?.createdAt;
    if (!lastNoticeAt) return true;
    const ts = new Date(lastNoticeAt).getTime();
    return !Number.isFinite(ts) || now - ts >= cooldownMs;
  }

  canView(session: Session, agent: { id: string; role: string }): boolean {
    if (agent.role === 'admin') return true;
    return !session.assignedAgentId || session.assignedAgentId === agent.id;
  }

  setSession(session: Session): Session {
    this.sessions.set(session.sessionId, session);
    this.store.saveSession(session);
    trimMap(this.sessions, LIMITS.MAX_SESSIONS);
    return session;
  }

  setConversation(sessionId: string, messages: Message[]): Message[] {
    this.conversations.set(sessionId, messages);
    this.store.saveConversation(sessionId, messages);
    trimMap(this.conversations, LIMITS.MAX_CONVERSATIONS);
    return messages;
  }

  async loadDetail(sessionId: string): Promise<{ session: Session | null; messages: Message[] }> {
    let session = this.sessions.get(sessionId) ?? null;
    let messages = this.conversations.get(sessionId);
    if (!session) {
      session = await this.store.loadSession(sessionId);
      if (session) this.sessions.set(sessionId, session);
    }
    if (messages === undefined) {
      const loaded = await this.store.loadConversation(sessionId);
      if (loaded) {
        messages = loaded;
        this.conversations.set(sessionId, loaded);
      }
    }
    return { session, messages: messages ?? [] };
  }

  createMessage(params: {
    role: 'user' | 'assistant';
    actor: 'customer' | 'ai' | 'agent' | 'system';
    content: string;
    agentId?: string | null;
    agentName?: string | null;
    attachments?: Attachment[];
    clientMessageId?: string | null;
  }): Message {
    return {
      id: randomUUID(),
      clientMessageId: params.clientMessageId ?? null,
      role: params.role,
      actor: params.actor,
      content: params.content,
      agentId: params.agentId ?? null,
      agentName: params.agentName ?? null,
      attachments: params.attachments ?? [],
      createdAt: new Date().toISOString(),
    };
  }

  appendMessages(currentMessages: Message[], ...nextMessages: Message[]): Message[] {
    return [...currentMessages, ...nextMessages].slice(-LIMITS.MAX_MESSAGES_PER_SESSION);
  }

  upsertSession(params: {
    sessionId: string;
    message: string;
    workflow: Workflow;
    profile?: Profile | null;
    visitor?: VisitorInfo | null;
    forceStatus?: Session['status'];
    tenantKey?: string | null;
  }): Session {
    const { sessionId, message, workflow, profile, visitor, forceStatus, tenantKey } = params;
    const now = new Date().toISOString();
    const current = this.sessions.get(sessionId);
    const nextProfile = profile || current?.profile || null;
    const nextVisitor = visitor || current?.visitor || inferVisitorFromSessionId(sessionId);
    const status = forceStatus || resolveSessionStatus(current, workflow);
    const keepHighPriority = current?.priority === 'high' && current?.status !== 'closed';
    const priority = keepHighPriority || workflow.needHuman ? 'high' : 'normal';
    const inquiryId = workflow.inquiry?.id || current?.inquiryId || extractInquiryId(message) || null;
    const displayName = this.buildDisplayName(sessionId, inquiryId, nextProfile, nextVisitor);
    const session: Session = {
      sessionId,
      displayName,
      profile: nextProfile,
      visitor: nextVisitor,
      status,
      priority,
      lastMessage: message,
      lastIntent: workflow.intent,
      sentiment: workflow.sentiment,
      needHuman: workflow.needHuman,
      reason: workflow.reason,
      inquiryId,
      ticketId: workflow.ticket?.id || current?.ticketId || null,
      assignedAgentId: status === 'assigned' ? current?.assignedAgentId || null : null,
      assignedAgentName: status === 'assigned' ? current?.assignedAgentName || null : null,
      assignedAt: status === 'assigned' ? current?.assignedAt || now : null,
      workflow,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      tenantKey: tenantKey ?? current?.tenantKey ?? null,
    };
    return this.setSession(session);
  }

  syncFromTicket(ticket: Ticket): Session | null {
    const session = this.sessions.get(ticket.sessionId);
    if (!session) return null;
    const isResolved = ticket.status === 'resolved';
    const nextSession: Session = {
      ...session,
      status: isResolved ? 'closed' : ticket.status === 'processing' ? 'assigned' : session.status,
      assignedAt: isResolved
        ? null
        : ticket.status === 'processing'
          ? session.assignedAt || new Date().toISOString()
          : session.assignedAt,
      priority: ticket.priority,
      needHuman: isResolved ? false : session.needHuman,
      reason: ticket.resolution || session.reason,
      ticketId: ticket.id,
      workflow: session.workflow
        ? {
            ...session.workflow,
            needHuman: isResolved ? false : session.workflow.needHuman,
            reason: ticket.resolution || session.workflow.reason,
            ticket,
          }
        : session.workflow,
      resolvedAt: isResolved ? ticket.resolvedAt : session.resolvedAt,
      updatedAt: new Date().toISOString(),
    };
    return this.setSession(nextSession);
  }

  createEmptySession(sessionId: string): Session {
    const now = new Date().toISOString();
    return {
      sessionId,
      displayName: this.buildDisplayName(sessionId, null, null, inferVisitorFromSessionId(sessionId)),
      profile: null,
      visitor: inferVisitorFromSessionId(sessionId),
      status: 'bot',
      priority: 'normal',
      lastMessage: '',
      lastIntent: 'general',
      sentiment: 'neutral',
      needHuman: false,
      reason: '',
      inquiryId: null,
      ticketId: null,
      assignedAgentId: null,
      assignedAgentName: null,
      workflow: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  buildDisplayName(
    sessionId: string,
    inquiryId: string | null,
    profile: Profile | null,
    visitor: VisitorInfo | null
  ): string {
    if (profile?.name) return profile.name;
    if (visitor?.code) return `访客 ${visitor.code}`;
    if (inquiryId) return `咨询 ${inquiryId}`;
    const suffix =
      sessionId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() ||
      String(this.sessions.size + 1).padStart(2, '0');
    return `访客 ${suffix}`;
  }

  getSessionsPayload(agent?: { id: string; role: string }): { sessions: SessionSummary[] } {
    const all = [...this.sessions.values()];
    const scoped = agent ? all.filter((session) => this.canView(session, agent)) : all;
    return {
      sessions: scoped.sort(sortSessions).map((session) => {
        const msgs = this.conversations.get(session.sessionId);
        return {
          ...session,
          messageCount: msgs?.length || 0,
          // 系统提示不算「有人回复过」，否则队列里会把仍在等客服的会话标成已回复
          lastMessageRole: lastHumanRole(msgs),
        };
      }),
    };
  }

  filterPayloadForAgent(
    payload: { sessions: SessionSummary[] },
    agent: { id: string; role: string }
  ): { sessions: SessionSummary[] } {
    if (agent.role === 'admin') return payload;
    return { sessions: payload.sessions.filter((session) => this.canView(session, agent)) };
  }

  getSessionPayload(sessionId: string): { session: Session | null; messages: Message[] } {
    return {
      session: this.sessions.get(sessionId) || null,
      messages: this.conversations.get(sessionId) || [],
    };
  }
}

function resolveSessionStatus(current: Session | undefined, workflow: Workflow): Session['status'] {
  if (current?.status === 'closed') return workflow.needHuman ? 'waiting_human' : 'bot';
  if (current?.status === 'assigned') return 'assigned';
  if (workflow.needHuman) return 'waiting_human';
  return current?.status || 'bot';
}

/** 最后一条非系统消息的发送方：user=访客在等回复，assistant=AI/客服已回过 */
function lastHumanRole(messages: Message[] | undefined): 'user' | 'assistant' | null {
  const last = [...(messages || [])].reverse().find((m) => m.actor !== 'system');
  return last?.role ?? null;
}

function sortSessions(a: Session, b: Session): number {
  const priorityRank: Record<string, number> = { high: 0, normal: 1 };
  const statusRank: Record<string, number> = { waiting_human: 0, bot: 1, assigned: 2, closed: 3 };
  const rankA = priorityRank[a.priority] ?? 1;
  const rankB = priorityRank[b.priority] ?? 1;
  if (rankA !== rankB) return rankA - rankB;
  const statusA = statusRank[a.status] ?? 9;
  const statusB = statusRank[b.status] ?? 9;
  if (statusA !== statusB) return statusA - statusB;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function trimMap<K, V>(map: Map<K, V>, maxEntries: number) {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value as K;
    map.delete(firstKey);
  }
}
