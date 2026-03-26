import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Tenant, TenantStats } from '@assistflow/shared';
import { StoreService } from '../store/store.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

const MAX_KEY_LENGTH = 64;
const MAX_NAME_LENGTH = 60;
const MAX_REMARK_LENGTH = 120;
const MAX_DOMAIN_LENGTH = 100;

const newTenantId = () => `tn_${randomBytes(5).toString('hex')}`;

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function newTenantKey(): string {
  const chars: string[] = [];
  while (chars.length < 16) {
    for (const byte of randomBytes(16)) {
      // 248 = 62 * 4：拒绝采样消除模偏差，保证 62 个字符等概率
      if (byte < 248 && chars.length < 16) chars.push(KEY_ALPHABET[byte % 62]);
    }
  }
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

function normalizeHost(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

export type TenantVerifyResult = 'ok' | 'invalid_site_key' | 'invalid_tenant' | 'domain_not_allowed';

@Injectable()
export class WidgetKeysService implements OnModuleInit {
  private readonly keys = new Map<string, Tenant>();

  constructor(
    private readonly store: StoreService,
    private readonly sessions: SessionsService
  ) {}

  async onModuleInit() {
    await this.store.whenReady;
    for (const key of this.store.getPersisted().widgetKeys) {
      if (!key.id) {
        const filled: Tenant = { ...key, id: newTenantId() };
        this.keys.set(filled.key, filled);
        this.store.saveWidgetKey(filled);
      } else {
        this.keys.set(key.key, key);
      }
    }
    if (this.keys.size === 0) {
      const now = new Date().toISOString();
      const seed: Tenant = {
        id: 'tn_846ad88eee',
        key: 'd0KX6-CDtI-Gaxc-fR1K',
        name: 'Demo',
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

  isValid(key: string | undefined | null): boolean {
    if (!key) return false;
    return this.keys.get(String(key).trim())?.active === true;
  }

  verify(
    key: string | undefined | null,
    tenantId: string | undefined | null,
    originHost: string | null
  ): TenantVerifyResult {
    const tenant = key ? this.keys.get(String(key).trim()) : undefined;
    if (!tenant || !tenant.active) return 'invalid_site_key';
    if (!tenantId || String(tenantId).trim() !== tenant.id) return 'invalid_tenant';
    const domain = normalizeHost(tenant.domain);
    if (domain) {
      if (!originHost) return 'domain_not_allowed';
      if (originHost !== domain && !originHost.endsWith(`.${domain}`)) return 'domain_not_allowed';
    }
    return 'ok';
  }

  create(rawName: string, rawKey?: string, rawRemark?: string, rawDomain?: string): Tenant {
    const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new ConflictException({ error: 'name is required' });
    const remark = String(rawRemark || '').trim().slice(0, MAX_REMARK_LENGTH);
    const domain = String(rawDomain || '').trim().slice(0, MAX_DOMAIN_LENGTH);
    let key = String(rawKey || '').trim().slice(0, MAX_KEY_LENGTH);
    if (key) {
      if (this.keys.has(key)) throw new ConflictException({ error: 'key already exists' });
    } else {
      do { key = newTenantKey(); } while (this.keys.has(key));
    }
    const now = new Date().toISOString();
    const tenant: Tenant = { id: newTenantId(), key, name, domain, remark, active: true, createdAt: now, updatedAt: now };
    this.keys.set(key, tenant);
    this.store.saveWidgetKey(tenant);
    return tenant;
  }

  update(
    key: string,
    patch: { name?: string; domain?: string; remark?: string; active?: boolean }
  ): Tenant {
    const existing = this.keys.get(key);
    if (!existing) throw new NotFoundException({ error: 'widget key not found' });
    const updated: Tenant = { ...existing, updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim().slice(0, MAX_NAME_LENGTH);
      if (!name) throw new ConflictException({ error: 'name is required' });
      updated.name = name;
    }
    if (patch.domain !== undefined) updated.domain = String(patch.domain || '').trim().slice(0, MAX_DOMAIN_LENGTH);
    if (patch.remark !== undefined) updated.remark = String(patch.remark || '').trim().slice(0, MAX_REMARK_LENGTH);
    if (patch.active !== undefined) updated.active = Boolean(patch.active);
    this.keys.set(key, updated);
    this.store.saveWidgetKey(updated);
    return updated;
  }

  remove(key: string): void {
    if (!this.keys.has(key)) throw new NotFoundException({ error: 'widget key not found' });
    this.keys.delete(key);
    this.store.deleteWidgetKey(key);
  }

  getStats(key: string): TenantStats {
    if (!this.keys.has(key)) throw new NotFoundException({ error: 'widget key not found' });

    const allSessions = this.sessions.list().filter((s) => s.tenantKey === key);
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const statusBreakdown = { bot: 0, waiting_human: 0, assigned: 0, closed: 0 };
    const deviceBreakdown = { mobile: 0, desktop: 0, unknown: 0 };
    const sourceCounts = new Map<string, number>();
    const dailyCounts = new Map<string, number>();

    for (const session of allSessions) {
      statusBreakdown[session.status] = (statusBreakdown[session.status] ?? 0) + 1;

      const device = (session.visitor?.device ?? '').toLowerCase();
      if (/ios|android|mobile/.test(device)) {
        deviceBreakdown.mobile++;
      } else if (/windows|macos|linux|mac os/.test(device)) {
        deviceBreakdown.desktop++;
      } else {
        deviceBreakdown.unknown++;
      }

      const pageUrl = session.visitor?.pageUrl;
      if (pageUrl) {
        try {
          const host = new URL(pageUrl).origin;
          sourceCounts.set(host, (sourceCounts.get(host) ?? 0) + 1);
        } catch {
          sourceCounts.set(pageUrl.slice(0, 60), (sourceCounts.get(pageUrl.slice(0, 60)) ?? 0) + 1);
        }
      }

      if (session.createdAt >= sevenDaysAgo) {
        const day = session.createdAt.slice(0, 10);
        dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
      }
    }

    const dailySessions: Array<{ date: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const date = d.toISOString().slice(0, 10);
      dailySessions.push({ date, count: dailyCounts.get(date) ?? 0 });
    }

    const topSources = [...sourceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([url, count]) => ({ url, count }));

    return {
      totalSessions: allSessions.length,
      recentSessions: allSessions.filter((s) => s.createdAt >= sevenDaysAgo).length,
      statusBreakdown,
      deviceBreakdown,
      topSources,
      dailySessions,
    };
  }
}
