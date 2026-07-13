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

  app.use(
    '/widget',
    express.static(appConfig.staticDirs.widget, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      },
    })
  );
  app.use(
    '/workstation',
    express.static(appConfig.staticDirs.workstation, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      },
    })
  );

  const demoIndex = path.join(appConfig.staticDirs.demo, 'index.html');
  const hasDemoIndex = fs.existsSync(demoIndex);
  if (hasDemoIndex) {
    // demo 静态资源（/assets/*.js, /assets/*.css, /favicon.svg 等）直接从 demo dist 目录伺服
    app.use(express.static(appConfig.staticDirs.demo));
  }
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const reserved = ['/api', '/widget', '/workstation'];
    if (
      hasDemoIndex &&
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
