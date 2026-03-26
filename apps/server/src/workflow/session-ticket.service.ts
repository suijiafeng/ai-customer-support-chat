import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Session, Ticket } from '@assistflow/shared';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { SseService } from '../sse/sse.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

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

  withOwner(ticket: Ticket): Ticket {
    const session = this.sessions.get(ticket.sessionId);
    return {
      ...ticket,
      ownerAgentId: session?.assignedAgentId ?? null,
      ownerAgentName: session?.assignedAgentName ?? null,
    };
  }

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
