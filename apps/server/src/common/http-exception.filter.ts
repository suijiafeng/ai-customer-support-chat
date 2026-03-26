import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let msg: string;
      let data: Record<string, unknown> | null = null;

      if (typeof body === 'string') {
        msg = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        msg = String(b.error ?? b.message ?? exception.message);
        const extra = Object.fromEntries(
          Object.entries(b).filter(([k]) => !['error', 'message', 'statusCode'].includes(k))
        );
        if (Object.keys(extra).length) data = extra;
      } else {
        msg = exception.message;
      }

      return res.status(status).json({ code: status, msg, data });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 500,
      msg: 'internal server error',
      data: null,
    });
  }
}
