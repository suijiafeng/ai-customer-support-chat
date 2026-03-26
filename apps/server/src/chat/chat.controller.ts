import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { ClientMeta } from '../common/normalize.js';
import { WidgetKeysService } from '../widget-keys/widget-keys.service.js';
import { ChatService } from './chat.service.js';

const MAX_MESSAGE_LENGTH = 2000;

@SkipThrottle({ login: true })
@Controller('api/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chat: ChatService,
    private readonly widgetKeys: WidgetKeysService
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post()
  async chatHandler(@Body() body: any, @Req() req: Request) {
    this.assertHasContent(body);
    this.assertValidSiteKey(body, req);
    try {
      return await this.chat.handleChat(body, undefined, this.clientMeta(req));
    } catch (error: any) {
      this.logger.error(`[POST /api/chat] 处理失败: ${error?.stack || error}`);
      throw new InternalServerErrorException({
        error: 'chat workflow failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
      });
    }
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post('stream')
  async chatStream(@Body() body: any, @Res() res: Response, @Req() req: Request) {
    this.assertHasContent(body);
    this.assertValidSiteKey(body, req);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const emit = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.chat.handleChat(
        body,
        (delta) => emit('delta', { text: delta }),
        this.clientMeta(req)
      );
      emit('done', result);
    } catch (error: any) {
      this.logger.error(`[POST /api/chat/stream] 处理失败: ${error?.stack || error}`);
      emit('error', {
        error: 'chat workflow failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
      });
    } finally {
      res.end();
    }
  }

  private clientMeta(req: Request): ClientMeta {
    const xffRaw = req.headers['x-forwarded-for'];
    const xff = Array.isArray(xffRaw) ? xffRaw[0] : xffRaw;
    const forwardedIp = String(xff || '').split(',')[0].trim();
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    const ipRaw = forwardedIp || realIp || req.ip || '';
    const ip = ipRaw.startsWith('::ffff:') ? ipRaw.slice(7) : ipRaw;
    return { ip: ip || null, userAgent: req.headers['user-agent'] ?? null };
  }

  private assertHasContent(body: any) {
    const message = String(body?.message || '').trim();
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!message && attachments.length === 0) {
      throw new BadRequestException({ error: 'message or attachments required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ error: `message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    }
  }

  private assertValidSiteKey(body: any, req: Request) {
    const source = (req.headers.origin as string) || (req.headers.referer as string) || '';
    let originHost: string | null = null;
    try {
      originHost = source ? new URL(source).hostname.toLowerCase() : null;
    } catch {
      originHost = null;
    }
    const verdict = this.widgetKeys.verify(body?.siteKey, body?.tenantId, originHost);
    if (verdict !== 'ok') {
      throw new ForbiddenException({ error: verdict });
    }
  }
}
