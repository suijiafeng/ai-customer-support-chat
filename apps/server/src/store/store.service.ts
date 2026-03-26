import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PersistedData, Store } from './store.js';
import { createStore } from './store.js';

@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreService.name);
  private store: Store = createStore();
  private persisted: PersistedData = { sessions: [], conversations: [], tickets: [], widgetKeys: [] };

  private readyResolve!: () => void;
  // Nest 并行执行同模块的 onModuleInit，消费方必须 await 此 Promise 才能读到完整快照
  readonly whenReady: Promise<void> = new Promise((resolve) => {
    this.readyResolve = resolve;
  });

  get enabled(): boolean {
    return this.store.enabled;
  }

  getPersisted(): PersistedData {
    return this.persisted;
  }

  async onModuleInit() {
    try {
      await this.store.init();
      this.persisted = await this.store.loadAll();
      if (this.store.enabled) {
        const backend = (process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')).toLowerCase();
        this.logger.log(
          `${backend} 持久化已启用，载入 ${this.persisted.sessions.length} 会话 / ${this.persisted.tickets.length} 工单`
        );
      }
    } catch (error: any) {
      this.logger.error(`初始化失败，降级为纯内存模式：${error?.message || error}`);
      this.store = createStore({ connectionString: null });
      this.persisted = { sessions: [], conversations: [], tickets: [], widgetKeys: [] };
    } finally {
      this.readyResolve();
    }
  }

  async onModuleDestroy() {
    await this.store.close();
  }

  saveSession = (session: Parameters<Store['saveSession']>[0]) => this.store.saveSession(session);
  deleteSession = (id: string) => this.store.deleteSession(id);
  saveConversation = (id: string, messages: Parameters<Store['saveConversation']>[1]) =>
    this.store.saveConversation(id, messages);
  deleteConversation = (id: string) => this.store.deleteConversation(id);
  saveTicket = (ticket: Parameters<Store['saveTicket']>[0]) => this.store.saveTicket(ticket);
  deleteTicket = (id: string) => this.store.deleteTicket(id);
  saveWidgetKey = (key: Parameters<Store['saveWidgetKey']>[0]) => this.store.saveWidgetKey(key);
  deleteWidgetKey = (key: string) => this.store.deleteWidgetKey(key);

  loadSession = (id: string) => this.store.getSession(id);
  loadConversation = (id: string) => this.store.getConversation(id);
  loadTicket = (id: string) => this.store.getTicket(id);

  saveDailyMetric = (point: Parameters<Store['saveDailyMetric']>[0]) =>
    this.store.saveDailyMetric(point);
  loadDailyMetrics = (days: number) => this.store.loadDailyMetrics(days);

  get degraded(): boolean {
    return this.store.stats().writeErrors > 0;
  }

  stats() {
    return this.store.stats();
  }
}
