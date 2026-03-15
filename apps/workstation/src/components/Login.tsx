import React, { useState } from 'react';
import { login, type AgentIdentity } from '../api.js';

interface LoginProps {
  onLogin: (agent: AgentIdentity) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [agentNo, setAgentNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentNo.trim() || !password || loading) return;
    setLoading(true);
    setError('');
    try {
      onLogin(await login(agentNo.trim(), password));
    } catch {
      setError('工号或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">AssistFlow 客服工作台</div>
        <p className="login-tip">请使用客服工号登录</p>
        <label>
          工号
          <input
            value={agentNo}
            autoFocus
            autoComplete="username"
            placeholder="请输入工号"
            onChange={(e) => setAgentNo(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="请输入密码"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" disabled={!agentNo.trim() || !password || loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
