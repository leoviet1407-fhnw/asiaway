'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PendingNotification {
  id: string;
  type: 'NEW_ORDER' | 'CHECKOUT_REQUESTED' | 'ORDER_UPDATED';
  createdAt: string;
  tableNumber: string | null;
  tableLabel: string | null;
  sessionId: string | null;
  orderId: string | null;
  payload: Record<string, unknown>;
}

export type ConnectionState = 'connecting' | 'live' | 'degraded';

/**
 * Live waiter alerts.
 *
 * The server-side queue is the source of truth, so this hook always reconciles
 * by re-reading /api/waiter/notifications; the SSE stream only tells it when to
 * do so. If the stream cannot be established, or drops repeatedly, it falls back
 * to polling and says so in the UI rather than going quietly silent — a waiter
 * must never be left believing there are no orders when there are.
 */
export function useWaiterEvents(soundEnabled: boolean) {
  const [notifications, setNotifications] = useState<PendingNotification[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const previousIds = useRef<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);
  const failures = useRef(0);

  const chime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      // Created lazily: browsers block audio until a user gesture, and the
      // waiter's sign-in is that gesture.
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      for (const [index, frequency] of [880, 1320].entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, now + index * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.25, now + index * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + index * 0.18);
        osc.stop(now + index * 0.18 + 0.18);
      }
    } catch {
      // No audio available: the visual alert still stands.
    }
    if ('vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
  }, [soundEnabled]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/waiter/notifications');
      if (!response.ok) return;
      const data = await response.json();
      const next: PendingNotification[] = data.notifications;

      const incoming = next.filter((n) => !previousIds.current.has(n.id));
      if (incoming.length > 0 && previousIds.current.size > 0) chime();
      previousIds.current = new Set(next.map((n) => n.id));

      setNotifications(next);
    } catch {
      // Leave the last known state on screen rather than blanking it.
    }
  }, [chime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      setConnection('degraded');
      poll = setInterval(() => void refresh(), 10_000);
    };

    const connect = () => {
      if (closed) return;
      try {
        source = new EventSource('/api/waiter/stream');
      } catch {
        startPolling();
        return;
      }

      source.addEventListener('connected', () => {
        failures.current = 0;
        setConnection('live');
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        void refresh();
      });

      for (const type of ['new_order', 'checkout_requested', 'order_updated', 'availability_changed']) {
        source.addEventListener(type, () => void refresh());
      }

      source.onerror = () => {
        failures.current += 1;
        // EventSource reconnects by itself; after repeated failures we stop
        // trusting it and poll instead.
        if (failures.current >= 3) {
          source?.close();
          source = null;
          startPolling();
        } else {
          setConnection('connecting');
        }
      };
    };

    connect();

    // A repeating reminder while anything is unacknowledged: a single chime is
    // easy to miss in a busy dining room.
    const nag = setInterval(() => {
      if (previousIds.current.size > 0) chime();
    }, 30_000);

    return () => {
      closed = true;
      source?.close();
      if (poll) clearInterval(poll);
      clearInterval(nag);
    };
  }, [refresh, chime]);

  const acknowledge = useCallback(
    async (id: string) => {
      await fetch(`/api/waiter/notifications/${id}/ack`, { method: 'POST' });
      await refresh();
    },
    [refresh],
  );

  return {
    notifications,
    connection,
    refresh,
    acknowledge,
    newOrderCount: notifications.filter((n) => n.type === 'NEW_ORDER').length,
    checkoutCount: notifications.filter((n) => n.type === 'CHECKOUT_REQUESTED').length,
  };
}
