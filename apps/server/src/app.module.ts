import { Module } from '@nestjs/common';
import { AiService } from './ai/ai.service.js';
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

@Module({
  controllers: [ChatController, SessionsController, TicketsController, MetaController],
  providers: [
    StoreService,
    KnowledgeService,
    AiService,
    SseService,
    SessionsService,
    TicketsService,
    MetricsService,
    ChatService,
  ],
})
export class AppModule {}
