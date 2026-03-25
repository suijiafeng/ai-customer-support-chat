import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Tenant } from '@assistflow/shared';
import { fmtTime, requestJson } from '../api.js';
import { showToast, confirmDialog } from '../ui/feedback.js';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await requestJson<{ keys: Tenant[] }>('/api/widget-keys');
      setTenants(data.keys || []);
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

  const onCreated = useCallback((tenant: Tenant) => {
    setTenants((list) => {
      const next = [...list, tenant];
      // 新租户排在列表末尾，翻到最后一页让它可见
      setPage(Math.max(1, Math.ceil(next.length / PAGE_SIZE)));
      return next;
    });
    setQuery('');
    setShowCreate(false);
    showToast('租户已创建，密钥已自动生成', 'success');
  }, []);

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
        <div className="empty"><span className="ico" aria-hidden="true">⚠️</span>加载失败<button className="retry-btn" onClick={load}>重试</button></div>
      ) : loading ? (
        <div className="empty">加载中…</div>
      ) : !tenants.length ? (
        <div className="empty"><span className="ico" aria-hidden="true">🏢</span>暂无租户，访客将无法接入客服</div>
      ) : !filtered.length ? (
        <div className="empty"><span className="ico" aria-hidden="true">🔍</span>未找到匹配「{query.trim()}」的租户</div>
      ) : (
        <>
          <div className="ticket-table-wrap">
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
          <button className="dialog-confirm" disabled={!name.trim() || saving} onClick={submit}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 新建租户弹窗：租户名称必填、域名/备注可选；ID 与密钥由服务端自动生成。 */
function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Tenant) => void }) {
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
      const data = await post({ name: value, domain: domain.trim(), remark: remark.trim() });
      onCreated(data.key);
    } catch (err: any) {
      // 旧版后端要求前端传 key：用相同算法在前端生成后重试
      if (err?.message === 'key is required') {
        try {
          const data = await post({
            name: value, domain: domain.trim(), remark: remark.trim(), key: genTenantKey(),
          });
          onCreated(data.key);
          showToast('后端为旧版本：密钥已由前端生成，域名/备注等新字段可能未保存', 'info');
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
          <button className="dialog-confirm" disabled={!name.trim() || saving} onClick={submit}>
            {saving ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
