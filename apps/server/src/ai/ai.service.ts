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

/** AI 适配层：任意 OpenAI 兼容服务（AI_BASE_URL/AI_MODEL/AI_API_KEY）+ 本地规则降级。 */
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  /** 单一 OpenAI 兼容客户端：AI_API_KEY + 可选 AI_BASE_URL（留空即 OpenAI 官方） */
  private readonly client = appConfig.aiApiKey
    ? new OpenAI({
        apiKey: appConfig.aiApiKey,
        ...(appConfig.aiBaseUrl ? { baseURL: appConfig.aiBaseUrl } : {}),
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
    return appConfig.aiModel;
  }

  getConfiguredClient(): OpenAI | null {
    return this.client;
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
        '知识库未命中时，可以回答与开发和合作咨询相关的通用问题；涉及具体报价、档期、未公开案例或承诺时必须说明需要人工客服确认。',
        '始终使用第一人称「我」回答，像面对面聊天一样亲切、自然、不打官腔；称呼对方为「你」。',
        '语气简洁、礼貌、可执行，可以适度使用「咱们」「放心」等口语表达，但不要过度堆砌语气词。',
        '只有访客明确要求联系人工客服或转人工时，needHuman 才会为 true。',
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
    const fallback = this.buildFallbackReply(matchedFaqs, handoff, inquiry, ticket, intent, message);
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
      `联系人工客服原因：${handoff.reason}`,
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
    intent: string,
    /** 访客原话：仅用于在同意图的多条兜底话术里稳定选一条 */
    message = ''
  ): string {
    if (intent === 'out_of_scope') {
      return '这个问题有点超出我当前知识库范围了。我主要能帮你处理开发服务、报价、合作流程、技术栈、档期和项目进展相关问题。你如果愿意，我可以把话题拉回到你的项目需求上，帮你先梳理下一步。';
    }

    if (handoff.needHuman) {
      const ticketText = ticket ? `我已经帮你建好了跟进事项 ${ticket.id}，` : '我已经记下来了，';
      const inquiryText = inquiry ? `也关联上了你的${inquiry.type} ${inquiry.id}（${inquiry.title}）。` : '';
      return `好的，收到！${ticketText}${inquiryText}人工客服这会儿可能不在线，你方便的话留个称呼、联系方式和需求摘要，他看到后会尽快联系你，不会漏掉的。`;
    }

    if (inquiry) {
      return `我帮你查到了，${inquiry.type} ${inquiry.id}「${inquiry.title}」目前的状态是：${inquiry.statusText}。下一步：${inquiry.nextStep}。${inquiry.eta}。有其他想了解的随时问我。`;
    }

    return matchedFaqs[0]?.answer || pickFallbackScript(intent, message);
  }
}

/**
 * AI 不可用（未配置 / 超时 / 报错）且知识库没命中时的兜底话术。
 * 按意图分组，让访客至少拿到一句「对得上话题」的回复，而不是千篇一律的「没找到答案」。
 */
export const FALLBACK_SCRIPTS: Record<string, string[]> = {
  pricing: [
    '报价这块要看具体范围才好给数，你方便说说大致需求吗？比如要做的是网站、小程序还是后台系统，有哪些主要功能、期望什么时候上线。信息全一些我这边能给你一个靠谱的区间；要直接聊细节的话，说「转人工」我帮你接过去。',
    '价格取决于功能范围、设计要求和交付周期这几项。你先描述一下项目大概长什么样、有没有参考产品、预算区间大概在哪，我帮你把需求梳理成可报价的清单。',
  ],
  collaboration: [
    '合作流程大致是：先聊需求 → 出方案和报价 → 确认后签约排期 → 分阶段开发验收 → 交付并提供维护支持。你现在处在哪一步？我可以针对性说细一点。',
    '一般是需求沟通、方案报价、排期开发、验收交付这几步。你要是已经有明确需求，直接说清楚范围和时间，我帮你走下一步；不确定的话我们可以先从需求梳理开始。',
  ],
  tech_stack: [
    '技术选型要看项目类型，前端、后端、小程序各有常用的方案。你说说要做的东西和大致规模，我给你一个具体的选型建议和取舍理由。',
    '这块我需要知道你的场景才好回答：是新项目还是要接手已有系统？有没有必须兼容的技术栈或部署环境？说清楚了我给你几个可选方案对比。',
  ],
  portfolio: [
    '案例这块有些是签了保密的，不方便直接放出来。你说说你所在的行业和想做的产品类型，我挑能公开的、跟你场景最接近的介绍给你。',
    '可以介绍一些做过的项目类型和解决的问题。你先说说关注哪方面——是技术难度、交付速度还是某个具体行业，我按这个方向讲。',
  ],
  hiring: [
    '招聘或长期合作的事我这边可以先记下。你方便说说岗位方向、工作方式（远程还是坐班）、大致周期和预算吗？留个联系方式，后续会有人跟你详聊。',
    '这类合作建议直接和人对接。你留一下称呼、联系方式和大致需求，我记录下来转过去；也可以直接说「转人工」，我帮你接过去。',
  ],
  general: [
    '不好意思，这个问题我一下子没找到现成的答案。你可以再补充一点信息，比如需求范围、预算、期望时间，我再帮你看看；或者直接说「转人工」，我帮你转给客服。',
    '这个我暂时答不上来，怕说错反而误导你。你换个说法再问一次，或者补充点背景，我再试试；要是急的话说「转人工」，我直接帮你转接。',
    '抱歉，这块超出我现在掌握的信息了。你说说具体想解决什么问题，我看看能不能帮你换个角度回答；也可以说「转人工」找客服确认。',
  ],
};

/**
 * 按意图挑一条兜底话术。同一意图下有多个变体时按 seed 稳定选取——
 * 同一个问题每次得到同样的回答（可测试），不同问题之间又不会千篇一律。
 */
export function pickFallbackScript(intent: string, seed = ''): string {
  const scripts = FALLBACK_SCRIPTS[intent] || FALLBACK_SCRIPTS.general;
  if (scripts.length === 1) return scripts[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  return scripts[hash % scripts.length];
}

export function formatAiError(error: any): string {
  const status = error?.status ? `${error.status} ` : '';
  const message = error?.error?.message || error?.message || 'unknown error';
  return `${status}${message}`;
}
