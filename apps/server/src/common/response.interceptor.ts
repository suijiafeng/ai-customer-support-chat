import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // SSE 长连接由 NestJS SseHandler 直接写流，跳过包装；同时关闭 Nginx 缓冲，保证事件即时到达客户端
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (req.headers?.accept?.includes('text/event-stream')) {
      const res = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache');
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({ code: 0, msg: 'ok', data: data ?? null }))
    );
  }
}
