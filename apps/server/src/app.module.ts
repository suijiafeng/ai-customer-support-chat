import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiService } from './ai/ai.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { ChatController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { KnowledgeService } from './knowledge/knowledge.service.js';
import { MetaController } from './metrics/meta.controller.js';
import { MetricsService } from './metrics/metrics.service.js';
import { SessionsController } from './sessions/sessions.controller.js';
import { SessionsService } from './sessions/sessions.service.js';
import { SseService } from './sse/sse.service.js';
import { StoreService } from './store/store.service.js';
import { TicketsController } from './tickets/tickets.controller.js';
import { TicketsService } from './tickets/tickets.service.js';
import { SessionTicketService } from './workflow/session-ticket.service.js';
import { WidgetKeysController } from './widget-keys/widget-keys.controller.js';
import { WidgetKeysService } from './widget-keys/widget-keys.service.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      // login 限速：每分钟每 IP 最多 5 次尝试，防暴力破解
      { name: 'login', ttl: 60000, limit: 5 },
      // chat 限速：每分钟每 IP 最多 20 次，/api/chat 会触发真实 LLM 调用（计费），防止被刷爆账单
      { name: 'chat', ttl: 60000, limit: 20 },
    ]),
  ],
  controllers: [
    AuthController,
    ChatController,
    SessionsController,
    TicketsController,
    MetaController,
    WidgetKeysController,
  ],
  providers: [
    AuthService,
    StoreService,
    KnowledgeService,
    AiService,
    SseService,
    SessionsService,
    TicketsService,
    MetricsService,
    SessionTicketService,
    WidgetKeysService,
    ChatService,
  ],
})
export class AppModule {}
