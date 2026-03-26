import { Injectable } from '@nestjs/common';
import { Observable, Subject, concat, filter, interval, map, merge, of } from 'rxjs';

export interface SseMessage {
  type: string;
  data: unknown;
}

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

  sessionStream(sessionId: string, initial: unknown): Observable<SseMessage> {
    const updates = this.sessionEvents$.pipe(
      filter((event) => event.sessionId === sessionId),
      map((event) => ({ type: 'session', data: event.payload }))
    );
    return concat(of({ type: 'session', data: initial }), merge(updates, heartbeat()));
  }

  queueStream(initial: unknown): Observable<SseMessage> {
    const updates = this.queueEvents$.pipe(map((payload) => ({ type: 'sessions', data: payload })));
    return concat(of({ type: 'sessions', data: initial }), merge(updates, heartbeat()));
  }
}

function heartbeat(): Observable<SseMessage> {
  return interval(30000).pipe(map(() => ({ type: 'ping', data: '' })));
}
