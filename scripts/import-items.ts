/**
 * Imports the item / price list from CSV.
 *
 *   npm run items:import -- data/items-template.csv          (dry run: shows what would change)
 *   npm run items:import -- data/items-template.csv --apply  (writes it)
 *
 * Columns: see data/items-template.csv and src/server/import/items-import.ts.
 * Excel: "Speichern unter → CSV UTF-8" first. Stop `npm run dev` before
 * importing into the local PGlite database.
 */
import { readFileSync } from 'node:fs';
import { applyItemsImport, parseItemsCsv } from '../src/server/import/items-import';
import { openCliDatabase } from './cli-db';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!file) {
  console.error('Usage: npm run items:import -- <file.csv> [--apply]');
  process.exit(1);
}
if (/\.xlsx?$/i.test(file)) {
  console.error('Excel files are not read directly yet. Save the sheet as "CSV UTF-8" and import that.');
  process.exit(1);
}

const { rows, errors } = parseItemsCsv(readFileSync(file, 'utf8'));
console.log(`${rows.length} gültige Zeilen, ${errors.length} Fehler.`);
for (const e of errors) console.log(`  ✗ ${e}`);
if (errors.length > 0 && apply) {
  console.error('Nicht importiert: zuerst die Fehler beheben.');
  process.exit(1);
}

const { db, close } = await openCliDatabase();
try {
  const plan = await applyItemsImport(db, rows, { dryRun: !apply });
  console.log(`Neue Lieferanten: ${plan.newSuppliers.join(', ') || '–'}`);
  console.log(`Neue Artikel: ${plan.newItems.length}  ·  Aktualisierte Artikel: ${plan.updatedItems.length}`);
  console.log(apply ? 'Import abgeschlossen.' : 'Trockenlauf – nichts gespeichert. Mit --apply importieren.');
  if (apply && plan.newSuppliers.length > 0) console.log('Bitte die Bestell-E-Mail der neuen Lieferanten in der App eintragen.');
} finally {
  await close();
}
