-- Winterthur orders from each supplier ONCE for the whole building: the Thai (EG)
-- and the Vietnamese (1. OG) restaurant order together. Stock and the daily
-- closing stay per restaurant; only ordering and goods-in use this location.

INSERT INTO locations (id, name, short_name, address, delivery_note, sort)
VALUES ('winterthur', 'Winterthur', 'WIN', 'Archplatz 2, 8400 Winterthur', NULL, 2)
ON CONFLICT (id) DO NOTHING;

-- Existing orders of the two restaurants move to the combined location. Two open
-- drafts for the same supplier cannot both survive: keep the newest, cancel the rest.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY supplier_id ORDER BY updated_at DESC) AS rn
  FROM purchase_orders
  WHERE location_id IN ('winti-vn', 'winti-th') AND status = 'DRAFT'
)
UPDATE purchase_orders SET status = 'CANCELLED', closed_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE purchase_orders SET location_id = 'winterthur' WHERE location_id IN ('winti-vn', 'winti-th');
