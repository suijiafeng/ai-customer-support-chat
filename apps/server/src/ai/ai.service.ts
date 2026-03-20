import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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

/** 流式增量回调：每收到一段模型输出调用一次 */
export type ReplyDeltaHandler = (delta: string) => void;

/** AI 超时（毫秒）：超时后降级为本地规则回复 */
const AI_TIMEOUT_MS = 30_000;

/** AI 适配层：openai / deepseek 双 provider + 本地规则降级。自原 buildReply 平移。 */
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  private readonly openaiClient = process.env.OPENAI_API_KEY ? new OpenAI() : null;
  private readonly deepseekClient = process.env.DEEPSEEK_API_KEY
    ? new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      })
    : null;

  /** 运营侧可修改的 AI 人设指令（从 data/ai-persona.txt 加载） */
  private instructions = '';
  private personaWatcher: FSWatcher | null = null;
  private personaReloadTimer: ReturnType<typeof setTimeout> | null = null;

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

  async onModuleInit() {
    await this.loadPersona();
    this.watchPersona();
  }

  onModuleDestroy() {
    if (this.personaReloadTimer) {
      clearTimeout(this.personaReloadTimer);
      this.personaReloadTimer = null;
    }
    this.personaWatcher?.close();
    this.personaWatcher = null;
  }

  /** 从 data/ai-persona.txt 加载 system prompt；文件不存在时回退为内置默认值。 */
  async loadPersona(): Promise<void> {
    const personaPath = path.join(appConfig.dataDir, 'ai-persona.txt');
    try {
      this.instructions = (await fs.readFile(personaPath, 'utf8')).trim();
    } catch {
      this.logger.warn(`ai-persona.txt 未找到，使用内置默认人设（${personaPath}）`);
      this.instructions = [
        '你是独立开发者个人主页上的中文 AI 助手，以开发者的口吻和访客一对一交流。',
        '优先根据提供的本地 FAQ、项目或咨询信息以及最近对话回答。',
        '你可以介绍开发服务、报价方式、合作流程、技术栈、作品集、档期、招聘合作和开发者背景。',
        '知识库未命中时，可以回答与开发和合作咨询相关的通用问题；涉及具体报价、档期、未公开案例或承诺时必须说明需要开发者本人确认。',
        '始终使用第一人称「我」回答，像面对面聊天一样亲切、自然、不打官腔；称呼对方为「你」。',
        '语气简洁、礼貌、可执行，可以适度使用「咱们」「放心」等口语表达，但不要过度堆砌语气词。',
        '只有访客明确要求联系开发者本人或转人工时，needHuman 才会为 true。',
        '如果 needHuman 为 true，不要代替开发者承诺；请说明开发者暂时不在线，并请访客留下联系方式和需求摘要，后续会有专人联系。',
        '不要编造报价、档期、项目经历、合作承诺或项目进展。',
      ].join('\n');
    }
  }

  /** 监听 ai-persona.txt 变更，运行时热更新人设（防抖 500ms），无需重启服务。 */
  private watchPersona(): void {
    const personaPath = path.join(appConfig.dataDir, 'ai-persona.txt');
    try {
      this.personaWatcher = watch(personaPath, () => {
        if (this.personaReloadTimer) clearTimeout(this.personaReloadTimer);
        this.personaReloadTimer = setTimeout(async () => {
          await this.loadPersona();
          this.logger.log('ai-persona.txt 变更，已热更新 AI 人设');
        }, 500);
      });
    } catch {
      // 文件不存在或平台不支持 watch 时静默降级
    }
  }

  async buildReply(params: BuildReplyParams, onDelta?: ReplyDeltaHandler): Promise<ReplyResult> {
    const { message, history, matchedFaqs, intent, handoff, inquiry, ticket } = params;
    const fallback = this.buildFallbackReply(matchedFaqs, handoff, inquiry, ticket, intent);
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

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), AI_TIMEOUT_MS);

    try {
      let text: string | undefined;

      if (onDelta) {
        // 流式：增量转发给调用方，同时拼出完整文本
        const stream = await activeClient.chat.completions.create(
          {
            model: this.getActiveModel(),
            stream: true,
            messages: [
              { role: 'system', content: this.instructions },
              { role: 'user', content: prompt },
            ],
          },
          { signal: abort.signal }
        );
        let acc = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            acc += delta;
            onDelta(delta);
          }
        }
        text = acc.trim();
      } else {
        const completion = await activeClient.chat.completions.create(
          {
            model: this.getActiveModel(),
            messages: [
              { role: 'system', content: this.instructions },
              { role: 'user', content: prompt },
            ],
          },
          { signal: abort.signal }
        );
        text = completion.choices[0]?.message?.content?.trim();
      }

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
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError';
      const formattedError = isTimeout ? `timeout after ${AI_TIMEOUT_MS}ms` : formatAiError(error);
      this.logger.warn(`AI 请求失败，降级为本地规则：${formattedError}`);
      return {
        ...fallbackResult,
        ai: { ...fallbackResult.ai, error: formattedError },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  buildFallbackReply(
    matchedFaqs: ScoredFaq[],
    handoff: HandoffDecision,
    inquiry: Inquiry | null,
    ticket: Ticket | null,
    intent: string
  ): string {
    if (intent === 'out_of_scope') {
      return '这个问题有点超出我当前知识库范围了。我主要能帮你处理开发服务、报价、合作流程、技术栈、档期和项目进展相关问题。你如果愿意，我可以把话题拉回到你的项目需求上，帮你先梳理下一步。';
    }

    if (handoff.needHuman) {
      const ticketText = ticket ? `我已经帮你建好了跟进事项 ${ticket.id}，` : '我已经记下来了，';
      const inquiryText = inquiry ? `也关联上了你的${inquiry.type} ${inquiry.id}（${inquiry.title}）。` : '';
      return `好的，收到！${ticketText}${inquiryText}开发者本人这会儿可能不在线，你方便的话留个称呼、联系方式和需求摘要，他看到后会尽快联系你，不会漏掉的。`;
    }

    if (inquiry) {
      return `我帮你查到了，${inquiry.type} ${inquiry.id}「${inquiry.title}」目前的状态是：${inquiry.statusText}。下一步：${inquiry.nextStep}。${inquiry.eta}。有其他想了解的随时问我。`;
    }

    return (
      matchedFaqs[0]?.answer ||
      '不好意思，这个问题我一下子没找到现成的答案。你可以再补充一点信息，比如需求范围、预算、期望时间，我再帮你看看；或者直接说「联系开发者本人」，我帮你转给他。'
    );
  }
}

export function formatAiError(error: any): string {
  const status = error?.status ? `${error.status} ` : '';
  const message = error?.error?.message || error?.message || 'unknown error';
  return `${status}${message}`;
}
