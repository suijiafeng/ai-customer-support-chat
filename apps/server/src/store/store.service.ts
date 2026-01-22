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
  private persisted: PersistedData = { sessions: [], conversations: [], tickets: [] };

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
        this.logger.log(
          `Postgres 持久化已启用，载入 ${this.persisted.sessions.length} 会话 / ${this.persisted.tickets.length} 工单`
        );
      }
    } catch (error: any) {
      this.logger.error(`初始化失败，降级为纯内存模式：${error?.message || error}`);
      this.store = createStore({ connectionString: null });
      this.persisted = { sessions: [], conversations: [], tickets: [] };
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
}
