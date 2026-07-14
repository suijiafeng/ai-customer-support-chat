import 'reflect-metadata';
import path from 'node:path';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module.js';
import { appConfig } from './config.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ResponseInterceptor } from './common/response.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.set('trust proxy', appConfig.trustProxy);
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors(
    corsOrigins.length
      ? { origin: corsOrigins, allowedHeaders: ['Authorization', 'Content-Type'], methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }
      : {}
  );
  app.useBodyParser('json', { limit: '12mb' });
  app.enableShutdownHooks();

  // SSE 反缓冲头（Nginx/边缘代理不缓冲事件流）必须在响应头发出前设置：
  // @Sse 路由由 Nest 先 writeHead 再执行拦截器，只能用前置中间件；
  // Cache-Control 由 SseStream 的 writeHead 自带 no-cache, no-transform，无需重复设置。
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.accept?.includes('text/event-stream')) {
      res.setHeader('X-Accel-Buffering', 'no');
    }
    next();
  });

  // 三个内置静态站点均可用环境变量单独关闭（见 config.ts），关闭后对应路径 404
  if (appConfig.widgetEnabled) {
    app.use(
      '/widget',
      express.static(appConfig.staticDirs.widget, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('.js')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        },
      })
    );
  }
  if (appConfig.workstationEnabled) {
    app.use(
      '/workstation',
      express.static(appConfig.staticDirs.workstation, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        },
      })
    );
  }

  // 演示站：DEMO_ENABLED=false 时不挂载（对外只暴露 API/widget/工作台，根路径 404）
  const demoIndex = path.join(appConfig.staticDirs.demo, 'index.html');
  const serveDemo = appConfig.demoEnabled && fs.existsSync(demoIndex);
  if (serveDemo) {
    // demo 静态资源（/assets/*.js, /assets/*.css, /favicon.svg 等）直接从 demo dist 目录伺服
    app.use(express.static(appConfig.staticDirs.demo));
  }
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const reserved = ['/api', '/widget', '/workstation'];
    if (
      serveDemo &&
      req.method === 'GET' &&
      !reserved.some((prefix) => req.path.startsWith(prefix)) &&
      req.accepts('html')
    ) {
      return res.sendFile(demoIndex);
    }
    next();
  });

  await app.listen(appConfig.port);
  console.log(`AssistFlow server running at http://localhost:${appConfig.port}`);

  const httpServer = app.getHttpServer();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => httpServer.closeAllConnections());
  }
}

bootstrap();
