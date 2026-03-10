import { Injectable } from '@nestjs/common';
import { LIMITS } from '@assistflow/shared';
import type { ChatResponse, Workflow } from '@assistflow/shared';
import { AiService, type ReplyDeltaHandler } from '../ai/ai.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { detectIntent, detectSentiment, shouldHandoff } from '../rules/rules.js';
import {
  normalizeAttachments,
  normalizeProfile,
  normalizeVisitor,
} from '../common/normalize.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { SseService } from '../sse/sse.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

/** 访客对话编排：自原 POST /api/chat 处理器平移。 */
@Injectable()
export class ChatService {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
    private readonly sessions: SessionsService,
    private readonly tickets: TicketsService,
    private readonly sse: SseService
  ) {}

  async handleChat(body: any, onDelta?: ReplyDeltaHandler): Promise<ChatResponse | { error: string }> {
    const message = String(body?.message || '').trim();
    const sessionId = String(body?.sessionId || 'default');
    const profile = body?.profile ? normalizeProfile(body.profile) : null;
    const visitor = normalizeVisitor(body?.visitor);
    const attachments = normalizeAttachments(body?.attachments);
    const storedHistory = this.sessions.getMessages(sessionId);
    const history = storedHistory.slice(-LIMITS.MAX_AI_HISTORY);

    // 允许「纯图片」消息：有文字或有图片即可（空校验由 controller 处理）

    if (this.sessions.isHumanAssigned(sessionId)) {
      const activeTicket = this.tickets.getLatestForSession(sessionId);
      const nextHistory = this.sessions.appendMessages(
        storedHistory,
        this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments })
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
      this.sessions.upsertSession({ sessionId, message, workflow, profile, visitor, forceStatus: 'assigned' });
      this.notify(sessionId);

      return {
        sessionId,
        reply: '',
        handledByAgent: true,
        session: this.sessions.get(sessionId)!,
        messages: nextHistory,
        ...workflow,
      };
    }

    // 口水话/测试消息（在吗、测试、111、谢谢…）直接内置回复，不走 FAQ/AI、不建跟进事项
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
        this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments }),
        this.sessions.createMessage({ role: 'assistant', actor: 'ai', content: smallTalk.reply })
      );

      this.sessions.setConversation(sessionId, nextHistory);
      this.sessions.upsertSession({ sessionId, message, workflow, profile, visitor });
      this.notify(sessionId);

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
      this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments }),
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
    this.sessions.upsertSession({ sessionId, message, workflow, profile, visitor });
    this.notify(sessionId);

    return {
      sessionId,
      reply,
      session: this.sessions.get(sessionId)!,
      messages: nextHistory,
      ...workflow,
    };
  }

  private notify(sessionId: string) {
    this.sse.notifySession(sessionId, this.sessions.getSessionPayload(sessionId));
    this.sse.notifyQueue(this.sessions.getSessionsPayload());
  }
}
