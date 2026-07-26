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
import { appConfig } from '../config.js';
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

  /**
   * 接管态下是否把会话交还 AI：访客主动优先，其次是客服静默超时（HANDOFF_IDLE_RELEASE_MINUTES）。
   * 返回 null 表示继续由人工接待。
   */
  private resolveHandoffRelease(sessionId: string, preferAi: boolean): { reason: string; notice: string } | null {
    if (preferAi) {
      return {
        reason: '访客选择先由 AI 回答',
        notice: '已切回 AI 助手，我先为你解答；需要真人随时说「转人工」。',
      };
    }
    const idleLimit = appConfig.handoffIdleReleaseMs;
    if (idleLimit > 0 && this.sessions.humanIdleMs(sessionId) >= idleLimit) {
      return {
        reason: `客服 ${Math.round(idleLimit / 60_000)} 分钟未回复，自动交还 AI`,
        notice: '客服暂时不在，我先接着为你解答；ta 回来后会继续跟进。',
      };
    }
    return null;
  }

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
    const preferAi = body?.preferAi === true;
    let storedHistory = this.sessions.getMessages(sessionId);
    let history = storedHistory.slice(-LIMITS.MAX_AI_HISTORY);

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

    // 人工接管态有三条出路：访客主动切回 AI / 客服久未回复自动交还 / 仍由人工接待。
    // 前两种在这里先把会话放回 bot，再落到下面正常的 AI 流程。
    const release = this.sessions.isHumanAssigned(sessionId)
      ? this.resolveHandoffRelease(sessionId, preferAi)
      : null;
    if (release) {
      this.sessions.releaseToBot(sessionId, release.reason);
      storedHistory = this.sessions.setConversation(
        sessionId,
        this.sessions.appendMessages(
          storedHistory,
          this.sessions.createMessage({ role: 'assistant', actor: 'system', content: release.notice })
        )
      );
      history = storedHistory.slice(-LIMITS.MAX_AI_HISTORY);
      this.sessionTicket.notify(sessionId);
    }

    if (this.sessions.isHumanAssigned(sessionId)) {
      const activeTicket = this.tickets.getLatestForSession(sessionId);
      const assignedName = this.sessions.get(sessionId)?.assignedAgentName || '人工客服';
      // 接管期间 AI 让位，但不能让访客对着空气说话：按冷却间隔补一条状态提示
      const notice = this.sessions.canPostSystemNotice(sessionId, appConfig.handoffNoticeCooldownMs)
        ? this.sessions.createMessage({
            role: 'assistant',
            actor: 'system',
            content: `${assignedName} 已接入，正在为你处理，请稍候。`,
          })
        : null;
      const nextHistory = this.sessions.appendMessages(
        storedHistory,
        this.sessions.createMessage({ role: 'user', actor: 'customer', content: message, attachments, clientMessageId }),
        ...(notice ? [notice] : [])
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

    // AI 回复前先推一次：让工作台立即看到新会话/最新消息，不必等 AI 全部生成完
    this.sessions.upsertSession({
      sessionId, message, profile, visitor, tenantKey,
      workflow: {
        ai: { provider: this.ai.provider, model: this.ai.getActiveModel(), used: false, fallback: false, error: null },
        intent, sentiment, needHuman: handoff.needHuman, reason: handoff.reason, inquiry, ticket, sources: [],
      },
    });
    this.sessionTicket.notify(sessionId);

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
