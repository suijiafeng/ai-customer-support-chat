import { BadRequestException, Body, Controller, InternalServerErrorException, Logger, Post } from '@nestjs/common';
import { ChatService } from './chat.service.js';

@Controller('api/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Post()
  async chatHandler(@Body() body: any) {
    const message = String(body?.message || '').trim();
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

    // 允许「纯图片」消息：有文字或有图片即可
    if (!message && attachments.length === 0) {
      throw new BadRequestException({ error: 'message or attachments required' });
    }

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
}
