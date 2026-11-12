import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/order';
import { LINE_STATUS_LABEL, type LineStatus } from '@/domain/receiving';

const ORDER_STYLE: Record<OrderStatus, string> = {
  DRAFT: 'bg-surface-sunken text-charcoal',
  SUBMITTED: 'bg-warn-50 text-warn-500',
  SENT: 'bg-info-50 text-info-500',
  PARTIALLY_RECEIVED: 'bg-brand-50 text-brand-700',
  RECEIVED: 'bg-ok-50 text-ok-500',
  CANCELLED: 'bg-surface-sunken text-charcoal-muted line-through',
};

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  return <span className={`chip ${ORDER_STYLE[status]}`}>{ORDER_STATUS_LABEL[status]}</span>;
}

const LINE_STYLE: Record<LineStatus, string> = {
  OK: 'bg-ok-50 text-ok-500',
  MISSING: 'bg-brand-600 text-white',
  SHORT: 'bg-brand-50 text-brand-700',
  EXTRA: 'bg-warn-50 text-warn-500',
  WRONG: 'bg-navy text-white',
};

export function LineStatusChip({ status }: { status: LineStatus }) {
  return <span className={`chip ${LINE_STYLE[status]}`}>{LINE_STATUS_LABEL[status]}</span>;
}
