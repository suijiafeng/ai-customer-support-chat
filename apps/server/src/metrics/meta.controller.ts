import { Controller, Get } from '@nestjs/common';
import { appConfig } from '../config.js';
import { AiService } from '../ai/ai.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { MetricsService } from './metrics.service.js';

@Controller('api')
export class MetaController {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
    private readonly tickets: TicketsService,
    private readonly metrics: MetricsService
  ) {}

  @Get('health')
  health() {
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
    };
  }

  @Get('faqs')
  faqs() {
    return { faqs: this.knowledge.faqs };
  }

  @Get('metrics')
  metricsHandler() {
    return this.metrics.buildMetrics();
  }
}
