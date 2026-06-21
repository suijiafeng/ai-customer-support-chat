import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFaqSearcher,
  detectIntent,
  detectSentiment,
  extractInquiryId,
  findInquiryByMessage,
  shouldHandoff,
} from '../dist/rules/rules.js';

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
  assert.equal(detectIntent('我要转人工', []), 'human_handoff');
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

import { createSmallTalkMatcher } from '../dist/rules/rules.js';
import { readFileSync } from 'node:fs';

// 词库来自真实数据文件，测试同时校验数据内容有效
const smallTalkGroups = JSON.parse(
  new URL('../data/small-talk.json', import.meta.url).pathname
    ? readFileSync(new URL('../data/small-talk.json', import.meta.url), 'utf8')
    : '[]'
);
const matchSmallTalk = createSmallTalkMatcher(smallTalkGroups);

test('small-talk 词库数据有效：每组有意图、词条和回复', () => {
  assert.ok(smallTalkGroups.length >= 6);
  for (const group of smallTalkGroups) {
    assert.ok(group.intent, 'intent required');
    assert.ok(Array.isArray(group.terms) && group.terms.length > 0, `${group.intent} terms`);
    assert.ok(Array.isArray(group.replies) && group.replies.length > 0, `${group.intent} replies`);
  }
});

test('matchSmallTalk 命中常见口水话并按类别回复', () => {
  assert.equal(matchSmallTalk('在吗？')?.intent, 'greeting');
  assert.equal(matchSmallTalk('你好呀~')?.intent, 'greeting');
  assert.equal(matchSmallTalk('测试')?.intent, 'testing');
  assert.equal(matchSmallTalk('111')?.intent, 'testing');
  assert.equal(matchSmallTalk('???')?.intent, 'testing');
  assert.equal(matchSmallTalk('谢谢！')?.intent, 'thanks');
  assert.equal(matchSmallTalk('拜拜')?.intent, 'bye');
  assert.equal(matchSmallTalk('好的')?.intent, 'ack');
  assert.equal(matchSmallTalk('666')?.intent, 'praise');
  assert.equal(matchSmallTalk('你是机器人吗')?.intent, 'who_are_you');
  assert.equal(matchSmallTalk('在干嘛呢')?.intent, 'chitchat');
  assert.ok(matchSmallTalk('在吗').reply.length > 0);
});

test('matchSmallTalk 同一消息回复稳定可复现', () => {
  assert.equal(matchSmallTalk('在吗').reply, matchSmallTalk('在吗').reply);
});

test('matchSmallTalk 不误伤正常业务问题', () => {
  assert.equal(matchSmallTalk('你好，项目怎么报价'), null);
  assert.equal(matchSmallTalk('我想联系开发者本人'), null);
  assert.equal(matchSmallTalk('帮我查一下项目 P1001'), null);
  assert.equal(matchSmallTalk('最近有档期吗'), null);
  assert.equal(matchSmallTalk('1234567890123'), null);
});
