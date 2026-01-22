// 规则引擎（纯函数）。自 server/rules.js 原样平移，行为不变。
import type { Faq, Inquiry, Sentiment } from '@assistflow/shared';

export interface ScoredFaq extends Faq {
  score: number;
}

export function createFaqSearcher(faqs: Faq[]) {
  const indexedFaqs = faqs.map((faq) => ({
    ...faq,
    normalizedQuestion: normalize(faq.question),
    normalizedKeywords: faq.keywords.map(normalize),
  }));

  return function searchFaqs(message: string): ScoredFaq[] {
    const normalized = normalize(message);

    return indexedFaqs
      .map((faq) => {
        const keywordScore = faq.normalizedKeywords.reduce((score, keyword) => {
          return normalized.includes(keyword) ? score + 3 : score;
        }, 0);
        const questionScore = faq.normalizedQuestion
          .split('')
          .filter((char) => normalized.includes(char)).length;
        const score = keywordScore + questionScore / 20;

        return { ...faq, score };
      })
      .filter((faq) => faq.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ normalizedQuestion, normalizedKeywords, ...faq }) => faq);
  };
}

export function detectIntent(message: string, matchedFaqs: ScoredFaq[] = []): string {
  const normalized = normalize(message);

  if (hasAny(normalized, [
    '联系开发者本人',
    '找开发者本人',
    '联系本人',
    '找本人聊',
    '本人回复',
    '转人工',
    '找人工',
    '真人沟通',
  ])) {
    return 'human_handoff';
  }
  if (extractInquiryId(message) || hasAny(normalized, ['项目进展', '咨询进展', '项目编号', '咨询编号', '项目状态'])) {
    return 'inquiry_status';
  }
  if (hasAny(normalized, ['报价', '多少钱', '价格', '费用', '预算', '怎么收费'])) {
    return 'pricing';
  }
  if (hasAny(normalized, ['合作流程', '怎么合作', '开发流程', '项目流程', '交付时间', '开发周期'])) {
    return 'collaboration';
  }
  if (hasAny(normalized, ['技术栈', 'react', 'vue', 'next.js', 'typescript', 'javascript'])) {
    return 'tech_stack';
  }
  if (hasAny(normalized, ['作品集', '案例', '过往项目', 'portfolio'])) {
    return 'portfolio';
  }
  if (hasAny(normalized, ['招聘', '全职', '兼职', '长期合作', '工作机会'])) {
    return 'hiring';
  }

  return matchedFaqs[0]?.intent || 'general';
}

export interface HandoffDecision {
  needHuman: boolean;
  reason: string;
}

export function shouldHandoff(
  message: string,
  intent: string,
  matchedFaqs: ScoredFaq[] = [],
  sentiment?: Sentiment,
  inquiry?: Inquiry | null,
  aiAvailable = false
): HandoffDecision {
  if (intent === 'human_handoff') {
    return { needHuman: true, reason: '访客明确要求联系开发者本人' };
  }
  if (inquiry) {
    return { needHuman: false, reason: '项目或咨询查询已命中' };
  }
  if (intent === 'inquiry_status') {
    return { needHuman: false, reason: '未查询到项目或咨询编号，继续由助手引导' };
  }
  if (matchedFaqs.length === 0) {
    return aiAvailable
      ? { needHuman: false, reason: '知识库未命中，交由 AI 回答' }
      : { needHuman: false, reason: '知识库未命中，请访客补充问题' };
  }

  return { needHuman: false, reason: 'FAQ 可处理' };
}

export function findInquiryByMessage(message: string, inquiries: Inquiry[]): Inquiry | null {
  const inquiryId = extractInquiryId(message);

  if (!inquiryId) {
    return null;
  }

  return inquiries.find((inquiry) => normalize(inquiry.id) === normalize(inquiryId)) || null;
}

export function extractInquiryId(message: string): string | null {
  const match = String(message).match(/\b[A-Z]\d{4,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

export function detectSentiment(message: string): Sentiment {
  const normalized = normalize(message);
  const negativeTerms = ['生气', '太差', '垃圾', '骗人', '恶心', '失望', '投诉', '离谱'];
  const positiveTerms = ['谢谢', '感谢', '很好', '满意'];

  if (hasAny(normalized, negativeTerms)) {
    return 'negative';
  }
  if (hasAny(normalized, positiveTerms)) {
    return 'positive';
  }

  return 'neutral';
}

export function normalize(value: unknown): string {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

export function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(normalize(term)));
}
