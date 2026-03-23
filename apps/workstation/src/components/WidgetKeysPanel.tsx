import React, { useCallback, useEffect, useState } from 'react';
import type { WidgetKey } from '@assistflow/shared';
import { fmtTime, requestJson } from '../api.js';
import { showToast, confirmDialog } from '../ui/feedback.js';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('zh-CN')} ${fmtTime(iso)}`;
}

/** Widget 接入密钥管理：admin 专属，创建/启停/删除每个站点的接入密钥。 */
export default function WidgetKeysPanel() {
  const [keys, setKeys] = useState<WidgetKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await requestJson<{ keys: WidgetKey[] }>('/api/widget-keys');
      setKeys(data.keys || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    const key = newKey.trim();
    if (!key || creating) return;
    setCreating(true);
    try {
      const data = await requestJson<{ key: WidgetKey }>('/api/widget-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name: newName.trim() }),
      });
      setKeys((list) => [...list, data.key]);
      setNewKey('');
      setNewName('');
    } catch (err: any) {
      showToast(err?.message === 'key already exists' ? '该 key 已存在' : '创建失败，请重试', 'error');
    } finally {
      setCreating(false);
    }
  }, [newKey, newName, creating]);

  const toggleActive = useCallback(async (item: WidgetKey) => {
    try {
      const data = await requestJson<{ key: WidgetKey }>(`/api/widget-keys/${encodeURIComponent(item.key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !item.active }),
      });
      setKeys((list) => list.map((k) => (k.key === data.key.key ? data.key : k)));
    } catch {
      showToast('操作失败，请重试', 'error');
    }
  }, []);

  const remove = useCallback(async (item: WidgetKey) => {
    const ok = await confirmDialog(`确认删除密钥「${item.name || item.key}」？删除后使用该密钥的网站将无法接入客服。`, {
      confirmText: '删除',
    });
    if (!ok) return;
    try {
      await requestJson(`/api/widget-keys/${encodeURIComponent(item.key)}`, { method: 'DELETE' });
      setKeys((list) => list.filter((k) => k.key !== item.key));
    } catch {
      showToast('删除失败，请重试', 'error');
    }
  }, []);

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="filter-tabs" role="tablist">
          <span>Widget 密钥（{keys.length}）</span>
        </div>
        <div className="toolbar-right">
          <button className="ghost-btn" onClick={load}>刷新</button>
        </div>
      </div>

      <div className="key-form">
        <input
          placeholder="key（如 acme-corp，需与网站嵌入代码里的 data-key 一致）"
          value={newKey}
          maxLength={64}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          placeholder="名称（备注用，如客户名）"
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="claim-like-btn" disabled={!newKey.trim() || creating} onClick={create}>
          {creating ? '创建中…' : '新建密钥'}
        </button>
      </div>

      {error ? (
        <div className="empty"><span className="ico" aria-hidden="true">⚠️</span>加载失败<button className="retry-btn" onClick={load}>重试</button></div>
      ) : loading ? (
        <div className="empty">加载中…</div>
      ) : !keys.length ? (
        <div className="empty"><span className="ico" aria-hidden="true">🔑</span>暂无密钥，访客将无法接入客服</div>
      ) : (
        <div className="ticket-table-wrap">
          <table className="ticket-table">
            <thead>
              <tr>
                <th>名称</th><th>key</th><th>状态</th><th>创建时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.key}>
                  <td>{k.name || '—'}</td>
                  <td className="mono">{k.key}</td>
                  <td><span className={`tag tag-${k.active ? 'success' : 'info'}`}>{k.active ? '启用中' : '已停用'}</span></td>
                  <td className="mono">{fmtDate(k.createdAt)}</td>
                  <td className="ops">
                    <button className="ghost-btn" onClick={() => toggleActive(k)}>{k.active ? '停用' : '启用'}</button>
                    <button className="ghost-btn" onClick={() => remove(k)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
