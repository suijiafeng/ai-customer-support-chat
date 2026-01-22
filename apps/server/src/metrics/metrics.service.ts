import { Injectable } from '@nestjs/common';
import type { Metrics } from '@assistflow/shared';
import { SessionsService } from '../sessions/sessions.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

@Injectable()
export class MetricsService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly tickets: TicketsService
  ) {}

  buildMetrics(): Metrics {
    const sessionList = this.sessions.list();
    const tickets = this.tickets.all;
    const totalSessions = sessionList.length;
    const automatedSessions = sessionList.filter(
      (session) => session.status === 'bot' && !session.needHuman
    ).length;
    const openTicketCount = tickets.filter((ticket) => ticket.status === 'open').length;
    const processingTicketCount = tickets.filter((ticket) => ticket.status === 'processing').length;

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        sessions: totalSessions,
        messages: this.sessions.messageCount,
        tickets: tickets.length,
      },
      queue: {
        waitingHuman: sessionList.filter((session) => session.status === 'waiting_human').length,
        assigned: sessionList.filter((session) => session.status === 'assigned').length,
        closed: sessionList.filter((session) => session.status === 'closed').length,
        highPriority: sessionList.filter((session) => session.priority === 'high').length,
      },
      tickets: {
        open: openTicketCount,
        processing: processingTicketCount,
        resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
        highPriority: tickets.filter((ticket) => ticket.priority === 'high').length,
      },
      ai: {
        automationRate: totalSessions ? Math.round((automatedSessions / totalSessions) * 100) : 100,
        handoffRate: totalSessions
          ? Math.round(
              (sessionList.filter((session) => session.needHuman).length / totalSessions) * 100
            )
          : 0,
      },
      workload: {
        activeTickets: openTicketCount + processingTicketCount,
        activeSessions: sessionList.filter((session) => session.status !== 'closed').length,
      },
    };
  }
}
