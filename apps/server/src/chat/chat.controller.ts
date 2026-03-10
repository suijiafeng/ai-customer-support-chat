import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service.js';

@Controller('api/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Post()
  async chatHandler(@Body() body: any) {
    this.assertHasContent(body);

    try {
      return await this.chat.handleChat(body);
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
  @Post('stream')
  async chatStream(@Body() body: any, @Res() res: Response) {
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
      const result = await this.chat.handleChat(body, (delta) => emit('delta', { text: delta }));
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

  private assertHasContent(body: any) {
    const message = String(body?.message || '').trim();
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

    // 允许「纯图片」消息：有文字或有图片即可
    if (!message && attachments.length === 0) {
      throw new BadRequestException({ error: 'message or attachments required' });
    }
  }
}
