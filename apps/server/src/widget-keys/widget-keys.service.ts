import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { WidgetKey } from '@assistflow/shared';
import { StoreService } from '../store/store.service.js';

const MAX_KEY_LENGTH = 64;
const MAX_NAME_LENGTH = 60;

/** widget 接入密钥：内存态 + 写穿透，供 ChatController 校验访客请求来源。 */
@Injectable()
export class WidgetKeysService implements OnModuleInit {
  private readonly keys = new Map<string, WidgetKey>();

  constructor(private readonly store: StoreService) {}

  onModuleInit() {
    for (const key of this.store.getPersisted().widgetKeys) {
      this.keys.set(key.key, key);
    }
    // 首次启动（表为空）自动种一个 demo-site，保证本地开发/演示站开箱可用；
    // 生产环境请在 workstation「Widget 密钥」页面替换或停用它。
    if (this.keys.size === 0) {
      const now = new Date().toISOString();
      const seed: WidgetKey = {
        key: 'demo-site',
        name: 'Demo 站点（内置，建议替换）',
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      this.keys.set(seed.key, seed);
      this.store.saveWidgetKey(seed);
    }
  }

  list(): WidgetKey[] {
    return [...this.keys.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** 供 ChatController 在每条 /api/chat 请求上校验：存在且启用才算有效。 */
  isValid(key: string | undefined | null): boolean {
    if (!key) return false;
    return this.keys.get(String(key).trim())?.active === true;
  }

  create(rawKey: string, rawName: string): WidgetKey {
    const key = String(rawKey || '').trim().slice(0, MAX_KEY_LENGTH);
    const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!key) {
      throw new ConflictException({ error: 'key is required' });
    }
    if (this.keys.has(key)) {
      throw new ConflictException({ error: 'key already exists' });
    }
    const now = new Date().toISOString();
    const widgetKey: WidgetKey = { key, name: name || key, active: true, createdAt: now, updatedAt: now };
    this.keys.set(key, widgetKey);
    this.store.saveWidgetKey(widgetKey);
    return widgetKey;
  }

  setActive(key: string, active: boolean): WidgetKey {
    const existing = this.keys.get(key);
    if (!existing) {
      throw new NotFoundException({ error: 'widget key not found' });
    }
    const updated: WidgetKey = { ...existing, active, updatedAt: new Date().toISOString() };
    this.keys.set(key, updated);
    this.store.saveWidgetKey(updated);
    return updated;
  }

  remove(key: string): void {
    if (!this.keys.has(key)) {
      throw new NotFoundException({ error: 'widget key not found' });
    }
    this.keys.delete(key);
    this.store.deleteWidgetKey(key);
  }
}
