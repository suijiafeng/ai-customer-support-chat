import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { LIMITS, TICKET_TRANSITIONS } from '@assistflow/shared';
import type { Inquiry, Ticket } from '@assistflow/shared';
import { extractInquiryId, hasAny, normalize } from '../rules/rules.js';
import { StoreService } from '../store/store.service.js';

/** 工单内存状态 + 状态机 + 写穿透。 */
@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly tickets: Ticket[] = [];
  /** O(1) 按 id 查找索引 */
  private readonly ticketById = new Map<string, Ticket>();
  /** O(1) 按 sessionId 查找索引（Set 保证 O(1) 删除） */
  private readonly ticketsBySession = new Map<string, Set<Ticket>>();

  constructor(private readonly store: StoreService) {}

  onModuleInit() {
    for (const ticket of this.store.getPersisted().tickets) {
      this.insertTicket(ticket);
    }
  }

  /** 内部：同步维护 tickets 数组 + 两个 Map 索引。 */
  private insertTicket(ticket: Ticket): void {
    this.tickets.push(ticket);
    this.ticketById.set(ticket.id, ticket);
    const set = this.ticketsBySession.get(ticket.sessionId);
    if (set) {
      set.add(ticket);
    } else {
      this.ticketsBySession.set(ticket.sessionId, new Set([ticket]));
    }
  }

  /** 内部：从索引中移除最旧的工单（淘汰内存缓存时用）。 */
  private evictOldest(): void {
    const oldest = this.tickets.shift();
    if (!oldest) return;
    this.ticketById.delete(oldest.id);
    const set = this.ticketsBySession.get(oldest.sessionId);
    if (set) {
      set.delete(oldest);
      if (set.size === 0) this.ticketsBySession.delete(oldest.sessionId);
    }
  }

  list(): Ticket[] {
    return this.tickets.slice().reverse();
  }

  get all(): Ticket[] {
    return this.tickets;
  }

  findById(ticketId: string): Ticket | undefined {
    return this.ticketById.get(ticketId);
  }

  getLatestForSession(sessionId: string): Ticket | null {
    const set = this.ticketsBySession.get(sessionId);
    if (!set || set.size === 0) return null;
    return [...set].reduce((latest, t) =>
      new Date(t.updatedAt) > new Date(latest.updatedAt) ? t : latest
    );
  }

  canTransition(currentStatus: string, nextStatus: string): boolean {
    return TICKET_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
  }

  create(params: {
    sessionId: string;
    message: string;
    intent: string;
    reason: string;
    inquiry: Inquiry | null;
  }): Ticket {
    const { sessionId, message, intent, reason, inquiry } = params;
    const inquiryId = inquiry?.id || extractInquiryId(message) || null;
    const set = this.ticketsBySession.get(sessionId);
    const existingTicket = set && [...set].find(
      (ticket) => ticket.status === 'open' && ticket.intent === intent && ticket.inquiryId === inquiryId
    ) || undefined;

    if (existingTicket) {
      existingTicket.lastMessage = message;
      existingTicket.reason = reason;
      existingTicket.updatedAt = new Date().toISOString();
      this.store.saveTicket(existingTicket);
      return existingTicket;
    }

    const priority = hasAny(normalize(message), ['紧急', '尽快', '马上', '今天联系'])
      ? 'high'
      : 'normal';
    const ticket: Ticket = {
      id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
      sessionId,
      status: 'open',
      priority,
      intent,
      reason,
      inquiryId,
      lastMessage: message,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.insertTicket(ticket);
    // 仅淘汰内存缓存，库保留全量工单历史（淘汰项可按需回读）
    while (this.tickets.length > LIMITS.MAX_TICKETS) {
      this.evictOldest();
    }
    this.store.saveTicket(ticket);
    return ticket;
  }

  update(
    ticket: Ticket,
    updates: { status?: string; priority?: string; resolution?: unknown } = {}
  ): Ticket {
    const now = new Date().toISOString();

    if (updates.status) {
      ticket.status = updates.status as Ticket['status'];
    }
    if (updates.priority) {
      ticket.priority = updates.priority as Ticket['priority'];
    }
    if (typeof updates.resolution === 'string' && updates.resolution.trim()) {
      ticket.resolution = updates.resolution.trim().slice(0, 120);
    }

    ticket.updatedAt = now;
    if (ticket.status === 'processing' && !ticket.acceptedAt) {
      ticket.acceptedAt = now;
    }
    if (ticket.status === 'resolved') {
      ticket.resolvedAt = ticket.resolvedAt || now;
    }

    this.store.saveTicket(ticket);
    return ticket;
  }

  /** 追加处理备注（按时间累积，最多保留 50 条）。 */
  addNote(ticket: Ticket, note: { agentId: string; agentName: string; text: string }): Ticket {
    const entry = {
      id: randomUUID(),
      agentId: note.agentId,
      agentName: note.agentName,
      text: note.text.trim().slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    ticket.notes = [...(ticket.notes || []), entry].slice(-50);
    ticket.updatedAt = entry.createdAt;
    this.store.saveTicket(ticket);
    return ticket;
  }

  moveOpenToProcessing(sessionId: string): Ticket | null {
    const set = this.ticketsBySession.get(sessionId);
    const ticket = (set && [...set].find((item) => item.status === 'open')) ?? null;
    if (!ticket) {
      return null;
    }
    return this.update(ticket, { status: 'processing' });
  }

  resolveForSession(sessionId: string, resolution: string): Ticket[] {
    const set = this.ticketsBySession.get(sessionId) ?? new Set<Ticket>();
    return [...set]
      .filter((ticket) => ticket.status !== 'resolved')
      .map((ticket) => this.update(ticket, { status: 'resolved', resolution }));
  }
}
