import {
  BadRequestException,
  Body,
  Controller,
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
import { ChatService } from './chat.service.js';

const MAX_MESSAGE_LENGTH = 2000;

// ThrottlerGuard 会对全局注册的每个具名限流组逐一校验，而不仅是 @Throttle 里覆盖的那组，
// 因此这里显式跳过 login 组，避免聊天接口被更严格的登录限流（5/分钟）误伤。
@SkipThrottle({ login: true })
@Controller('api/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post()
  async chatHandler(@Body() body: any, @Req() req: Request) {
    this.assertHasContent(body);

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

  /**
   * 流式对话：SSE over POST。
   * AI（DeepSeek）回复边生成边推 `delta` 事件；结束推 `done`（完整 ChatResponse，
   * 与 POST /api/chat 同构）。规则回复/未启用 AI 时没有 delta，直接一个 done。
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post('stream')
  async chatStream(@Body() body: any, @Res() res: Response, @Req() req: Request) {
    this.assertHasContent(body);

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

  /** 采集请求侧元信息：真实客户端 IP（依赖 trust proxy）与 User-Agent。 */
  private clientMeta(req: Request): ClientMeta {
    const xffRaw = req.headers['x-forwarded-for'];
    const xff = Array.isArray(xffRaw) ? xffRaw[0] : xffRaw;
    const forwardedIp = String(xff || '')
      .split(',')[0]
      .trim();
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    const ipRaw = forwardedIp || realIp || req.ip || '';
    const ip = ipRaw.startsWith('::ffff:') ? ipRaw.slice(7) : ipRaw;
    return { ip: ip || null, userAgent: req.headers['user-agent'] ?? null };
  }

  private assertHasContent(body: any) {
    const message = String(body?.message || '').trim();
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

    // 允许「纯图片」消息：有文字或有图片即可
    if (!message && attachments.length === 0) {
      throw new BadRequestException({ error: 'message or attachments required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ error: `message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    }
  }
}
