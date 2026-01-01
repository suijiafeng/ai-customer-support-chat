import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFaqSearcher,
  detectIntent,
  detectSentiment,
  extractInquiryId,
  findInquiryByMessage,
  shouldHandoff,
} from '../server/rules.js';

const faqs = [
  {
    id: 'pricing',
    intent: 'pricing',
    question: '项目怎么报价',
    answer: '请提供需求范围后评估报价。',
    keywords: ['报价', '价格', '预算'],
  },
];
const inquiries = [
  {
    id: 'P1001',
    title: '个人品牌官网改版',
    statusText: '方案与报价已发送',
  },
];

test('extractInquiryId normalizes project and inquiry numbers', () => {
  assert.equal(extractInquiryId('帮我查一下 p1001'), 'P1001');
  assert.equal(extractInquiryId('没有咨询编号'), null);
});

test('FAQ search ranks pricing keyword matches', () => {
  const searchFaqs = createFaqSearcher(faqs);
  const matches = searchFaqs('这个项目怎么报价');

  assert.equal(matches[0].id, 'pricing');
  assert.equal(matches[0].intent, 'pricing');
});

test('detectIntent recognizes explicit handoff, inquiry lookup and service topics', () => {
  assert.equal(detectIntent('我想联系开发者本人', []), 'human_handoff');
  assert.equal(detectIntent('查询项目 P1001', []), 'inquiry_status');
  assert.equal(detectIntent('项目怎么收费', []), 'pricing');
  assert.equal(detectIntent('我要投诉', []), 'general');
});

test('findInquiryByMessage returns matching project data', () => {
  assert.equal(findInquiryByMessage('项目 P1001 进度怎么样', inquiries)?.statusText, '方案与报价已发送');
  assert.equal(findInquiryByMessage('项目 Z9999 进度怎么样', inquiries), null);
});

test('shouldHandoff only escalates explicit requests to contact the developer', () => {
  assert.deepEqual(shouldHandoff('联系开发者本人', 'human_handoff', [], 'neutral', null), {
    needHuman: true,
    reason: '访客明确要求联系开发者本人',
  });
  assert.deepEqual(shouldHandoff('项目 Z9999 进度怎么样', 'inquiry_status', [], 'neutral', null), {
    needHuman: false,
    reason: '未查询到项目或咨询编号，继续由助手引导',
  });
  assert.deepEqual(shouldHandoff('这个体验太差了我要投诉', 'general', [], 'negative', null), {
    needHuman: false,
    reason: '知识库未命中，请访客补充问题',
  });
  assert.deepEqual(shouldHandoff('介绍一下你自己', 'general', [], 'neutral', null, true), {
    needHuman: false,
    reason: '知识库未命中，交由 AI 回答',
  });
});

test('detectSentiment remains diagnostic and does not control handoff', () => {
  assert.equal(detectSentiment('这个体验太差了我要投诉'), 'negative');
  assert.equal(detectSentiment('谢谢，介绍很清楚'), 'positive');
  assert.equal(detectSentiment('你主要使用什么技术栈'), 'neutral');
});
