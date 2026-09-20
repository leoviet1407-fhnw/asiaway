/**
 * Printable table QR codes.
 *
 *   npm run qr
 *
 * Writes one SVG and one PNG per table, plus a single print sheet, into
 * ./qr-codes. Demo tables are watermarked so a test code can never be mistaken
 * for a production one.
 *
 * Real production codes are generated only once the restaurant supplies its
 * actual table list.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteDatabase, createPostgresDatabase, type AppDatabase } from '../src/server/db/client';
import { restaurantTables } from '../src/server/db/schema';
import { qrUrlFor } from '../src/domain/session/qr-token';
import { asc } from 'drizzle-orm';

const OUT_DIR = resolve(process.cwd(), 'qr-codes');

function printSheet(cards: { tableNumber: string; displayName: string; svg: string; url: string }[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Asiaway table QR codes</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 8mm; text-align: center;
          page-break-inside: avoid; }
  .card h2 { margin: 0 0 2mm; font-size: 20pt; }
  .card p { margin: 2mm 0 0; color: #555; font-size: 10pt; }
  .card svg { width: 55mm; height: 55mm; }
  .scan { font-size: 12pt; font-weight: 600; margin-top: 3mm; }
  .hint { font-size: 9pt; color: #666; }
  .url { font-size: 7pt; color: #999; word-break: break-all; margin-top: 2mm; }
</style>
</head>
<body>
  <h1 style="font-size:14pt">Asiaway — table QR codes</h1>
  <div class="grid">
    ${cards
      .map(
        (card) => `<div class="card">
      <h2>${card.displayName}</h2>
      ${card.svg}
      <p class="scan">Scan to see the menu and order</p>
      <p class="hint">Karte ansehen und bestellen · Xem thực đơn và gọi món</p>
      <p class="url">${card.url}</p>
    </div>`,
      )
      .join('\n    ')}
  </div>
</body>
</html>`;
}

async function main(): Promise<void> {
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const url = process.env.DATABASE_URL;

  let db: AppDatabase;
  let close: () => Promise<void> = async () => {};

  if (url) {
    const created = createPostgresDatabase(url);
    db = created.db;
    close = async () => {
      await created.client.end();
    };
  } else {
    mkdirSync(resolve(process.cwd(), '.pglite'), { recursive: true });
    const client = new PGlite(resolve(process.cwd(), '.pglite/asiaway'));
    db = createPgliteDatabase(client).db;
    close = async () => client.close();
  }

  const tables = await db.select().from(restaurantTables).orderBy(asc(restaurantTables.tableNumber));

  if (tables.length === 0) {
    console.error('No tables found. Run `npm run seed` first, or add the real table list.');
    process.exitCode = 1;
    await close();
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const cards: { tableNumber: string; displayName: string; svg: string; url: string }[] = [];

  for (const table of tables) {
    const target = qrUrlFor(baseUrl, table.qrToken);
    const svg = await QRCode.toString(target, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
    });
    const png = await QRCode.toBuffer(target, { errorCorrectionLevel: 'M', width: 1024, margin: 1 });

    writeFileSync(resolve(OUT_DIR, `table-${table.tableNumber}.svg`), svg);
    writeFileSync(resolve(OUT_DIR, `table-${table.tableNumber}.png`), png);
    cards.push({ tableNumber: table.tableNumber, displayName: table.displayName, svg, url: target });
  }

  writeFileSync(resolve(OUT_DIR, 'print-sheet.html'), printSheet(cards));

  console.log(`\nWrote ${tables.length} QR codes to ${OUT_DIR}`);
  console.log('  table-XX.svg / table-XX.png  — individual codes');
  console.log('  print-sheet.html             — open in a browser and print to A4\n');
  console.log(`Base URL used: ${baseUrl}`);
  console.log('Set APP_BASE_URL before generating production codes.\n');

  await close();
}

main().catch((error: unknown) => {
  console.error('\nQR generation FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
