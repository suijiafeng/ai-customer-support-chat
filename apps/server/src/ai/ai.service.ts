import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { AiUsage, Inquiry, Message, Ticket } from '@assistflow/shared';
import { appConfig } from '../config.js';
import type { HandoffDecision, ScoredFaq } from '../rules/rules.js';

export interface BuildReplyParams {
  message: string;
  history: Message[];
  matchedFaqs: ScoredFaq[];
  intent: string;
  handoff: HandoffDecision;
  inquiry: Inquiry | null;
  ticket: Ticket | null;
}

export interface ReplyResult {
  text: string;
  ai: AiUsage;
}

/** AI 适配层：openai / deepseek 双 provider + 本地规则降级。自原 buildReply 平移。 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openaiClient = process.env.OPENAI_API_KEY ? new OpenAI() : null;
  private readonly deepseekClient = process.env.DEEPSEEK_API_KEY
    ? new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      })
    : null;

  get provider(): string {
    return appConfig.aiProvider;
  }

  getActiveModel(): string {
    return appConfig.aiProvider === 'deepseek' ? appConfig.deepseekModel : appConfig.openaiModel;
  }

  getConfiguredClient(): OpenAI | null {
    return appConfig.aiProvider === 'deepseek' ? this.deepseekClient : this.openaiClient;
  }

  getActiveClient(): OpenAI | null {
    if (!appConfig.aiFeatureEnabled) {
      return null;
    }
    return this.getConfiguredClient();
  }

  async buildReply(params: BuildReplyParams): Promise<ReplyResult> {
    const { message, history, matchedFaqs, intent, handoff, inquiry, ticket } = params;
    const fallback = this.buildFallbackReply(matchedFaqs, handoff, inquiry, ticket);
    const fallbackResult: ReplyResult = {
      text: fallback,
      ai: {
        provider: this.provider,
        model: this.getActiveModel(),
        used: false,
        fallback: true,
        error: null,
      },
    };

    const activeClient = this.getActiveClient();

    if (!activeClient) {
      return {
        ...fallbackResult,
        ai: {
          ...fallbackResult.ai,
          error: appConfig.aiFeatureEnabled ? 'AI provider is not configured' : 'AI feature is disabled',
        },
      };
    }

    const knowledge = matchedFaqs
      .map((faq, index) => `${index + 1}. ${faq.question}\n${faq.answer}`)
      .join('\n\n');
    const compactHistory = history
      .map((item) => `${item.role === 'user' ? '访客' : '助手或开发者'}：${item.content}`)
      .join('\n');

    const instructions = [
      '你是独立前端开发者个人主页上的中文 AI 助手。',
      '优先根据提供的本地 FAQ、项目或咨询信息以及最近对话回答。',
      '你可以介绍开发服务、报价方式、合作流程、技术栈、作品集、档期、招聘合作和开发者背景。',
      '知识库未命中时，可以回答与前端开发和合作咨询相关的通用问题；涉及具体报价、档期、未公开案例或承诺时必须说明需要开发者本人确认。',
      '语气简洁、礼貌、可执行。',
      '只有访客明确要求联系开发者本人或转人工时，needHuman 才会为 true。',
      '如果 needHuman 为 true，不要代替开发者承诺；请说明开发者暂时不在线，并请访客留下联系方式和需求摘要，后续会有专人联系。',
      '不要编造报价、档期、项目经历、合作承诺或项目进展。',
    ].join('\n');
    const prompt = [
      `意图：${intent}`,
      `needHuman：${handoff.needHuman}`,
      `联系开发者本人原因：${handoff.reason}`,
      `项目或咨询信息：\n${inquiry ? JSON.stringify(inquiry, null, 2) : '无'}`,
      `跟进事项：\n${ticket ? JSON.stringify(ticket, null, 2) : '无'}`,
      `最近对话：\n${compactHistory || '无'}`,
      `知识库：\n${knowledge || '无命中'}`,
      `用户消息：${message}`,
    ].join('\n\n');

    if (this.provider === 'deepseek') {
      try {
        const completion = await activeClient.chat.completions.create({
          model: this.getActiveModel(),
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: prompt },
          ],
        });

        const text = completion.choices[0]?.message?.content?.trim();
        return {
          text: text || fallback,
          ai: {
            provider: this.provider,
            model: this.getActiveModel(),
            used: Boolean(text),
            fallback: !text,
            error: null,
          },
        };
      } catch (error) {
        const formattedError = formatAiError(error);
        this.logger.warn(`DeepSeek 请求失败，降级为本地规则：${formattedError}`);
        return {
          ...fallbackResult,
          ai: { ...fallbackResult.ai, error: formattedError },
        };
      }
    }

    let response;
    try {
      response = await activeClient.responses.create({
        model: this.getActiveModel(),
        instructions,
        input: prompt,
      });
    } catch (error) {
      const formattedError = formatAiError(error);
      this.logger.warn(`OpenAI request failed, using local fallback: ${formattedError}`);
      return {
        ...fallbackResult,
        ai: { ...fallbackResult.ai, error: formattedError },
      };
    }

    const text = response.output_text?.trim();
    return {
      text: text || fallback,
      ai: {
        provider: this.provider,
        model: this.getActiveModel(),
        used: Boolean(text),
        fallback: !text,
        error: null,
      },
    };
  }

  buildFallbackReply(
    matchedFaqs: ScoredFaq[],
    handoff: HandoffDecision,
    inquiry: Inquiry | null,
    ticket: Ticket | null
  ): string {
    if (handoff.needHuman) {
      const ticketText = ticket ? `已建立跟进事项 ${ticket.id}。` : '';
      const inquiryText = inquiry ? `已关联 ${inquiry.type} ${inquiry.id}（${inquiry.title}）。` : '';
      return `${handoff.reason}。${inquiryText}${ticketText}开发者暂时不在线，请留下联系方式和需求摘要，后续会有专人联系。`;
    }

    if (inquiry) {
      return `查到${inquiry.type} ${inquiry.id}：${inquiry.title}。当前状态：${inquiry.statusText}。下一步：${inquiry.nextStep}。${inquiry.eta}。`;
    }

    return (
      matchedFaqs[0]?.answer ||
      '我暂时没有在本地知识库中找到对应答案。你可以补充需求范围、预算、期望时间，或明确要求联系开发者本人。'
    );
  }
}

export function formatAiError(error: any): string {
  const status = error?.status ? `${error.status} ` : '';
  const message = error?.error?.message || error?.message || 'unknown error';
  return `${status}${message}`;
}
