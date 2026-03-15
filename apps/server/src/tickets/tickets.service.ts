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

  constructor(private readonly store: StoreService) {}

  onModuleInit() {
    this.tickets.push(...this.store.getPersisted().tickets);
  }

  list(): Ticket[] {
    return this.tickets.slice().reverse();
  }

  get all(): Ticket[] {
    return this.tickets;
  }

  findById(ticketId: string): Ticket | undefined {
    return this.tickets.find((item) => item.id === ticketId);
  }

  getLatestForSession(sessionId: string): Ticket | null {
    return (
      this.tickets
        .filter((ticket) => ticket.sessionId === sessionId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null
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
    const existingTicket = this.tickets.find((ticket) => {
      return (
        ticket.status === 'open' &&
        ticket.sessionId === sessionId &&
        ticket.intent === intent &&
        ticket.inquiryId === inquiryId
      );
    });

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

    this.tickets.push(ticket);
    // 仅淘汰内存缓存，库保留全量工单历史（淘汰项可按需回读）
    if (this.tickets.length > LIMITS.MAX_TICKETS) {
      this.tickets.splice(0, this.tickets.length - LIMITS.MAX_TICKETS);
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
    const ticket = this.tickets.find((item) => item.sessionId === sessionId && item.status === 'open');
    if (!ticket) {
      return null;
    }
    return this.update(ticket, { status: 'processing' });
  }

  resolveForSession(sessionId: string, resolution: string): Ticket[] {
    return this.tickets
      .filter((ticket) => ticket.sessionId === sessionId && ticket.status !== 'resolved')
      .map((ticket) => this.update(ticket, { status: 'resolved', resolution }));
  }
}
