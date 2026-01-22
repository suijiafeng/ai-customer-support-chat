import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Faq, Inquiry } from '@assistflow/shared';
import { appConfig } from '../config.js';
import { createFaqSearcher, extractInquiryId, normalize, type ScoredFaq } from '../rules/rules.js';

/** 知识库：启动时加载 FAQ 与项目咨询数据（只读种子数据）。 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  faqs: Faq[] = [];
  inquiries: Inquiry[] = [];
  private inquiryIndex = new Map<string, Inquiry>();
  private searcher: (message: string) => ScoredFaq[] = () => [];

  async onModuleInit() {
    this.faqs = JSON.parse(await fs.readFile(path.join(appConfig.dataDir, 'faqs.json'), 'utf8'));
    this.inquiries = JSON.parse(
      await fs.readFile(path.join(appConfig.dataDir, 'inquiries.json'), 'utf8')
    );
    this.inquiryIndex = new Map(this.inquiries.map((inquiry) => [normalize(inquiry.id), inquiry]));
    this.searcher = createFaqSearcher(this.faqs);
  }

  searchFaqs(message: string): ScoredFaq[] {
    return this.searcher(message);
  }

  findInquiry(message: string): Inquiry | null {
    const inquiryId = extractInquiryId(message);
    return inquiryId ? this.inquiryIndex.get(normalize(inquiryId)) || null : null;
  }
}
