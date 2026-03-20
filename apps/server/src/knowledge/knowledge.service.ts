import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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

/** 需要监听热更新的知识库数据文件 */
const DATA_FILES = ['faqs.json', 'inquiries.json', 'small-talk.json'] as const;

/** 知识库：启动时加载 FAQ、项目咨询与口水话词库（只读种子数据）。支持运行时热更新。 */
@Injectable()
export class KnowledgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeService.name);
  faqs: Faq[] = [];
  inquiries: Inquiry[] = [];
  private inquiryIndex = new Map<string, Inquiry>();
  private searcher: (message: string) => ScoredFaq[] = () => [];
  private smallTalkMatcher: (message: string) => SmallTalkMatch | null = () => null;
  private watchers: FSWatcher[] = [];
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  async onModuleInit() {
    // 首次加载失败直接抛出，阻止服务带着空知识库静默启动（fail-fast）
    await this.load();
    this.watchDataFiles();
  }

  onModuleDestroy() {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  /**
   * 从磁盘加载全部知识库数据并重建索引。
   * 先解析到局部变量、全部成功后再一次性替换实例字段，避免部分新/部分旧的中间态。
   * 失败时抛出：启动阶段直接 fail-fast，热更新阶段由调用方保留旧快照。
   */
  async load(): Promise<void> {
    const [faqsRaw, inquiriesRaw, smallTalkRaw] = await Promise.all([
      fs.readFile(path.join(appConfig.dataDir, 'faqs.json'), 'utf8'),
      fs.readFile(path.join(appConfig.dataDir, 'inquiries.json'), 'utf8'),
      fs.readFile(path.join(appConfig.dataDir, 'small-talk.json'), 'utf8'),
    ]);

    const faqs: Faq[] = JSON.parse(faqsRaw);
    const inquiries: Inquiry[] = JSON.parse(inquiriesRaw);
    const smallTalkGroups: SmallTalkGroup[] = JSON.parse(smallTalkRaw);

    // 解析全部成功后再原子替换，保证三份数据与索引一致
    this.faqs = faqs;
    this.inquiries = inquiries;
    this.inquiryIndex = new Map(inquiries.map((inquiry) => [normalize(inquiry.id), inquiry]));
    this.searcher = createFaqSearcher(faqs);
    this.smallTalkMatcher = createSmallTalkMatcher(smallTalkGroups);
  }

  /** 监听全部知识库数据文件；任一变更触发防抖重载（500ms）。 */
  private watchDataFiles(): void {
    for (const file of DATA_FILES) {
      try {
        const watcher = watch(path.join(appConfig.dataDir, file), () => this.scheduleReload(file));
        this.watchers.push(watcher);
      } catch {
        // 文件不存在或平台不支持 watch 时静默降级
      }
    }
  }

  /** 防抖合并短时间内的多次变更，仅重载一次；失败保留旧快照。 */
  private scheduleReload(file: string): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(async () => {
      this.logger.log(`${file} 变更，重新加载知识库…`);
      try {
        await this.load();
        this.logger.log(`知识库热更新完成，当前 ${this.faqs.length} 条 FAQ`);
      } catch (error: any) {
        this.logger.error(`知识库热更新失败，保留旧数据：${error?.message || error}`);
      }
    }, 500);
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
