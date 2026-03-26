import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { WidgetKeysService } from './widget-keys.service.js';

/** 租户管理（原 Widget 接入密钥）：仅 admin 可创建/启停/删除。 */
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
    return { key: this.widgetKeys.create(body?.name, body?.key, body?.remark, body?.domain) };
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() body: any, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    const patch: { name?: string; domain?: string; remark?: string; active?: boolean } = {};
    if (body?.name !== undefined) patch.name = body.name;
    if (body?.domain !== undefined) patch.domain = body.domain;
    if (body?.remark !== undefined) patch.remark = body.remark;
    if (body?.active !== undefined) patch.active = Boolean(body.active);
    return { key: this.widgetKeys.update(key, patch) };
  }

  @Get(':key/stats')
  stats(@Param('key') key: string, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    return { stats: this.widgetKeys.getStats(key) };
  }

  @Delete(':key')
  remove(@Param('key') key: string, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    this.widgetKeys.remove(key);
    return { ok: true };
  }
}
