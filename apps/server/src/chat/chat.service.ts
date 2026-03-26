import { Injectable } from '@nestjs/common';
import { LIMITS } from '@assistflow/shared';
import type { ChatResponse, VisitorInfo, Workflow } from '@assistflow/shared';
import { AiService, type ReplyDeltaHandler } from '../ai/ai.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { detectIntent, detectSentiment, shouldHandoff } from '../rules/rules.js';
import {
  inferVisitorFromSessionId,
  normalizeAttachments,
  normalizeProfile,
  normalizeVisitor,
  parseDevice,
  type ClientMeta,
} from '../common/normalize.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { SessionTicketService } from '../workflow/session-ticket.service.js';

@Injectable()
export class ChatService {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
    private readonly sessions: SessionsService,
    private readonly tickets: TicketsService,
    private readonly sessionTicket: SessionTicketService
  ) {}

  async handleChat(
    body: any,
    onDelta?: ReplyDeltaHandler,
    clientMeta?: ClientMeta
  ): Promise<ChatResponse | { error: string }> {
    const message = String(body?.message || '').trim();
    const sessionId = String(body?.sessionId || 'default');
    const profile = body?.profile ? normalizeProfile(body.profile) : null;
    const baseVisitor = normalizeVisitor(body?.visitor) ?? inferVisitorFromSessionId(sessionId);
    const visitor: VisitorInfo | null = baseVisitor
      ? {
          ...baseVisitor,
          ip: clientMeta?.ip ?? baseVisitor.ip ?? null,
          device: parseDevice(clientMeta?.userAgent) ?? baseVisitor.device ?? null,
          location: baseVisitor.location ?? null,
        }
      : null;
    const attachments = normalizeAttachments(body?.attachments);
    const clientMessageId = String(body?.clientMessageId || '').slice(0, 64) || null;
    const tenantKey = String(body?.siteKey || '').trim() || null;
    const storedHistory = this.sessions.getMessages(sessionId);
    const history = storedHistory.slice(-LIMITS.MAX_AI_HISTORY);

    if (clientMessageId) {
      const dupIndex = storedHistory.findIndex((m) => m.clientMessageId === clientMessageId);
      if (dupIndex !== -1) {
        const existingReply = storedHistory.slice(dupIndex + 1).find((m) => m.role === 'assistant');
        const session = this.sessions.get(sessionId) || this.sessions.createEmptySession(sessionId);
        const workflow: Workflow = session.workflow ?? {
          ai: {
            provider: this.ai.provider,
            model: this.ai.getActiveModel(),
            used: false,
            fallback: false,
            error: null,
          },
          intent: 'duplicate',
          sentiment: 'neutral',
          needHuman: false,
          reason: '重复消息（客户端重试），返回已有结果',
          inquiry: null,
          ticket: null,
          sources: [],
        };
        return {
          sessionId,
          reply: existingReply?.content || '',
          session,
          messages: storedHistory,
          ...workflow,
        };
      }
    }

    if (this.sessions.isHumanAssigned(sessionId)) {
      const activeTicket = this.tickets.getLatestForSession(sessionId);
      const nextHistory = this.sessions.appendMessages(
        storedHistory,
        this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments, clientMessageId })
      );
      const workflow: Workflow = {
        ai: {
          provider: this.ai.provider,
          model: this.ai.getActiveModel(),
          used: false,
          fallback: false,
          error: null,
        },
        intent: 'agent_conversation',
        sentiment: detectSentiment(message),
        needHuman: false,
        reason: '开发者本人已接入，暂停 AI 自动回复',
        inquiry: this.knowledge.findInquiry(message),
        ticket: activeTicket,
        sources: [],
      };
      this.sessions.setConversation(sessionId, nextHistory);
      this.sessions.upsertSession({ sessionId, message, workflow, profile, visitor, forceStatus: 'assigned', tenantKey });
      this.sessionTicket.notify(sessionId);
      return {
        sessionId,
        reply: '',
        handledByAgent: true,
        session: this.sessions.get(sessionId)!,
        messages: nextHistory,
        ...workflow,
      };
    }

    const smallTalk = message && attachments.length === 0 ? this.knowledge.matchSmallTalk(message) : null;
    if (smallTalk) {
      const workflow: Workflow = {
        ai: {
          provider: this.ai.provider,
          model: this.ai.getActiveModel(),
          used: false,
          fallback: false,
          error: null,
        },
        intent: `small_talk:${smallTalk.intent}`,
        sentiment: detectSentiment(message),
        needHuman: false,
        reason: '寒暄或测试消息，内置回复',
        inquiry: null,
        ticket: null,
        sources: [],
      };
      const nextHistory = this.sessions.appendMessages(
        storedHistory,
        this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments, clientMessageId }),
        this.sessions.createMessage({ role: 'assistant', actor: 'ai', content: smallTalk.reply })
      );
      this.sessions.setConversation(sessionId, nextHistory);
      this.sessions.upsertSession({ sessionId, message, workflow, profile, visitor, tenantKey });
      this.sessionTicket.notify(sessionId);
      return {
        sessionId,
        reply: smallTalk.reply,
        session: this.sessions.get(sessionId)!,
        messages: nextHistory,
        ...workflow,
      };
    }

    const matchedFaqs = this.knowledge.searchFaqs(message);
    const inquiry = this.knowledge.findInquiry(message);
    const intent = detectIntent(message, matchedFaqs);
    const sentiment = detectSentiment(message);
    const handoff = shouldHandoff(
      message,
      intent,
      matchedFaqs,
      sentiment,
      inquiry,
      Boolean(this.ai.getActiveClient())
    );
    const ticket = handoff.needHuman
      ? this.tickets.create({ sessionId, message, intent, reason: handoff.reason, inquiry })
      : null;
    const replyResult = await this.ai.buildReply(
      { message, history, matchedFaqs, intent, handoff, inquiry, ticket },
      onDelta
    );
    const reply = replyResult.text;
    const nextHistory = this.sessions.appendMessages(
      storedHistory,
      this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments, clientMessageId }),
      this.sessions.createMessage({ role: 'assistant', actor: 'ai', content: reply })
    );
    const workflow: Workflow = {
      ai: replyResult.ai,
      intent,
      sentiment,
      needHuman: handoff.needHuman,
      reason: handoff.reason,
      inquiry,
      ticket,
      sources: matchedFaqs.map((faq) => ({
        id: faq.id,
        question: faq.question,
        score: Number(faq.score.toFixed(2)),
      })),
    };
    this.sessions.setConversation(sessionId, nextHistory);
    this.sessions.upsertSession({ sessionId, message, workflow, profile, visitor, tenantKey });
    this.sessionTicket.notify(sessionId);
    return {
      sessionId,
      reply,
      session: this.sessions.get(sessionId)!,
      messages: nextHistory,
      ...workflow,
    };
  }
}
