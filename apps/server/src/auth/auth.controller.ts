import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AgentAuthGuard } from './auth.guard.js';
import { AuthService, type AuthenticatedAgent } from './auth.service.js';

// 跳过 chat 限流组：ThrottlerGuard 会对所有全局注册的具名组逐一校验，登录/票据接口只应受 login 组约束。
@SkipThrottle({ chat: true })
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ login: { ttl: 60000, limit: 5 } })
  @Post('login')
  login(@Body() body: any) {
    const result = this.auth.login(body?.agentNo, body?.password);
    if (!result) {
      throw new UnauthorizedException({ error: 'invalid agent number or password' });
    }
    return result;
  }

  /** 用已登录身份换取一张 60s SSE 票据，供 EventSource ?ticket= 使用 */
  @UseGuards(AgentAuthGuard)
  @Post('sse-ticket')
  sseTicket(@Req() req: any) {
    return { ticket: this.auth.issueSseTicket(req.agent as AuthenticatedAgent) };
  }
}
