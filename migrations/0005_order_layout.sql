-- What a supplier's order sheet needs (modelled on the Prodega order):
--   Abteilung / Gruppe per item, the quantity UNIT separate from the pack
--   description ("3 Karton" + "Karton zu 20l"), and contact details per location.

ALTER TABLE items ADD COLUMN department text;
ALTER TABLE items ADD COLUMN item_group text;

-- order_unit stays the pack description ("Sack zu 10kg"); quantity_unit is what the
-- number is counted in ("kg", "Karton", "Stück"). NULL = show the number alone.
ALTER TABLE supplier_items ADD COLUMN quantity_unit text;
ALTER TABLE purchase_order_lines ADD COLUMN quantity_unit text;

ALTER TABLE locations ADD COLUMN phone text;
ALTER TABLE locations ADD COLUMN contact_email text;
