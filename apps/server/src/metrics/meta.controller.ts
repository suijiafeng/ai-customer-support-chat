import { Controller, Get, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { appConfig } from '../config.js';
import { AiService } from '../ai/ai.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { StoreService } from '../store/store.service.js';
import { MetricsService } from './metrics.service.js';

@Controller('api')
export class MetaController {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
    private readonly tickets: TicketsService,
    private readonly store: StoreService,
    private readonly metrics: MetricsService
  ) {}

  @Get('health')
  health() {
    const stats = this.store.stats();
    return {
      ok: true,
      aiEnabled: Boolean(this.ai.getActiveClient()),
      aiFeatureEnabled: appConfig.aiFeatureEnabled,
      aiConfigured: Boolean(this.ai.getConfiguredClient()),
      aiProvider: this.ai.provider,
      model: this.ai.getActiveModel(),
      faqCount: this.knowledge.faqs.length,
      inquiryCount: this.knowledge.inquiries.length,
      ticketCount: this.tickets.all.length,
      persistence: {
        backend: process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
        enabled: this.store.enabled,
        degraded: this.store.degraded,
        writeErrors: stats.writeErrors,
      },
    };
  }

  @Get('faqs')
  faqs() {
    return {
      faqs: this.knowledge.faqs.map(({ keywords: _keywords, ...rest }) => rest),
    };
  }

  @UseGuards(AgentAuthGuard)
  @Get('metrics')
  metricsHandler() {
    return this.metrics.buildMetrics();
  }

  @UseGuards(AgentAuthGuard)
  @Get('metrics/trend')
  async trend() {
    return { trend: await this.metrics.getTrend(14) };
  }

  @UseGuards(AgentAuthGuard)
  @Get('knowledge/stats')
  knowledgeStats() {
    return this.knowledge.getStats(20);
  }
}
