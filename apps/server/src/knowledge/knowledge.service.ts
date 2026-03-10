import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Faq, Inquiry } from '@assistflow/shared';
import { appConfig } from '../config.js';
import {
  createFaqSearcher,
  createSmallTalkMatcher,
  extractInquiryId,
  normalize,
  type ScoredFaq,
  type SmallTalkGroup,
  type SmallTalkMatch,
} from '../rules/rules.js';

/** 知识库：启动时加载 FAQ、项目咨询与口水话词库（只读种子数据）。 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  faqs: Faq[] = [];
  inquiries: Inquiry[] = [];
  private inquiryIndex = new Map<string, Inquiry>();
  private searcher: (message: string) => ScoredFaq[] = () => [];
  private smallTalkMatcher: (message: string) => SmallTalkMatch | null = () => null;

  async onModuleInit() {
    this.faqs = JSON.parse(await fs.readFile(path.join(appConfig.dataDir, 'faqs.json'), 'utf8'));
    this.inquiries = JSON.parse(
      await fs.readFile(path.join(appConfig.dataDir, 'inquiries.json'), 'utf8')
    );
    this.inquiryIndex = new Map(this.inquiries.map((inquiry) => [normalize(inquiry.id), inquiry]));
    this.searcher = createFaqSearcher(this.faqs);

    // 口水话/寒暄词库：独立数据文件，便于随时增补（见 data/small-talk.json）
    const smallTalkGroups: SmallTalkGroup[] = JSON.parse(
      await fs.readFile(path.join(appConfig.dataDir, 'small-talk.json'), 'utf8')
    );
    this.smallTalkMatcher = createSmallTalkMatcher(smallTalkGroups);
  }

  matchSmallTalk(message: string): SmallTalkMatch | null {
    return this.smallTalkMatcher(message);
  }

  searchFaqs(message: string): ScoredFaq[] {
    return this.searcher(message);
  }

  findInquiry(message: string): Inquiry | null {
    const inquiryId = extractInquiryId(message);
    return inquiryId ? this.inquiryIndex.get(normalize(inquiryId)) || null : null;
  }
}
