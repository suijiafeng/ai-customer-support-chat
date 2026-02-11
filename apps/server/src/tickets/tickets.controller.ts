import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { SseService } from '../sse/sse.service.js';
import { TicketsService } from './tickets.service.js';

@UseGuards(AgentAuthGuard)
@Controller('api/tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly sessions: SessionsService,
    private readonly metrics: MetricsService,
    private readonly sse: SseService
  ) {}

  @Get()
  listTickets() {
    return { tickets: this.tickets.list() };
  }

  @Patch(':ticketId')
  updateTicket(@Param('ticketId') ticketId: string, @Body() body: any) {
    const ticket = this.tickets.findById(ticketId);

    if (!ticket) {
      throw new NotFoundException({ error: 'ticket not found' });
    }

    const nextStatus = body?.status ? String(body.status) : ticket.status;
    const nextPriority = body?.priority ? String(body.priority) : ticket.priority;

    if (!['open', 'processing', 'resolved'].includes(nextStatus)) {
      throw new BadRequestException({ error: 'invalid ticket status' });
    }
    if (!this.tickets.canTransition(ticket.status, nextStatus)) {
      throw new ConflictException({
        error: 'invalid ticket transition',
        currentStatus: ticket.status,
        nextStatus,
      });
    }
    if (!['normal', 'high'].includes(nextPriority)) {
      throw new BadRequestException({ error: 'invalid ticket priority' });
    }

    const updatedTicket = this.tickets.update(ticket, {
      status: nextStatus,
      priority: nextPriority,
      resolution: body?.resolution,
    });
    const session = this.sessions.syncFromTicket(updatedTicket);

    this.sse.notifyQueue(this.sessions.getSessionsPayload());
    if (updatedTicket.sessionId) {
      this.sse.notifySession(
        updatedTicket.sessionId,
        this.sessions.getSessionPayload(updatedTicket.sessionId)
      );
    }

    return {
      ticket: updatedTicket,
      session,
      metrics: this.metrics.buildMetrics(),
    };
  }
}
