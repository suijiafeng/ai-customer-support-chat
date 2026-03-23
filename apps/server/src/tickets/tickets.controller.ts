import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { SessionTicketService } from '../workflow/session-ticket.service.js';
import { TicketsService } from './tickets.service.js';

@UseGuards(AgentAuthGuard)
@Controller('api/tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly workflow: SessionTicketService,
    private readonly metrics: MetricsService
  ) {}

  @Get()
  listTickets(@Req() req: any) {
    const agent = req.agent as AuthenticatedAgent;
    const all = this.tickets.list().map((t) => this.workflow.withOwner(t));
    // 普通客服可见：自己的 + 未认领（池中）；管理员可见全部
    const scoped =
      agent.role === 'admin'
        ? all
        : all.filter((t) => t.ownerAgentId === agent.id || t.ownerAgentId == null);
    return { tickets: scoped };
  }

  @Post(':ticketId/notes')
  addNote(@Param('ticketId') ticketId: string, @Body() body: any, @Req() req: any) {
    const agent = req.agent as AuthenticatedAgent;
    const ticket = this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({ error: 'ticket not found' });
    }
    this.workflow.assertCanOperate(ticket, agent);
    const text = String(body?.text || '').trim();
    if (!text) {
      throw new BadRequestException({ error: 'note text required' });
    }
    const updated = this.tickets.addNote(ticket, { agentId: agent.id, agentName: agent.name, text });
    return { ticket: this.workflow.withOwner(updated) };
  }

  @Patch(':ticketId')
  updateTicket(@Param('ticketId') ticketId: string, @Body() body: any, @Req() req: any) {
    const ticket = this.tickets.findById(ticketId);

    if (!ticket) {
      throw new NotFoundException({ error: 'ticket not found' });
    }
    this.workflow.assertCanOperate(ticket, req.agent as AuthenticatedAgent);

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
    const session = this.workflow.syncTicketToSession(updatedTicket);
    this.workflow.notify(updatedTicket.sessionId);

    return {
      ticket: this.workflow.withOwner(updatedTicket),
      session,
      metrics: this.metrics.buildMetrics(),
    };
  }
}
