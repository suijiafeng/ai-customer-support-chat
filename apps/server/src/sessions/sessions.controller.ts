import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import type { Session } from '@assistflow/shared';
import { map } from 'rxjs';
import { MetricsService } from '../metrics/metrics.service.js';
import { normalizeAgent, normalizeAttachments, normalizeProfile } from '../common/normalize.js';
import { SseService } from '../sse/sse.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { SessionsService } from './sessions.service.js';

@Controller('api/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly tickets: TicketsService,
    private readonly metrics: MetricsService,
    private readonly sse: SseService
  ) {}

  @Get()
  listSessions() {
    return this.sessions.getSessionsPayload();
  }

  @Sse('events')
  queueEvents() {
    return this.sse
      .queueStream(this.sessions.getSessionsPayload())
      .pipe(map((event) => ({ type: event.type, data: event.data as object })));
  }

  @Get(':sessionId')
  getSession(@Param('sessionId') sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException({ error: 'session not found' });
    }
    return {
      session,
      messages: this.sessions.getMessages(sessionId),
    };
  }

  @Sse(':sessionId/events')
  sessionEvents(@Param('sessionId') sessionId: string) {
    return this.sse
      .sessionStream(sessionId, this.sessions.getSessionPayload(sessionId))
      .pipe(map((event) => ({ type: event.type, data: event.data as object })));
  }

  @Post(':sessionId/resolve')
  resolveSession(@Param('sessionId') sessionId: string, @Body() body: any) {
    const session = this.sessions.get(sessionId);
    const resolution = String(body?.resolution || '开发者本人已标记解决').trim().slice(0, 120);

    if (!session) {
      throw new NotFoundException({ error: 'session not found' });
    }

    if (session.status === 'closed') {
      return {
        session,
        tickets: this.tickets.all.filter(
          (ticket) => ticket.sessionId === sessionId && ticket.status === 'resolved'
        ),
        metrics: this.metrics.buildMetrics(),
      };
    }

    const resolvedTickets = this.tickets.resolveForSession(sessionId, resolution);
    const updatedSession: Session = {
      ...session,
      status: 'closed',
      needHuman: false,
      reason: resolution,
      workflow: session.workflow
        ? {
            ...session.workflow,
            needHuman: false,
            reason: resolution,
            ticket: resolvedTickets[0] || session.workflow.ticket || null,
          }
        : session.workflow,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.setSession(updatedSession);
    this.notify(sessionId);

    return {
      session: updatedSession,
      tickets: resolvedTickets,
      metrics: this.metrics.buildMetrics(),
    };
  }

  @Post(':sessionId/messages')
  postMessage(@Param('sessionId') sessionId: string, @Body() body: any) {
    const actor = body?.actor === 'customer' ? 'customer' : 'agent';
    const session = this.sessions.get(sessionId);
    const content = String(body?.content || '').trim();
    const agent = normalizeAgent(body?.agent);
    const attachments = normalizeAttachments(body?.attachments);

    if (!session) {
      throw new NotFoundException({ error: 'session not found' });
    }
    if (!content && attachments.length === 0) {
      throw new BadRequestException({ error: 'content or attachments required' });
    }
    if (actor === 'customer') {
      throw new BadRequestException({ error: 'customer messages must use /api/chat' });
    }
    if (session.assignedAgentId && session.assignedAgentId !== agent.id) {
      throw new ConflictException({
        error: 'session is assigned to another agent',
        assignedAgentId: session.assignedAgentId,
        assignedAgentName: session.assignedAgentName,
      });
    }

    const currentMessages = this.sessions.getMessages(sessionId);
    const nextMessages = this.sessions.appendMessages(
      currentMessages,
      this.sessions.createMessage({
        role: 'assistant',
        actor: 'agent',
        content,
        agentId: agent.id,
        agentName: agent.name,
        attachments,
      })
    );
    const linkedTicket = this.tickets.moveOpenToProcessing(sessionId);
    const updatedSession: Session = {
      ...session,
      status: 'assigned',
      assignedAgentId: session.assignedAgentId || agent.id,
      assignedAgentName: session.assignedAgentName || agent.name,
      lastMessage: content,
      ticketId: linkedTicket?.id || session.ticketId,
      workflow: session.workflow
        ? {
            ...session.workflow,
            ticket: linkedTicket || session.workflow.ticket || null,
          }
        : session.workflow,
      updatedAt: new Date().toISOString(),
    };

    this.sessions.setConversation(sessionId, nextMessages);
    this.sessions.setSession(updatedSession);
    this.notify(sessionId);

    return {
      session: updatedSession,
      messages: nextMessages,
    };
  }

  @Post(':sessionId/profile')
  setProfile(@Param('sessionId') sessionId: string, @Body() body: any) {
    const profile = normalizeProfile(body);
    const current = this.sessions.get(sessionId);
    const updatedSession: Session = {
      ...(current || this.sessions.createEmptySession(sessionId)),
      profile,
      displayName: this.sessions.buildDisplayName(
        sessionId,
        current?.inquiryId ?? null,
        profile,
        current?.visitor ?? null
      ),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.setSession(updatedSession);
    this.notify(sessionId);

    return { session: updatedSession };
  }

  private notify(sessionId: string) {
    this.sse.notifySession(sessionId, this.sessions.getSessionPayload(sessionId));
    this.sse.notifyQueue(this.sessions.getSessionsPayload());
  }
}
