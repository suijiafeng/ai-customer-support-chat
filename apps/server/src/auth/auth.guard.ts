import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { agent?: unknown }>();
    const header = String(req.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    let agent = bearer ? this.auth.verify(bearer) : null;
    if (!agent) {
      const ticket = String(req.query?.ticket || '');
      if (ticket) agent = this.auth.verifySseTicket(ticket);
    }
    if (!agent) {
      throw new UnauthorizedException({ error: 'agent authentication required' });
    }
    req.agent = agent;
    return true;
  }
}
