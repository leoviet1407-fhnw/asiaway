/**
 * Phase 2 seams.
 *
 * Each interface has exactly ONE Phase 1 implementation that does the minimum
 * honest thing. No vendor is named anywhere, because no POS, payment provider
 * or kitchen system has been chosen. Adding a real integration later means
 * adding an implementation, not rewriting the ordering domain.
 */
import type { OrderSnapshot } from '../order/snapshot';

export interface ConfirmedOrderContext {
  readonly orderId: string;
  readonly orderNumber: number;
  readonly tableNumber: string;
  readonly sessionId: string;
  readonly confirmedAt: Date;
  readonly confirmedByUserId: string;
  readonly snapshot: OrderSnapshot;
}

/** Phase 1: the waiter keys the confirmed order into the existing POS by hand. */
export interface PosAdapter {
  readonly kind: string;
  onOrderConfirmed(context: ConfirmedOrderContext): Promise<void>;
}

export const manualPosAdapter: PosAdapter = {
  kind: 'MANUAL',
  async onOrderConfirmed() {
    // Intentionally does nothing. Phase 1 POS entry is a human step; the audit
    // trail records the confirmation that prompts it.
  },
};

/** Phase 2: kitchen display / printer routing. */
export interface KitchenRouter {
  readonly kind: string;
  route(context: ConfirmedOrderContext): Promise<void>;
}

export const noopKitchenRouter: KitchenRouter = {
  kind: 'NOOP',
  async route() {},
};

/** Phase 2: online payment. Phase 1 payment happens at the existing POS. */
export interface PaymentProvider {
  readonly kind: string;
  isSupported(): boolean;
}

export const externalPosPayment: PaymentProvider = {
  kind: 'EXTERNAL_POS',
  isSupported: () => false,
};

/** Phase 2: analytics. The audit stream is already the event log it would read. */
export interface AnalyticsSink {
  readonly kind: string;
  record(event: string, payload: Record<string, unknown>): Promise<void>;
}

export const noopAnalyticsSink: AnalyticsSink = {
  kind: 'NOOP',
  async record() {},
};
