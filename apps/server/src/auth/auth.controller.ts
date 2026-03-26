import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AgentAuthGuard } from './auth.guard.js';
import { AuthService, type AuthenticatedAgent } from './auth.service.js';

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

  @UseGuards(AgentAuthGuard)
  @Post('sse-ticket')
  sseTicket(@Req() req: any) {
    return { ticket: this.auth.issueSseTicket(req.agent as AuthenticatedAgent) };
  }
}
