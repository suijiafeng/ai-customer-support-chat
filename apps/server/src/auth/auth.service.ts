import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { appConfig } from '../config.js';
import { signToken, verifyToken, verifyPassword } from './jwt.js';

export interface AgentAccount {
  id: string;
  name: string;
  salt: string;
  passwordHash: string;
}

export interface AuthenticatedAgent {
  id: string;
  name: string;
}

/** 客服账号鉴权：账号在 data/agents.json，密码 scrypt 哈希存储，登录签发 JWT。 */
@Injectable()
export class AuthService implements OnModuleInit {
  private accounts: AgentAccount[] = [];
  private readonly secret = process.env.AUTH_SECRET || 'assistflow-dev-secret';

  async onModuleInit() {
    this.accounts = JSON.parse(
      await fs.readFile(path.join(appConfig.dataDir, 'agents.json'), 'utf8')
    );
  }

  login(agentNo: string, password: string): { token: string; agent: AuthenticatedAgent } | null {
    const account = this.accounts.find((item) => item.id === String(agentNo || '').trim());
    if (!account || !verifyPassword(String(password || ''), account.salt, account.passwordHash)) {
      return null;
    }
    return {
      token: signToken({ sub: account.id, name: account.name }, this.secret),
      agent: { id: account.id, name: account.name },
    };
  }

  verify(token: string): AuthenticatedAgent | null {
    const claims = verifyToken(token, this.secret);
    return claims ? { id: claims.sub, name: claims.name } : null;
  }
}
