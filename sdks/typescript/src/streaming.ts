import type { ClawDBSession } from 'axonio-types';

import { normalizeEvent, sleep, withSession } from './internal';
import type { ClawDBEvent, ClawDBEventMap, ClawDBEventType, Transport } from './types';

type Handler<T> = (event: T) => void;

export class ClawDBEventStream {
  private readonly listeners = new Map<string, Set<Handler<unknown>>>();
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession
  ) {}

  async *stream(): AsyncIterable<ClawDBEvent> {
    let attempt = 0;

    while (!this.closed) {
      try {
        for await (const rawEvent of this.transport.stream('ClawDB.StreamEvents', withSession(this.session(), {}))) {
          if (this.closed) {
            return;
          }

          const event = normalizeEvent(rawEvent);
          this.emit(event.type, event.payload);
          yield event;
        }

        return;
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : undefined;
        const message = error instanceof Error ? error.message : '';
        const unavailable = code === 'UNAVAILABLE' || code === '14' || /UNAVAILABLE/i.test(message);

        if (!unavailable || this.closed) {
          throw error;
        }

        await sleep(Math.min(250 * 2 ** attempt, 4000));
        attempt += 1;
      }
    }
  }

  on<K extends ClawDBEventType>(event: K, handler: (e: ClawDBEventMap[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)?.add(handler as Handler<unknown>);

    return () => this.off(event, handler);
  }

  once<K extends ClawDBEventType>(event: K): Promise<ClawDBEventMap[K]> {
    return new Promise((resolve) => {
      const unsubscribe = this.on(event, (payload) => {
        unsubscribe();
        resolve(payload);
      });
    });
  }

  off(event: string, handler: Function): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  private emit(event: string, payload: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(payload);
    }
  }
}
