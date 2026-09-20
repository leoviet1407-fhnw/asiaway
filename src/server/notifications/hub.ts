import { EventEmitter } from 'node:events';

/**
 * In-process fan-out for waiter notifications.
 *
 * Deliberately NOT the source of truth. The `notifications` table is: this hub
 * only makes delivery fast. A waiter device that was offline, asleep or behind a
 * proxy that ate the stream still recovers everything by reading the pending
 * queue on (re)connect, so a dropped event is a latency problem, never a lost
 * order.
 *
 * Phase 1 runs as one container, which this covers. Running several instances
 * later means bridging this to Postgres LISTEN/NOTIFY — `publish` is the single
 * seam where that happens.
 */
export type WaiterEventType =
  | 'new_order'
  | 'checkout_requested'
  | 'order_updated'
  | 'availability_changed';

export interface WaiterEvent {
  readonly type: WaiterEventType;
  readonly at: string;
  readonly payload: Record<string, unknown>;
}

class NotificationHub {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A busy service with many tablets should not print warnings.
    this.emitter.setMaxListeners(100);
  }

  publish(event: WaiterEvent): void {
    this.emitter.emit('waiter', event);
  }

  subscribe(listener: (event: WaiterEvent) => void): () => void {
    this.emitter.on('waiter', listener);
    return () => this.emitter.off('waiter', listener);
  }

  get subscriberCount(): number {
    return this.emitter.listenerCount('waiter');
  }
}

/**
 * One hub per process, kept on globalThis so Next.js hot reloads in development
 * do not silently orphan every open stream.
 */
const globalRef = globalThis as unknown as { __asiawayHub?: NotificationHub };
export const notificationHub = (globalRef.__asiawayHub ??= new NotificationHub());

export function publishWaiterEvent(
  type: WaiterEventType,
  payload: Record<string, unknown>,
): void {
  notificationHub.publish({ type, at: new Date().toISOString(), payload });
}
