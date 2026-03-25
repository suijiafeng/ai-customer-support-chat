import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Tenant } from '@assistflow/shared';
import { StoreService } from '../store/store.service.js';

const MAX_KEY_LENGTH = 64;
const MAX_NAME_LENGTH = 60;
const MAX_REMARK_LENGTH = 120;
const MAX_DOMAIN_LENGTH = 100;

/** 租户ID：tn_ + 10 位十六进制随机数 */
const newTenantId = () => `tn_${randomBytes(5).toString('hex')}`;

/** 租户密钥字符表：大小写字母 + 数字（62 个） */
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 租户密钥：16 位大小写字母+数字，按 4 位一组用 - 分隔（形如 Ab3d-Ef5g-Hj7k-Mn9p）。
 * 基于 CSPRNG，拒绝采样去除模偏差；widget data-key 使用。
 */
function newTenantKey(): string {
  const chars: string[] = [];
  while (chars.length < 16) {
    for (const byte of randomBytes(16)) {
      // 248 = 62 * 4：抛弃 [248,255] 区间，保证 62 个字符等概率
      if (byte < 248 && chars.length < 16) chars.push(KEY_ALPHABET[byte % 62]);
    }
  }
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

/** 租户管理：内存态 + 写穿透，租户密钥供 ChatController 校验访客请求来源。 */
@Injectable()
export class WidgetKeysService implements OnModuleInit {
  private readonly keys = new Map<string, Tenant>();

  constructor(private readonly store: StoreService) {}

  onModuleInit() {
    for (const key of this.store.getPersisted().widgetKeys) {
      // 旧数据没有租户ID：启动时补齐并落库
      if (!key.id) {
        const filled: Tenant = { ...key, id: newTenantId() };
        this.keys.set(filled.key, filled);
        this.store.saveWidgetKey(filled);
      } else {
        this.keys.set(key.key, key);
      }
    }
    // 首次启动（表为空）自动种一个 demo-site，保证本地开发/演示站开箱可用；
    // 生产环境请在 workstation「租户管理」页面替换或停用它。
    if (this.keys.size === 0) {
      const now = new Date().toISOString();
      const seed: Tenant = {
        id: newTenantId(),
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

  list(): Tenant[] {
    return [...this.keys.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** 供 ChatController 在每条 /api/chat 请求上校验：存在且启用才算有效。 */
  isValid(key: string | undefined | null): boolean {
    if (!key) return false;
    return this.keys.get(String(key).trim())?.active === true;
  }

  /** 创建租户：名称必填、域名/备注可选；租户ID / 租户密钥由服务端自动生成（也允许显式传 key 以兼容脚本导入） */
  create(rawName: string, rawKey?: string, rawRemark?: string, rawDomain?: string): Tenant {
    const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) {
      throw new ConflictException({ error: 'name is required' });
    }
    const remark = String(rawRemark || '').trim().slice(0, MAX_REMARK_LENGTH);
    const domain = String(rawDomain || '').trim().slice(0, MAX_DOMAIN_LENGTH);
    let key = String(rawKey || '').trim().slice(0, MAX_KEY_LENGTH);
    if (key) {
      if (this.keys.has(key)) {
        throw new ConflictException({ error: 'key already exists' });
      }
    } else {
      do { key = newTenantKey(); } while (this.keys.has(key));
    }
    const now = new Date().toISOString();
    const tenant: Tenant = { id: newTenantId(), key, name, domain, remark, active: true, createdAt: now, updatedAt: now };
    this.keys.set(key, tenant);
    this.store.saveWidgetKey(tenant);
    return tenant;
  }

  /** 更新租户：名称 / 域名 / 备注 / 启用状态，未传的字段保持不变 */
  update(
    key: string,
    patch: { name?: string; domain?: string; remark?: string; active?: boolean }
  ): Tenant {
    const existing = this.keys.get(key);
    if (!existing) {
      throw new NotFoundException({ error: 'widget key not found' });
    }
    const updated: Tenant = { ...existing, updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim().slice(0, MAX_NAME_LENGTH);
      if (!name) {
        throw new ConflictException({ error: 'name is required' });
      }
      updated.name = name;
    }
    if (patch.domain !== undefined) {
      updated.domain = String(patch.domain || '').trim().slice(0, MAX_DOMAIN_LENGTH);
    }
    if (patch.remark !== undefined) {
      updated.remark = String(patch.remark || '').trim().slice(0, MAX_REMARK_LENGTH);
    }
    if (patch.active !== undefined) {
      updated.active = Boolean(patch.active);
    }
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
