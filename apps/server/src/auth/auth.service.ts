import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { appConfig } from '../config.js';
import {
  signToken,
  verifyToken,
  verifyPassword,
  signSseTicket,
  verifySseTicket,
  type AgentRole,
} from './jwt.js';

export interface AgentAccount {
  id: string;
  name: string;
  salt: string;
  passwordHash: string;
  role?: AgentRole;
}

export interface AuthenticatedAgent {
  id: string;
  name: string;
  role: AgentRole;
}

/**
 * JWT 签名密钥解析（优先级）：
 *   1. 显式环境变量 AUTH_SECRET（多实例/生产推荐，确保各实例一致）
 *   2. 数据目录下持久化的 .auth_secret（自动生成一次，之后复用——重启/同卷多次启动保持一致）
 *   3. 兜底：本进程内存随机值（写盘失败时，重启会变、多实例不一致）
 * 不再因缺失而拒绝启动；未显式配置时自动生成并持久化。
 */
function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }
  const dir = process.env.DATA_DIR || appConfig.dataDir;
  const file = path.join(dir, '.auth_secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* 文件不存在 → 生成 */
  }
  const generated = randomBytes(32).toString('hex');
  let persisted = false;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    persisted = true;
  } catch {
    /* 只读卷等 → 退化为内存随机值 */
  }
  if (process.env.NODE_ENV === 'production') {
    new Logger('AuthService').warn(
      persisted
        ? '未配置 AUTH_SECRET，已自动生成并持久化到 DATA_DIR/.auth_secret。多实例部署请显式设置统一的 AUTH_SECRET。'
        : '未配置 AUTH_SECRET 且无法写入数据目录，本次使用内存随机密钥：重启后客服需重新登录，多实例之间 token 不互认。建议显式设置 AUTH_SECRET。'
    );
  }
  return generated;
}

/** 客服账号鉴权：账号在 data/agents.json，密码 scrypt 哈希存储，登录签发 JWT。 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private accounts: AgentAccount[] = [];
  private readonly secret = resolveAuthSecret();

  async onModuleInit() {
    this.accounts = JSON.parse(
      await fs.readFile(path.join(appConfig.dataDir, 'agents.json'), 'utf8')
    );
    // 生产环境若仍在使用演示弱口令（123456），高声告警，提示替换 agents.json
    if (process.env.NODE_ENV === 'production') {
      const weak = this.accounts.filter((a) =>
        verifyPassword('123456', a.salt, a.passwordHash)
      );
      if (weak.length) {
        this.logger.error(
          `检测到 ${weak.length} 个账号仍使用演示弱口令（123456）：${weak
            .map((a) => a.id)
            .join(', ')}。生产环境请立即替换 data/agents.json 的口令哈希。`
        );
      }
    }
  }

  login(agentNo: string, password: string): { token: string; agent: AuthenticatedAgent } | null {
    const account = this.accounts.find((item) => item.id === String(agentNo || '').trim());
    if (!account || !verifyPassword(String(password || ''), account.salt, account.passwordHash)) {
      return null;
    }
    const role: AgentRole = account.role === 'admin' ? 'admin' : 'agent';
    return {
      token: signToken({ sub: account.id, name: account.name, role }, this.secret),
      agent: { id: account.id, name: account.name, role },
    };
  }

  verify(token: string): AuthenticatedAgent | null {
    const claims = verifyToken(token, this.secret);
    return claims ? { id: claims.sub, name: claims.name, role: claims.role } : null;
  }

  /** 签发 60s 短时 SSE 票据（供 EventSource 用 ?ticket= 连接，避免长效 JWT 进 URL/日志） */
  issueSseTicket(agent: AuthenticatedAgent): string {
    return signSseTicket({ sub: agent.id, name: agent.name, role: agent.role }, this.secret);
  }

  verifySseTicket(ticket: string): AuthenticatedAgent | null {
    const claims = verifySseTicket(ticket, this.secret);
    return claims ? { id: claims.sub, name: claims.name, role: claims.role } : null;
  }
}
