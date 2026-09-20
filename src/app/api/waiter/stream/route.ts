import { notificationHub } from '../../../../server/notifications/hub';
import { getWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events for waiter devices.
 *
 * SSE rather than WebSocket: the traffic is one-way, the browser reconnects on
 * its own, and it authenticates with the ordinary session cookie. The 20-second
 * heartbeat keeps proxies from treating an idle stream as dead.
 *
 * This stream is an accelerator, never the source of truth — the client
 * reconciles against the pending-notification queue whenever it (re)connects,
 * so a dropped stream costs latency, never an order.
 */
export async function GET(request: Request) {
  const user = await getWaiter();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();

  // Declared out here so both start() and cancel() can reach them; otherwise a
  // disconnecting tablet would leak its subscription and its heartbeat timer.
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          closed = true;
          cleanup();
        }
      };

      send('retry: 3000\n\n');
      send(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

      unsubscribe = notificationHub.subscribe((event) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => send(': keep-alive\n\n'), 20_000);

      // Fires when the tablet navigates away, sleeps or loses its connection.
      request.signal.addEventListener('abort', () => {
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
