import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';

/**
 * 客服侧接口守卫：Authorization: Bearer <jwt>；
 * SSE（EventSource 无法带请求头）允许 ?token= 传递。
 * 通过后把客服身份挂到 req.agent，业务端不再信任请求体里的身份。
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { agent?: unknown }>();
    const header = String(req.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const token = bearer || String(req.query?.token || '');
    const agent = token ? this.auth.verify(token) : null;

    if (!agent) {
      throw new UnauthorizedException({ error: 'agent authentication required' });
    }

    req.agent = agent;
    return true;
  }
}
