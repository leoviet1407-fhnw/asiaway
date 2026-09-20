-- The 60-second customer window.
--
-- Changes a decision the master spec marked Fixed ("no cancel before waiter
-- confirmation"; "a waiter must review/confirm submitted orders"). The
-- restaurant asked for this on 2026-09-20 to cut the number of orders staff
-- have to open and confirm by hand. See docs/adr/0001-decisions.md (E13).
--
-- A customer-submitted order now waits in AWAITING_CUSTOMER while the guest can
-- still change it. When the window closes — by the timer or because the guest
-- sent it early — the order confirms itself and only then reaches the waiter.
-- Staff see one settled order instead of an order plus corrections.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'AWAITING_CUSTOMER' BEFORE 'SUBMITTED';
ALTER TYPE revision_type ADD VALUE IF NOT EXISTS 'CUSTOMER_EDIT' AFTER 'ORIGINAL_SUBMISSION';

-- When the guest loses the ability to change this order. NULL for orders taken
-- by staff on the tablet, which are confirmed the moment they are written.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_window_expires_at timestamptz;

-- Finding orders whose window has run out is the one query that happens on
-- every waiter dashboard read, so it gets its own index.
CREATE INDEX IF NOT EXISTS orders_awaiting_customer_idx
  ON orders (customer_window_expires_at)
  WHERE customer_window_expires_at IS NOT NULL;
