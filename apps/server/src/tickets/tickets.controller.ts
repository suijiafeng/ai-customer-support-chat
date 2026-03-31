import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Ticket } from '@assistflow/shared';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
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

  /** 工单归属取自其会话的接待客服；响应时附带 ownerAgentId/Name。 */
  private withOwner(ticket: Ticket): Ticket {
    const session = this.sessions.get(ticket.sessionId);
    return {
      ...ticket,
      ownerAgentId: session?.assignedAgentId ?? null,
      ownerAgentName: session?.assignedAgentName ?? null,
    };
  }

  /**
   * 鉴权：管理员可操作任意工单；普通客服可操作「归属自己的」或「未认领（池中）」的工单。
   * 未认领工单对应接待大厅里的会话，谁都可跟进，与会话池一致。
   */
  private assertCanOperate(ticket: Ticket, agent: AuthenticatedAgent) {
    if (agent.role === 'admin') return;
    const ownerId = this.sessions.get(ticket.sessionId)?.assignedAgentId ?? null;
    if (ownerId !== null && ownerId !== agent.id) {
      throw new ForbiddenException({ error: 'ticket belongs to another agent' });
    }
  }

  @Get()
  listTickets(@Req() req: any) {
    const agent = req.agent as AuthenticatedAgent;
    const all = this.tickets.list().map((t) => this.withOwner(t));
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
    this.assertCanOperate(ticket, agent);
    const text = String(body?.text || '').trim();
    if (!text) {
      throw new BadRequestException({ error: 'note text required' });
    }
    const updated = this.tickets.addNote(ticket, { agentId: agent.id, agentName: agent.name, text });
    return { ticket: this.withOwner(updated) };
  }

  @Patch(':ticketId')
  updateTicket(@Param('ticketId') ticketId: string, @Body() body: any, @Req() req: any) {
    const ticket = this.tickets.findById(ticketId);

    if (!ticket) {
      throw new NotFoundException({ error: 'ticket not found' });
    }
    this.assertCanOperate(ticket, req.agent as AuthenticatedAgent);

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
      ticket: this.withOwner(updatedTicket),
      session,
      metrics: this.metrics.buildMetrics(),
    };
  }
}
