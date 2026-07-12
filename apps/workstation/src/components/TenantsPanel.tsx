import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Tenant, TenantStats } from '@assistflow/shared';
import { fmtTime, requestJson } from '../api.js';
import { showToast, confirmDialog } from '../ui/feedback.js';
import Icon from '../ui/Icon.js';

const PAGE_SIZE = 10;

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('zh-CN')} ${fmtTime(iso)}`;
}

/** 密钥脱敏：保留前 4 / 后 4 位，中间打点（短 key 只留前 2 位） */
function maskKey(key: string): string {
  if (key.length <= 10) return `${key.slice(0, 2)}••••••`;
  return `${key.slice(0, 4)}••••••${key.slice(-4)}`;
}

// 与服务端相同的密钥算法：16 位大小写字母+数字，4 位一组用 - 分隔。
// 仅在后端为旧版本（要求前端传 key）时作为回退使用。
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genTenantKey(): string {
  const chars: string[] = [];
  while (chars.length < 16) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 248 = 62 * 4：拒绝采样，保证 62 个字符等概率
    for (const b of bytes) {
      if (b < 248 && chars.length < 16) chars.push(KEY_ALPHABET[b % 62]);
    }
  }
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文（http 域名）没有 clipboard API，退回旧方案
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 租户管理：admin 专属。支持名称/ID 搜索、分页；弹窗创建；密钥脱敏显示、点击复制。 */
export default function TenantsPanel() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [viewing, setViewing] = useState<Tenant | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await requestJson<{ keys: Tenant[] }>('/api/widget-keys');
      // 最新创建的排在最前
      const sorted = (data.keys || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setTenants(sorted);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 搜索：租户名称 / 租户ID，大小写不敏感；搜索变化时回到第一页
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) => (t.name || '').toLowerCase().includes(q) || (t.id || '').toLowerCase().includes(q)
    );
  }, [tenants, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const onSearch = useCallback((value: string) => {
    setQuery(value);
    setPage(1);
  }, []);

  const onCreated = useCallback(async () => {
    setShowCreate(false);
    showToast('租户已创建，密钥已自动生成', 'success');
    setQuery('');
    setPage(1);
    await load();
  }, [load]);

  const onUpdated = useCallback((tenant: Tenant) => {
    setTenants((list) => list.map((k) => (k.key === tenant.key ? tenant : k)));
    setEditing(null);
    showToast('租户已更新', 'success');
  }, []);

  const remove = useCallback(async (item: Tenant) => {
    const ok = await confirmDialog(`确认删除租户「${item.name || item.key}」？删除后使用该密钥的网站将无法接入客服。`, {
      confirmText: '删除',
    });
    if (!ok) return;
    try {
      await requestJson(`/api/widget-keys/${encodeURIComponent(item.key)}`, { method: 'DELETE' });
      setTenants((list) => list.filter((k) => k.key !== item.key));
    } catch {
      showToast('删除失败，请重试', 'error');
    }
  }, []);

  const copyKey = useCallback(async (key: string) => {
    (await copyText(key))
      ? showToast('密钥已复制到剪贴板', 'success')
      : showToast('复制失败，请手动复制', 'error');
  }, []);

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">租户管理（{tenants.length}）</h2>
          <input
            className="tenant-search"
            type="search"
            placeholder="搜索租户名称 / 租户ID…"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <button className="claim-like-btn" onClick={() => setShowCreate(true)}>新建租户</button>
          <button className="ghost-btn" onClick={load}>刷新</button>
        </div>
      </div>

      {error ? (
        <div className="empty"><Icon name="alert-triangle" size={28} style={{ opacity: .4, marginBottom: 4 }} />加载失败<button className="retry-btn" onClick={load}>重试</button></div>
      ) : loading && !tenants.length ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !tenants.length ? (
        <div className="empty"><Icon name="building" size={28} style={{ opacity: .4, marginBottom: 4 }} />暂无租户，访客将无法接入客服</div>
      ) : !filtered.length ? (
        <div className="empty"><Icon name="search" size={28} style={{ opacity: .4, marginBottom: 4 }} />未找到匹配「{query.trim()}」的租户</div>
      ) : (
        <>
          <div className={`ticket-table-wrap${loading ? ' stale' : ''}`}>
            <table className="ticket-table tenant-table">
              <thead>
                <tr>
                  <th>租户名称</th><th>租户ID</th><th>状态</th><th>创建时间</th><th>租户域名</th><th>备注</th><th>租户密钥</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((t) => (
                  <tr key={t.key}>
                    <td>{t.name || '—'}</td>
                    <td className="mono">{t.id || '—'}</td>
                    <td><span className={`tag tag-${t.active ? 'success' : 'info'}`}>{t.active ? '启用中' : '已停用'}</span></td>
                    <td className="mono">{fmtDate(t.createdAt)}</td>
                    <td className="mono domain" title={t.domain || undefined}>{t.domain || <span className="muted">—</span>}</td>
                    <td className="remark" title={t.remark || undefined}>{t.remark || <span className="muted">—</span>}</td>
                    <td>
                      <button
                        className="key-cell mono"
                        type="button"
                        title="点击复制完整密钥"
                        onClick={() => copyKey(t.key)}
                      >
                        {maskKey(t.key)}
                        <span className="key-copy" aria-hidden="true">⧉</span>
                      </button>
                    </td>
                    <td className="ops">
                      <button className="ghost-btn" onClick={() => setViewing(t)}>详情</button>
                      <button className="ghost-btn" onClick={() => setEditing(t)}>编辑</button>
                      <button className="ghost-btn remove" onClick={() => remove(t)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="pager-info">共 {filtered.length} 条</span>
            {totalPages > 1 && (
              <>
                <button className="ghost-btn" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>上一页</button>
                <span className="pager-info">{curPage} / {totalPages}</span>
                <button className="ghost-btn" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>下一页</button>
              </>
            )}
          </div>
        </>
      )}

      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} onCreated={onCreated} />}
      {editing && <EditTenantModal tenant={editing} onClose={() => setEditing(null)} onUpdated={onUpdated} />}
      {viewing && <TenantStatsModal tenant={viewing} onClose={() => setViewing(null)} />}
    </main>
  );
}

/** 编辑租户弹窗：名称 / 域名 / 备注可改，启用状态用 switch 切换，保存时一并提交。 */
function EditTenantModal({
  tenant, onClose, onUpdated,
}: {
  tenant: Tenant;
  onClose: () => void;
  onUpdated: (t: Tenant) => void;
}) {
  const [name, setName] = useState(tenant.name || '');
  const [domain, setDomain] = useState(tenant.domain || '');
  const [remark, setRemark] = useState(tenant.remark || '');
  const [active, setActive] = useState(tenant.active);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = name.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      const data = await requestJson<{ key: Tenant }>(`/api/widget-keys/${encodeURIComponent(tenant.key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value, domain: domain.trim(), remark: remark.trim(), active }),
      });
      onUpdated(data.key);
    } catch {
      showToast('保存失败，请重试', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="编辑租户" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">编辑租户</h3>
        <div className="field">
          <label htmlFor="edit-tenant-name">租户名称 <i className="req">*</i></label>
          <input
            id="edit-tenant-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
          />
        </div>
        <div className="field">
          <label htmlFor="edit-tenant-domain">租户域名</label>
          <input
            id="edit-tenant-domain"
            placeholder="如 www.example.com"
            value={domain}
            maxLength={100}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
          />
        </div>
        <div className="field">
          <label htmlFor="edit-tenant-remark">备注</label>
          <textarea
            id="edit-tenant-remark"
            rows={3}
            placeholder="选填，如联系人、用途说明…"
            value={remark}
            maxLength={120}
            onChange={(e) => setRemark(e.target.value)}
          />
        </div>
        <div className="field">
          <label id="edit-tenant-active-label">
            状态
            <span
              className="info-tip"
              tabIndex={0}
              data-tip="停用后，使用该密钥的网站将无法接入客服。"
              aria-label="停用后，使用该密钥的网站将无法接入客服。"
            >i</span>
          </label>
          <label className="switch" aria-labelledby="edit-tenant-active-label">
            <input
              type="checkbox"
              role="switch"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span className="track" aria-hidden="true" />
            <span className="switch-label">{active ? '启用中' : '已停用'}</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onClose}>取消</button>
          <button className={`dialog-confirm${saving ? ' loading' : ''}`} disabled={!name.trim() || saving} onClick={submit}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 新建租户弹窗：租户名称必填、域名/备注可选；ID 与密钥由服务端自动生成。 */
function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = name.trim();
    if (!value || saving) return;
    setSaving(true);
    const post = (body: Record<string, string>) =>
      requestJson<{ key: Tenant }>('/api/widget-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      await post({ name: value, domain: domain.trim(), remark: remark.trim() });
      onCreated();
    } catch (err: any) {
      // 旧版后端要求前端传 key：用相同算法在前端生成后重试
      if (err?.message === 'key is required') {
        try {
          await post({
            name: value, domain: domain.trim(), remark: remark.trim(), key: genTenantKey(),
          });
          showToast('后端为旧版本：密钥已由前端生成，域名/备注等新字段可能未保存', 'info');
          onCreated();
          return;
        } catch { /* 落回通用错误提示 */ }
      }
      showToast('创建失败，请重试', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="新建租户" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">新建租户</h3>
        <div className="field">
          <label htmlFor="tenant-name">租户名称 <i className="req">*</i></label>
          <input
            id="tenant-name"
            autoFocus
            placeholder="如客户 / 站点名"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
          />
        </div>
        <div className="field">
          <label htmlFor="tenant-domain">租户域名</label>
          <input
            id="tenant-domain"
            placeholder="如 www.example.com"
            value={domain}
            maxLength={100}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
          />
        </div>
        <div className="field">
          <label htmlFor="tenant-remark">备注</label>
          <textarea
            id="tenant-remark"
            rows={3}
            placeholder="选填，如联系人、用途说明…"
            value={remark}
            maxLength={120}
            onChange={(e) => setRemark(e.target.value)}
          />
        </div>
        <p className="field-hint">租户ID 与租户密钥将自动生成，创建后可在列表中复制密钥。</p>
        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onClose}>取消</button>
          <button className={`dialog-confirm${saving ? ' loading' : ''}`} disabled={!name.trim() || saving} onClick={submit}>
            {saving ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  bot: 'AI 回答中',
  waiting_human: '待跟进',
  assigned: '接待中',
  closed: '已关闭',
};

/** 租户详情弹窗：展示会话量、设备类型、请求来源、近 7 天趋势。 */
function TenantStatsModal({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    requestJson<{ stats: TenantStats }>(`/api/widget-keys/${encodeURIComponent(tenant.key)}/stats`)
      .then((d) => setStats(d.stats))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [tenant.key]);

  const maxDaily = stats ? Math.max(...stats.dailySessions.map((d) => d.count), 1) : 1;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" role="dialog" aria-label="租户详情" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">租户详情 · {tenant.name}</h3>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : error ? (
          <div className="stats-loading">加载失败，请关闭后重试</div>
        ) : stats ? (
          <div className="stats-body">
            {/* 顶部数字卡片 */}
            <div className="stats-cards">
              <div className="stats-card">
                <span className="stats-card-value">{stats.totalSessions}</span>
                <span className="stats-card-label">累计会话</span>
              </div>
              <div className="stats-card">
                <span className="stats-card-value">{stats.recentSessions}</span>
                <span className="stats-card-label">近 7 天会话</span>
              </div>
              <div className="stats-card">
                <span className="stats-card-value">{stats.deviceBreakdown.mobile}</span>
                <span className="stats-card-label">移动端</span>
              </div>
              <div className="stats-card">
                <span className="stats-card-value">{stats.deviceBreakdown.desktop}</span>
                <span className="stats-card-label">桌面端</span>
              </div>
            </div>

            {/* 近 7 天趋势柱状图 */}
            <div className="stats-section">
              <div className="stats-section-title">近 7 天会话趋势</div>
              <div className="stats-bar-chart">
                {stats.dailySessions.map(({ date, count }) => (
                  <div key={date} className="stats-bar-col">
                    <span className="stats-bar-count">{count || ''}</span>
                    <div
                      className="stats-bar"
                      style={{ height: `${Math.round((count / maxDaily) * 60)}px` }}
                      title={`${date}: ${count} 次`}
                    />
                    <span className="stats-bar-label">{date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 状态分布 */}
            <div className="stats-row">
              <div className="stats-section stats-half">
                <div className="stats-section-title">会话状态分布</div>
                <div className="stats-list">
                  {Object.entries(stats.statusBreakdown).map(([status, count]) => (
                    <div key={status} className="stats-list-row">
                      <span className={`tag tag-${status === 'assigned' ? 'success' : status === 'waiting_human' ? 'warning' : 'info'}`}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                      <span className="stats-list-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 请求来源 */}
              <div className="stats-section stats-half">
                <div className="stats-section-title">请求来源（TOP 5）</div>
                {stats.topSources.length === 0 ? (
                  <div className="stats-empty">暂无来源数据</div>
                ) : (
                  <div className="stats-list">
                    {stats.topSources.map(({ url, count }) => (
                      <div key={url} className="stats-list-row">
                        <span className="stats-source-url" title={url}>{url}</span>
                        <span className="stats-list-count">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button className="dialog-confirm" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
