import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFaqSearcher } from '../dist/rules/rules.js';

const faqs = JSON.parse(readFileSync(new URL('../data/faqs.json', import.meta.url), 'utf8'));
const searchFaqs = createFaqSearcher(faqs);

const CASES = [
  { query: '项目怎么报价', expectId: 'pricing' },
  { query: '我想先了解合作流程', expectId: 'collaboration_process' },
  { query: '最近有空档吗', expectId: 'availability' },
  { query: '如何联系开发者本人', expectId: 'human_handoff' },
  { query: '支持哪些付款方式', expectId: 'payment_method' },
  { query: '项目源代码归谁所有', expectId: 'code_ownership' },
  { query: '你会不会 vue3 和 next', expectIntent: 'tech_stack' },
  { query: '做小程序吗', expectId: 'mobile_miniprogram' },
  { query: '可以接手别人写的项目吗', expectId: 'takeover' },
  { query: '会做 SEO 吗', expectId: 'seo' },
  { query: '有需求模板可以直接填写吗', expectId: 'requirements_template' },
  { query: '维护响应时间和 SLA 是怎么约定的', expectId: 'support_sla' },
  { query: '第三方费用谁承担，短信邮件和AI接口费用怎么算', expectId: 'third_party_costs' },
];

test('knowledge regression: representative queries should hit expected FAQ/intents', () => {
  for (const c of CASES) {
    const matches = searchFaqs(c.query);
    assert.ok(matches.length > 0, `should match for: ${c.query}`);
    const top = matches[0];
    if (c.expectId) {
      assert.equal(top.id, c.expectId, `${c.query} -> expected id ${c.expectId}, got ${top.id}`);
    }
    if (c.expectIntent) {
      assert.equal(top.intent, c.expectIntent, `${c.query} -> expected intent ${c.expectIntent}, got ${top.intent}`);
    }
  }
});

test('knowledge regression: score should be sorted descending and limited to top3', () => {
  const matches = searchFaqs('我想了解报价、合作流程、技术栈和档期');
  assert.ok(matches.length >= 1 && matches.length <= 3);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score, 'scores must be descending');
  }
});

test('knowledge regression: nonsense query should not force-match', () => {
  const matches = searchFaqs('%%%%%%%');
  assert.equal(matches.length, 0);
});
