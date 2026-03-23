import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Session, Ticket } from '@assistflow/shared';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { SseService } from '../sse/sse.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

/**
 * 会话 ↔ 工单的级联规则收口在这里：谁先接（moveOpenToProcessing）、
 * 谁标记解决（resolveForSession）、工单归属/操作鉴权派生自会话归属、
 * 工单变更反向同步会话（syncFromTicket）、以及三处重复的 SSE 通知模式。
 * SessionsController/TicketsController 不再互相直接注入对方的 Service。
 */
@Injectable()
export class SessionTicketService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly tickets: TicketsService,
    private readonly sse: SseService
  ) {}

  notify(sessionId: string): void {
    this.sse.notifySession(sessionId, this.sessions.getSessionPayload(sessionId));
    this.sse.notifyQueue(this.sessions.getSessionsPayload());
  }

  resolvedTicketsForSession(sessionId: string): Ticket[] {
    return this.tickets.all.filter((t) => t.sessionId === sessionId && t.status === 'resolved');
  }

  resolveSessionTickets(sessionId: string, resolution: string): Ticket[] {
    return this.tickets.resolveForSession(sessionId, resolution);
  }

  advanceTicketOnFirstReply(sessionId: string): Ticket | null {
    return this.tickets.moveOpenToProcessing(sessionId);
  }

  /** 工单归属取自其会话的接待客服 */
  withOwner(ticket: Ticket): Ticket {
    const session = this.sessions.get(ticket.sessionId);
    return {
      ...ticket,
      ownerAgentId: session?.assignedAgentId ?? null,
      ownerAgentName: session?.assignedAgentName ?? null,
    };
  }

  /** 管理员可操作任意工单；普通客服可操作「归属自己的」或「未认领（池中）」的工单 */
  assertCanOperate(ticket: Ticket, agent: AuthenticatedAgent): void {
    if (agent.role === 'admin') return;
    const ownerId = this.sessions.get(ticket.sessionId)?.assignedAgentId ?? null;
    if (ownerId !== null && ownerId !== agent.id) {
      throw new ForbiddenException({ error: 'ticket belongs to another agent' });
    }
  }

  syncTicketToSession(ticket: Ticket): Session | null {
    return this.sessions.syncFromTicket(ticket);
  }
}
