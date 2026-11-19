-- English product name, shown with the Vietnamese one as a subtitle under the original
-- (supplier's) product name. The original name_de stays exactly as the supplier writes it.
ALTER TABLE items ADD COLUMN name_en text;
