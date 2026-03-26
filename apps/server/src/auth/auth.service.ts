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

function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const dir = process.env.DATA_DIR || appConfig.dataDir;
  const file = path.join(dir, '.auth_secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const generated = randomBytes(32).toString('hex');
  let persisted = false;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    persisted = true;
  } catch {}
  if (process.env.NODE_ENV === 'production') {
    new Logger('AuthService').warn(
      persisted
        ? '未配置 AUTH_SECRET，已自动生成并持久化到 DATA_DIR/.auth_secret。多实例部署请显式设置统一的 AUTH_SECRET。'
        : '未配置 AUTH_SECRET 且无法写入数据目录，本次使用内存随机密钥：重启后客服需重新登录。建议显式设置 AUTH_SECRET。'
    );
  }
  return generated;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private accounts: AgentAccount[] = [];
  private readonly secret = resolveAuthSecret();

  async onModuleInit() {
    this.accounts = JSON.parse(
      await fs.readFile(path.join(appConfig.dataDir, 'agents.json'), 'utf8')
    );
    if (process.env.NODE_ENV === 'production') {
      const weak = this.accounts.filter((a) => verifyPassword('123456', a.salt, a.passwordHash));
      if (weak.length) {
        this.logger.error(
          `检测到 ${weak.length} 个账号使用演示弱口令（123456）：${weak.map((a) => a.id).join(', ')}。生产环境请立即替换 data/agents.json 的口令哈希。`
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

  issueSseTicket(agent: AuthenticatedAgent): string {
    return signSseTicket({ sub: agent.id, name: agent.name, role: agent.role }, this.secret);
  }

  verifySseTicket(ticket: string): AuthenticatedAgent | null {
    const claims = verifySseTicket(ticket, this.secret);
    return claims ? { id: claims.sub, name: claims.name, role: claims.role } : null;
  }
}
