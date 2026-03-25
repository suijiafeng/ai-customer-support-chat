import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PersistedData, Store } from './store.js';
import { createStore } from './store.js';

/**
 * 持久化服务：包装写穿透 store。
 * onModuleInit 时建表并载入快照（供 Sessions/Tickets 服务在各自 init 时 hydrate），
 * 初始化失败（库不可达等）降级为纯内存，保证服务仍能起来。
 */
@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreService.name);
  private store: Store = createStore();
  private persisted: PersistedData = { sessions: [], conversations: [], tickets: [], widgetKeys: [] };

  private readyResolve!: () => void;
  /**
   * 启动快照就绪信号：loadAll 完成（或降级兜底后）resolve。
   * Nest 对同一模块内的 onModuleInit 是并行执行的，任何消费 getPersisted() 的服务
   * 必须先 await 此 Promise——否则会读到空快照并误以为库是空的（SQLite 同步加载
   * 恰好掩盖了这个竞态，Postgres 异步加载在生产必现）。
   */
  readonly whenReady: Promise<void> = new Promise((resolve) => {
    this.readyResolve = resolve;
  });

  get enabled(): boolean {
    return this.store.enabled;
  }

  /** 启动时载入的持久化快照 */
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
      this.readyResolve(); // 无论成功或降级，快照均已定型，放行依赖方
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

  // 单条回读（内存淘汰后仍可从库取回）
  loadSession = (id: string) => this.store.getSession(id);
  loadConversation = (id: string) => this.store.getConversation(id);
  loadTicket = (id: string) => this.store.getTicket(id);

  // 每日指标快照
  saveDailyMetric = (point: Parameters<Store['saveDailyMetric']>[0]) =>
    this.store.saveDailyMetric(point);
  loadDailyMetrics = (days: number) => this.store.loadDailyMetrics(days);

  /** 持久化健康：是否出现过写失败 + 详情 */
  get degraded(): boolean {
    return this.store.stats().writeErrors > 0;
  }
  stats() {
    return this.store.stats();
  }
}
