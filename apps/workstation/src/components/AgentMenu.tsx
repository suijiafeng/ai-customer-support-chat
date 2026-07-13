import React, { useEffect, useRef, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { fmtTime, getLoginAt, type AgentIdentity } from '../api.js';
import Icon from '../ui/Icon.js';
import { useHistoryBack } from '../hooks/useHistoryBack.js';

interface AgentMenuProps {
  agent: AgentIdentity;
  sessions: SessionSummary[];
  onLogout: () => void;
}

// 头像底色：按工号取色，三个客服各不相同
const AVATAR_COLORS = ['#7c3aed', '#0e9f6e', '#d97706', '#2457c5'];
function avatarColor(id: string): string {
  const n = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

/** 右上角客服入口：触发器只显示头像+名称，点击下拉展开个人详情与操作。 */
export default function AgentMenu({ agent, sessions, onLogout }: AgentMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapEl = useRef<HTMLDivElement | null>(null);
  const close = useHistoryBack(open, () => setOpen(false));

  // 点击菜单外部 / 按 Esc 关闭下拉
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapEl.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const myActive = sessions.filter(
    (s) => s.assignedAgentId === agent.id && s.status !== 'closed'
  ).length;
  const myResolved = sessions.filter(
    (s) => s.assignedAgentId === agent.id && s.status === 'closed'
  ).length;
  const waiting = sessions.filter((s) => s.status === 'waiting_human').length;
  const loginAt = getLoginAt();
  const initials = agent.id.slice(-2);
  const color = avatarColor(agent.id);

  return (
    <div className="agent-menu" ref={wrapEl}>
      {/* 触发器：尽量简洁，只展示头像 + 名称 */}
      <button
        className="agent-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar-badge" style={{ background: color }}>{initials}</span>
        <span className="agent-name">{agent.name}</span>
        <Icon name="chevron-down" size={14} style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="agent-overlay" aria-hidden="true" onClick={close} />
      )}
      {open && (
        <div className="agent-drawer" role="menu" aria-label="个人信息">
          <button className="agent-drawer-close" aria-label="关闭" onClick={close}>
            <Icon name="x" size={18} />
          </button>
          {/* 详情头部：头像 + 名称 + 工号 + 在线 + 登录时间 */}
          <div className="agent-card">
            <span className="avatar-badge lg" style={{ background: color }}>{initials}</span>
            <div className="agent-card-info">
              <strong>
                {agent.name}
                {agent.role === 'admin' && <span className="role-badge">管理员</span>}
              </strong>
              <span>工号 {agent.id} · <span className="online"><i aria-hidden="true" />在线</span></span>
              <span>
                登录于 {loginAt
                  ? `${new Date(loginAt).toLocaleDateString('zh-CN')} ${fmtTime(loginAt)}`
                  : '—'}
              </span>
            </div>
          </div>

          {/* 工作量概览 */}
          <div className="agent-stats">
            <div><b>{myActive}</b><span>接待中</span></div>
            <div><b>{myResolved}</b><span>已解决</span></div>
            <div><b>{waiting}</b><span>待跟进</span></div>
          </div>
          <div className="agent-actions">
            <button role="menuitem" className="danger" onClick={() => { if (window.confirm('确认退出登录？')) onLogout(); }}>
              退出登录
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
