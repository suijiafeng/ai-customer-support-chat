import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { WidgetKeysService } from './widget-keys.service.js';

/** Widget 接入密钥管理：仅 admin 可创建/启停/删除。 */
@UseGuards(AgentAuthGuard)
@Controller('api/widget-keys')
export class WidgetKeysController {
  constructor(private readonly widgetKeys: WidgetKeysService) {}

  private assertAdmin(agent: AuthenticatedAgent) {
    if (agent.role !== 'admin') {
      throw new ForbiddenException({ error: 'admin only' });
    }
  }

  @Get()
  list(@Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    return { keys: this.widgetKeys.list() };
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    return { key: this.widgetKeys.create(body?.key, body?.name) };
  }

  @Patch(':key')
  setActive(@Param('key') key: string, @Body() body: any, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    return { key: this.widgetKeys.setActive(key, Boolean(body?.active)) };
  }

  @Delete(':key')
  remove(@Param('key') key: string, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    this.widgetKeys.remove(key);
    return { ok: true };
  }
}
