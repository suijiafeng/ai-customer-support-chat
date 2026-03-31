import React, { useEffect, useRef, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { fmtTime, getLoginAt, type AgentIdentity } from '../api.js';

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

/** 右上角客服入口：头像+名称，点击下拉显示个人信息；个人中心打开详情弹窗。 */
export default function AgentMenu({ agent, sessions, onLogout }: AgentMenuProps) {
  const [open, setOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const wrapEl = useRef<HTMLDivElement | null>(null);

  // 点击菜单外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapEl.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
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
      <button
        className="agent-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar-badge" style={{ background: color }}>{initials}</span>
        <span className="agent-name">
          {agent.name}
          {agent.role === 'admin' && <span className="role-badge">管理员</span>}
        </span>
        <span className={`caret${open ? ' up' : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="agent-dropdown" role="menu">

          <div className="agent-actions">
            <button role="menuitem" onClick={() => { setShowProfile(true); setOpen(false); }}>
              👤 个人中心
            </button>
            <button role="menuitem" className="danger" onClick={onLogout}>
              ⏻ 退出登录
            </button>
          </div>
        </div>
      )}

      {showProfile && (
        <div className="profile-overlay" onClick={() => setShowProfile(false)}>
          <div
            className="profile-modal"
            role="dialog"
            aria-label="个人中心"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="profile-close" aria-label="关闭" onClick={() => setShowProfile(false)}>×</button>
            <div className="profile-head">
              <span className="avatar-badge xl" style={{ background: color }}>{initials}</span>
              <div>
                <strong>{agent.name}</strong>
                <p>客服工号 {agent.id} · <span className="online"><i aria-hidden="true" />在线</span></p>
              </div>
            </div>
            <dl className="profile-detail">
              <div><dt>工号</dt><dd>{agent.id}</dd></div>
              <div><dt>显示名称</dt><dd>{agent.name}</dd></div>
              <div><dt>本次登录</dt><dd>{loginAt ? `${new Date(loginAt).toLocaleDateString('zh-CN')} ${fmtTime(loginAt)}` : '—'}</dd></div>
              <div><dt>接待中会话</dt><dd>{myActive}</dd></div>
              <div><dt>已解决会话</dt><dd>{myResolved}</dd></div>
            </dl>
            <p className="profile-note">账号信息由管理员在服务端配置，如需修改密码请联系管理员。</p>
          </div>
        </div>
      )}
    </div>
  );
}
