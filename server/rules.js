export function createFaqSearcher(faqs) {
  const indexedFaqs = faqs.map((faq) => ({
    ...faq,
    normalizedQuestion: normalize(faq.question),
    normalizedKeywords: faq.keywords.map(normalize),
  }));

  return function searchFaqs(message) {
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

        return {
          ...faq,
          score,
        };
      })
      .filter((faq) => faq.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ normalizedQuestion, normalizedKeywords, ...faq }) => faq);
  };
}

export function detectIntent(message, matchedFaqs = []) {
  const normalized = normalize(message);

  if (hasAny(normalized, ['人工', '真人', '投诉', '主管'])) {
    return 'human_handoff';
  }
  if (hasAny(normalized, ['退款', '退货', '取消订单', '退钱'])) {
    return 'refund';
  }
  if (hasAny(normalized, ['物流', '快递', '发货', '什么时候到'])) {
    return 'shipping';
  }
  if (extractOrderId(message)) {
    return 'order_status';
  }
  if (hasAny(normalized, ['发票', '税号', '抬头'])) {
    return 'invoice';
  }

  return matchedFaqs[0]?.intent || 'general';
}

export function shouldHandoff(message, intent, matchedFaqs = [], sentiment, order) {
  const normalized = normalize(message);
  const highRiskTerms = ['投诉', '律师', '起诉', '曝光', '赔偿', '主管', '人工'];

  if (intent === 'human_handoff') {
    return { needHuman: true, reason: '用户明确要求人工客服' };
  }
  if (hasAny(normalized, highRiskTerms)) {
    return { needHuman: true, reason: '包含投诉、法律或升级处理关键词' };
  }
  if (intent === 'refund' && hasAny(normalized, ['大额', '全部订单', '赔偿'])) {
    return { needHuman: true, reason: '退款请求可能需要人工审核' };
  }
  if (sentiment === 'negative') {
    return { needHuman: true, reason: '用户情绪较强，建议人工接管' };
  }
  if (intent === 'order_status' && !order) {
    return { needHuman: true, reason: '用户提供的订单号未查询到' };
  }
  if (order) {
    return { needHuman: false, reason: '订单查询已命中' };
  }
  if (matchedFaqs.length === 0) {
    return { needHuman: true, reason: '知识库未命中' };
  }

  return { needHuman: false, reason: 'FAQ 可处理' };
}

export function findOrderByMessage(message, orders) {
  const orderId = extractOrderId(message);

  if (!orderId) {
    return null;
  }

  return orders.find((order) => normalize(order.id) === normalize(orderId)) || null;
}

export function extractOrderId(message) {
  const match = String(message).match(/\b[A-Z]\d{4,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

export function detectSentiment(message) {
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

export function normalize(value) {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

export function hasAny(value, terms) {
  return terms.some((term) => value.includes(normalize(term)));
}
