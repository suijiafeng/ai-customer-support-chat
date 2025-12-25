import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFaqSearcher,
  detectIntent,
  detectSentiment,
  extractOrderId,
  findOrderByMessage,
  shouldHandoff,
} from '../server/rules.js';

const faqs = [
  {
    id: 'shipping_status',
    intent: 'shipping',
    question: '订单什么时候发货',
    answer: '仓库会在 24 小时内处理。',
    keywords: ['发货', '物流', '快递'],
  },
];
const orders = [
  {
    id: 'A1001',
    statusText: '已发货',
  },
];

test('extractOrderId normalizes order numbers', () => {
  assert.equal(extractOrderId('帮我查一下 a1001'), 'A1001');
  assert.equal(extractOrderId('没有订单号'), null);
});

test('FAQ search ranks keyword matches', () => {
  const searchFaqs = createFaqSearcher(faqs);
  const matches = searchFaqs('快递什么时候到');

  assert.equal(matches[0].id, 'shipping_status');
  assert.equal(matches[0].intent, 'shipping');
});

test('detectIntent prefers explicit handoff and order status', () => {
  assert.equal(detectIntent('我要投诉找人工', []), 'human_handoff');
  assert.equal(detectIntent('查询订单 A1001', []), 'order_status');
});

test('findOrderByMessage returns matching order data', () => {
  assert.equal(findOrderByMessage('订单 A1001 到哪了', orders)?.statusText, '已发货');
  assert.equal(findOrderByMessage('订单 Z9999 到哪了', orders), null);
});

test('shouldHandoff escalates risk and unknown order cases', () => {
  assert.deepEqual(shouldHandoff('我要找人工', 'human_handoff', [], 'neutral', null), {
    needHuman: true,
    reason: '用户明确要求人工客服',
  });
  assert.deepEqual(shouldHandoff('查订单 Z9999', 'order_status', [], 'neutral', null), {
    needHuman: true,
    reason: '用户提供的订单号未查询到',
  });
});

test('detectSentiment distinguishes negative and positive messages', () => {
  assert.equal(detectSentiment('这个体验太差了我要投诉'), 'negative');
  assert.equal(detectSentiment('谢谢，服务很好'), 'positive');
  assert.equal(detectSentiment('帮我看下物流'), 'neutral');
});
