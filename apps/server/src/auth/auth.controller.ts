import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: any) {
    const result = this.auth.login(body?.agentNo, body?.password);
    if (!result) {
      throw new UnauthorizedException({ error: 'invalid agent number or password' });
    }
    return result;
  }
}
