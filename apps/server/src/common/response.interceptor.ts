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
    // SSE 长连接由 NestJS SseHandler 直接写流，跳过包装。
    // 注意：@Sse 路由的响应头在拦截器执行前就已写出（Nest 先 writeHead 再订阅），
    // 这里不能 setHeader（会抛 Cannot set headers after they are sent 并打断整条流），
    // 反缓冲头改由 main.ts 的前置中间件设置。
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (req.headers?.accept?.includes('text/event-stream')) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({ code: 0, msg: 'ok', data: data ?? null }))
    );
  }
}
