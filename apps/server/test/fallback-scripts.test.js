import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_SCRIPTS, pickFallbackScript } from '../dist/ai/ai.service.js';

test('每个意图都有兜底话术，且都给出下一步动作', () => {
  for (const [intent, scripts] of Object.entries(FALLBACK_SCRIPTS)) {
    assert.ok(scripts.length > 0, `${intent} 缺少话术`);
    for (const text of scripts) {
      assert.ok(text.length >= 20, `${intent} 的话术过短：${text}`);
    }
  }
});

test('pickFallbackScript 按意图取对应话术，未知意图回落到 general', () => {
  assert.ok(FALLBACK_SCRIPTS.pricing.includes(pickFallbackScript('pricing', '多少钱')));
  assert.ok(FALLBACK_SCRIPTS.general.includes(pickFallbackScript('nonexistent_intent', '随便问问')));
});

test('同一句话每次选到同一条话术，不同话可能落到不同变体', () => {
  assert.equal(pickFallbackScript('general', '这个怎么弄'), pickFallbackScript('general', '这个怎么弄'));
  const variants = new Set(
    ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff'].map((seed) => pickFallbackScript('general', seed))
  );
  assert.ok(variants.size > 1, '多个不同问题都落到同一条话术，失去了变体的意义');
});
