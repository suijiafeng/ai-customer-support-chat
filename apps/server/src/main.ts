import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module.js';
import { appConfig } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.enableCors();
  app.useBodyParser('json', { limit: '12mb' });
  app.enableShutdownHooks();

  // 静态产物挂载表：后端不感知演示站的内容，只按部署配置托管构建产物。
  // widget.js 文件名固定（无内容哈希），用 no-cache 强制浏览器每次校验
  app.use(
    '/widget',
    express.static(appConfig.staticDirs.widget, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      },
    })
  );
  // 工作台构建产物（资源带哈希；index.html 用 no-cache 以便总是拉到最新哈希）
  app.use(
    '/workstation',
    express.static(appConfig.staticDirs.workstation, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      },
    })
  );

  // 演示站挂在根路径；后端只托管其构建产物，不感知演示内容
  app.use(
    express.static(appConfig.staticDirs.demo, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      },
    })
  );

  // 演示站是 SPA：未命中 API/静态产物的 GET 页面请求回退到 demo 入口
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const reserved = ['/api', '/widget', '/workstation'];
    if (
      req.method === 'GET' &&
      !reserved.some((prefix) => req.path.startsWith(prefix)) &&
      req.accepts('html')
    ) {
      return res.sendFile(path.join(appConfig.staticDirs.demo, 'index.html'));
    }
    next();
  });

  await app.listen(appConfig.port);
  console.log(`AssistFlow server (NestJS) running at http://localhost:${appConfig.port}`);
}

bootstrap();
