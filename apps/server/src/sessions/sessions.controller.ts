import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '@assistflow/shared';
import { map } from 'rxjs';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { AuthService, type AuthenticatedAgent } from '../auth/auth.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { normalizeAttachments, normalizeProfile } from '../common/normalize.js';
import { SseService } from '../sse/sse.service.js';
import { SessionTicketService } from '../workflow/session-ticket.service.js';
import { SessionsService } from './sessions.service.js';

@Controller('api/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly workflow: SessionTicketService,
    private readonly metrics: MetricsService,
    private readonly sse: SseService,
    private readonly auth: AuthService
  ) {}

  @UseGuards(AgentAuthGuard)
  @Get()
  listSessions(@Req() req: any) {
    return this.sessions.getSessionsPayload(req.agent as AuthenticatedAgent);
  }

  @UseGuards(AgentAuthGuard)
  @Sse('events')
  queueEvents(@Req() req: any) {
    const agent = req.agent as AuthenticatedAgent;
    return this.sse.queueStream(this.sessions.getSessionsPayload(agent)).pipe(
      map((event) => ({
        type: event.type,
        data:
          event.type === 'sessions'
            ? this.sessions.filterPayloadForAgent(event.data as { sessions: any[] }, agent)
            : (event.data as object),
      }))
    );
  }

  @Get(':sessionId')
  async getSession(@Param('sessionId') sessionId: string, @Req() req: Request) {
    const { session, messages } = await this.sessions.loadDetail(sessionId);
    if (!session) throw new NotFoundException({ error: 'session not found' });
    const agent = this.agentFromRequest(req);
    if (agent && !this.sessions.canView(session, agent)) {
      throw new ForbiddenException({ error: 'session is handled by another agent' });
    }
    const payload = { session, messages };
    return agent ? payload : this.redactVisitor(payload);
  }

  @Sse(':sessionId/events')
  sessionEvents(@Param('sessionId') sessionId: string, @Req() req: Request) {
    const session = this.sessions.get(sessionId);
    const agent = this.agentFromRequest(req);
    if (agent && session && !this.sessions.canView(session, agent)) {
      throw new ForbiddenException({ error: 'session is handled by another agent' });
    }
    return this.sse
      .sessionStream(sessionId, this.sessions.getSessionPayload(sessionId))
      .pipe(
        map((event) => ({
          type: event.type,
          data: (agent
            ? event.data
            : this.redactVisitor(event.data as { session: Session | null })) as object,
        }))
      );
  }

  @UseGuards(AgentAuthGuard)
  @Post(':sessionId/resolve')
  resolveSession(@Param('sessionId') sessionId: string, @Body() body: any, @Req() req: any) {
    const session = this.sessions.get(sessionId);
    const resolution = String(body?.resolution || '开发者本人已标记解决').trim().slice(0, 120);
    if (!session) throw new NotFoundException({ error: 'session not found' });
    const agent = req.agent as AuthenticatedAgent;
    if (agent.role !== 'admin' && session.assignedAgentId !== agent.id) {
      throw new ForbiddenException({ error: 'session is handled by another agent' });
    }
    if (session.status === 'closed') {
      return {
        session,
        tickets: this.workflow.resolvedTicketsForSession(sessionId),
        metrics: this.metrics.buildMetrics(),
      };
    }
    const resolvedTickets = this.workflow.resolveSessionTickets(sessionId, resolution);
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
    this.workflow.notify(sessionId);
    return {
      session: updatedSession,
      tickets: resolvedTickets,
      metrics: this.metrics.buildMetrics(),
    };
  }

  @UseGuards(AgentAuthGuard)
  @Post(':sessionId/messages')
  postMessage(@Param('sessionId') sessionId: string, @Body() body: any, @Req() req: any) {
    const actor = body?.actor === 'customer' ? 'customer' : 'agent';
    const session = this.sessions.get(sessionId);
    const content = String(body?.content || '').trim();
    const agent = req.agent as AuthenticatedAgent;
    const attachments = normalizeAttachments(body?.attachments);
    if (!session) throw new NotFoundException({ error: 'session not found' });
    if (!content && attachments.length === 0) {
      throw new BadRequestException({ error: 'content or attachments required' });
    }
    if (actor === 'customer') {
      throw new BadRequestException({ error: 'customer messages must use /api/chat' });
    }
    const isAdmin = agent.role === 'admin';
    if (session.assignedAgentId && session.assignedAgentId !== agent.id && !isAdmin) {
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
    const linkedTicket = this.workflow.advanceTicketOnFirstReply(sessionId);
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
    this.workflow.notify(sessionId);
    return { session: updatedSession, messages: nextMessages };
  }

  @UseGuards(AgentAuthGuard)
  @Post(':sessionId/profile')
  setProfile(@Param('sessionId') sessionId: string, @Body() body: any, @Req() req: any) {
    const profile = normalizeProfile(body);
    const current = this.sessions.get(sessionId);
    if (!current) throw new NotFoundException({ error: 'session not found' });
    const agent = req.agent as AuthenticatedAgent;
    if (agent.role !== 'admin' && current.assignedAgentId !== agent.id) {
      throw new ForbiddenException({ error: 'session is handled by another agent' });
    }
    const updatedSession: Session = {
      ...current,
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
    this.workflow.notify(sessionId);
    return { session: updatedSession };
  }

  private redactVisitor<T extends { session: Session | null }>(payload: T): T {
    const session = payload.session;
    if (!session?.visitor) return payload;
    const { code, createdAt } = session.visitor;
    return { ...payload, session: { ...session, visitor: { code, createdAt } } };
  }

  private agentFromRequest(req: Request): AuthenticatedAgent | null {
    const header = String(req.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (bearer) return this.auth.verify(bearer);
    const ticket = String((req.query as any)?.ticket || '');
    return ticket ? this.auth.verifySseTicket(ticket) : null;
  }
}
