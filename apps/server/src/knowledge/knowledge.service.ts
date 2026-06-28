import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

/** 知识库：启动时加载 FAQ、项目咨询与口水话词库（只读种子数据）。支持运行时热更新。 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  faqs: Faq[] = [];
  inquiries: Inquiry[] = [];
  private inquiryIndex = new Map<string, Inquiry>();
  private searcher: (message: string) => ScoredFaq[] = () => [];
  private smallTalkMatcher: (message: string) => SmallTalkMatch | null = () => null;

  async onModuleInit() {
    await this.reload();
    this.watchFaqFile();
  }

  /** 重新从磁盘加载 FAQ 并重建搜索索引 */
  async reload(): Promise<void> {
    try {
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
    } catch (error: any) {
      this.logger.error(`知识库加载失败：${error?.message || error}`);
    }
  }

  /** 监听 faqs.json 文件变更，自动热更新搜索索引（防抖 500ms） */
  private watchFaqFile(): void {
    const faqPath = path.join(appConfig.dataDir, 'faqs.json');
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      watch(faqPath, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          this.logger.log('faqs.json 变更，重新加载知识库…');
          await this.reload();
          this.logger.log(`知识库热更新完成，当前 ${this.faqs.length} 条 FAQ`);
        }, 500);
      });
    } catch {
      // 文件不存在或平台不支持 watch 时静默降级
    }
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
