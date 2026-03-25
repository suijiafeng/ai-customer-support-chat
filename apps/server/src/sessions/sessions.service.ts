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

/**
 * 会话与对话内存状态（运行时事实来源）+ 写穿透。
 * session↔ticket 的同步在这里收口（syncFromTicket / resolve），其他模块不直接改 session。
 */
@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly sessions = new Map<string, Session>();
  private readonly conversations = new Map<string, Message[]>();

  constructor(private readonly store: StoreService) {}

  async onModuleInit() {
    await this.store.whenReady; // 等启动快照就绪（见 StoreService.whenReady）
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

  get sessionCount(): number {
    return this.sessions.size;
  }

  get messageCount(): number {
    return [...this.conversations.values()].reduce((total, messages) => total + messages.length, 0);
  }

  isHumanAssigned(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'assigned';
  }

  /**
   * 某客服能否看到该会话：管理员看全部；普通客服只看公共池（未被认领）+ 自己已认领的。
   * Node 单线程，读写在同一同步函数内，认领无竞态。
   */
  canView(session: Session, agent: { id: string; role: string }): boolean {
    if (agent.role === 'admin') return true;
    return !session.assignedAgentId || session.assignedAgentId === agent.id;
  }


  /**
   * 写穿透封装：库为持久权威源，内存仅作热缓存。
   * 超出上限时只淘汰内存缓存、**不删库**（库保留全量历史，淘汰项可按需回读）。
   */
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

  /**
   * 取会话详情：内存命中直接返回；未命中（已淘汰）从库回读并回填缓存。
   * 让「内存淘汰 / 重启」后历史仍可访问，DB 成为读的权威源。
   */
  async loadDetail(sessionId: string): Promise<{ session: Session | null; messages: Message[] }> {
    let session = this.sessions.get(sessionId) ?? null;
    let messages = this.conversations.get(sessionId);
    if (!session) {
      session = await this.store.loadSession(sessionId);
      if (session) this.sessions.set(sessionId, session); // 回填缓存
    }
    if (messages === undefined) {
      const loaded = await this.store.loadConversation(sessionId);
      if (loaded) {
        messages = loaded;
        this.conversations.set(sessionId, loaded); // 回填缓存
      }
    }
    return { session, messages: messages ?? [] };
  }

  createMessage(params: {
    role: 'user' | 'assistant';
    actor: 'customer' | 'ai' | 'agent';
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
  }): Session {
    const { sessionId, message, workflow, profile, visitor, forceStatus } = params;
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
      workflow,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };

    return this.setSession(session);
  }

  /** 工单状态变化 → 会话状态同步的唯一入口。 */
  syncFromTicket(ticket: Ticket): Session | null {
    const session = this.sessions.get(ticket.sessionId);
    if (!session) {
      return null;
    }

    const isResolved = ticket.status === 'resolved';
    const nextSession: Session = {
      ...session,
      status: isResolved ? 'closed' : ticket.status === 'processing' ? 'assigned' : session.status,
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
    if (profile?.name) {
      return profile.name;
    }
    if (visitor?.code) {
      return `访客 ${visitor.code}`;
    }
    if (inquiryId) {
      return `咨询 ${inquiryId}`;
    }

    const suffix =
      sessionId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() ||
      String(this.sessions.size + 1).padStart(2, '0');
    return `访客 ${suffix}`;
  }

  getSessionsPayload(agent?: { id: string; role: string }): { sessions: SessionSummary[] } {
    const all = [...this.sessions.values()];
    const scoped = agent ? all.filter((session) => this.canView(session, agent)) : all;
    return {
      sessions: scoped.sort(sortSessions).map((session) => ({
        ...session,
        messageCount: this.conversations.get(session.sessionId)?.length || 0,
      })),
    };
  }

  /** 队列 SSE 按客服可见性过滤（推送的是全量快照，按订阅者再裁剪）。 */
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
  if (current?.status === 'closed') {
    return workflow.needHuman ? 'waiting_human' : 'bot';
  }
  if (current?.status === 'assigned') {
    return 'assigned';
  }
  if (workflow.needHuman) {
    return 'waiting_human';
  }

  return current?.status || 'bot';
}

function sortSessions(a: Session, b: Session): number {
  const priorityRank: Record<string, number> = { high: 0, normal: 1 };
  const statusRank: Record<string, number> = { waiting_human: 0, bot: 1, assigned: 2, closed: 3 };
  const rankA = priorityRank[a.priority] ?? 1;
  const rankB = priorityRank[b.priority] ?? 1;

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const statusA = statusRank[a.status] ?? 9;
  const statusB = statusRank[b.status] ?? 9;

  if (statusA !== statusB) {
    return statusA - statusB;
  }

  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

// 仅淘汰内存缓存（库保留全量历史，不在此删库）
function trimMap<K, V>(map: Map<K, V>, maxEntries: number) {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value as K;
    map.delete(firstKey);
  }
}
