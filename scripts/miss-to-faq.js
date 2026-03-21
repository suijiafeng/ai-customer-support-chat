#!/usr/bin/env node

/**
 * 将知识库未命中统计转为 FAQ 草稿（人工复核后再入库）。
 *
 * 用法：
 *   node scripts/miss-to-faq.js --input miss.json
 *   node scripts/miss-to-faq.js --input miss.json --top 15 --out faq-drafts.json
 *
 * 输入支持两种格式：
 * 1) Knowledge stats 响应对象：{ topMissQueries: [{ query, count, lastSeen }] }
 * 2) 纯数组：[{ query, count, lastSeen }]
 */

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const result = { input: '', out: '', top: 20 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') result.input = String(argv[++i] || '');
    else if (arg === '--out') result.out = String(argv[++i] || '');
    else if (arg === '--top') result.top = Number(argv[++i] || 20);
  }
  return result;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function slugify(text) {
  const normalized = normalize(text)
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (normalized || 'faq_draft').slice(0, 48);
}

function guessIntent(query) {
  const q = normalize(query);
  if (/报价|费用|预算|多少钱|定金|付款/.test(q)) return 'pricing';
  if (/合作|流程|周期|工期|排期|改稿|合同|nda|保密/.test(q)) return 'collaboration';
  if (/技术|技术栈|react|vue|next|性能|seo|兼容/.test(q)) return 'tech_stack';
  if (/档期|有空|什么时候开始/.test(q)) return 'availability';
  if (/联系|转人工|找真人|开发者本人/.test(q)) return 'human_handoff';
  if (/项目进展|咨询进展|项目编号|咨询编号|状态/.test(q)) return 'inquiry_status';
  return 'general';
}

function guessStage(intent) {
  switch (intent) {
    case 'pricing':
      return 'quoting';
    case 'collaboration':
      return 'scoping';
    case 'availability':
      return 'discovery';
    case 'inquiry_status':
      return 'delivery';
    default:
      return 'discovery';
  }
}

function loadMissItems(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.topMissQueries)) return parsed.topMissQueries;
  throw new Error('Unsupported input format. Expect array or { topMissQueries: [...] }.');
}

function buildDraft(item) {
  const query = String(item?.query || '').trim();
  const intent = guessIntent(query);
  const id = `draft_${slugify(query)}`;

  return {
    id,
    intent,
    audience: 'new_lead',
    stage: guessStage(intent),
    confidenceNote: '该条目由未命中问题自动生成，请人工补全后再上线。',
    tags: ['auto_draft', 'from_miss_query'],
    lastReviewedAt: new Date().toISOString().slice(0, 10),
    question: query || '请补充问题',
    answer: '请根据实际业务能力补充正式答案（建议包含范围边界、下一步动作和是否需人工确认）。',
    keywords: Array.from(new Set([query, ...query.split(/[，。！？、\s]+/).filter(Boolean)])).slice(0, 8),
    source: {
      missCount: Number(item?.count || 1),
      lastSeen: String(item?.lastSeen || ''),
    },
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('Usage: node scripts/miss-to-faq.js --input <miss.json> [--top 20] [--out file.json]');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const items = loadMissItems(inputPath)
    .map((x) => ({ query: String(x?.query || ''), count: Number(x?.count || 0), lastSeen: x?.lastSeen || '' }))
    .filter((x) => x.query)
    .sort((a, b) => b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    .slice(0, Math.max(1, args.top || 20));

  const drafts = items.map(buildDraft);

  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out);
    fs.writeFileSync(outPath, `${JSON.stringify(drafts, null, 2)}\n`, 'utf8');
    console.log(`Generated ${drafts.length} FAQ drafts -> ${outPath}`);
    return;
  }

  console.log(JSON.stringify(drafts, null, 2));
}

main();
