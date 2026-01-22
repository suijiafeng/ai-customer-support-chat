import { Injectable } from '@nestjs/common';
import { Observable, Subject, concat, filter, interval, map, merge, of } from 'rxjs';

export interface SseMessage {
  type: string;
  data: unknown;
}

/**
 * SSE 推送：替代原手写的 setupSse/notifySession/notifyQueue。
 * 单 Subject + 按 sessionId 过滤，订阅端自动随连接关闭释放，心跳保活 30s。
 */
@Injectable()
export class SseService {
  private readonly sessionEvents$ = new Subject<{ sessionId: string; payload: unknown }>();
  private readonly queueEvents$ = new Subject<unknown>();

  notifySession(sessionId: string, payload: unknown) {
    this.sessionEvents$.next({ sessionId, payload });
  }

  notifyQueue(payload: unknown) {
    this.queueEvents$.next(payload);
  }

  /** 单会话事件流（事件名 session），首帧推当前快照。 */
  sessionStream(sessionId: string, initial: unknown): Observable<SseMessage> {
    const updates = this.sessionEvents$.pipe(
      filter((event) => event.sessionId === sessionId),
      map((event) => ({ type: 'session', data: event.payload }))
    );
    return concat(of({ type: 'session', data: initial }), merge(updates, heartbeat()));
  }

  /** 队列事件流（事件名 sessions），首帧推当前快照。 */
  queueStream(initial: unknown): Observable<SseMessage> {
    const updates = this.queueEvents$.pipe(map((payload) => ({ type: 'sessions', data: payload })));
    return concat(of({ type: 'sessions', data: initial }), merge(updates, heartbeat()));
  }
}

function heartbeat(): Observable<SseMessage> {
  return interval(30000).pipe(map(() => ({ type: 'ping', data: '' })));
}
