import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseItemsCsv } from '@/server/import/items-import';
import { sampleEan } from '@/server/seed/sample-data';

describe('items CSV import', () => {
  it('reads the template (semicolon, multiple EANs, units per scan)', () => {
    const { rows, errors } = parseItemsCsv(readFileSync('data/items-template.csv', 'utf8'));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.barcodes).toEqual([
      { code: '2001005000000', unitsPerScan: 1 },
      { code: '2101005000007', unitsPerScan: 0.083 },
    ]);
    expect(rows[2]).toMatchObject({ isFresh: true, storageArea: 'COLD', barcodes: [] });
    // The template's EANs are the same as the seed's sample codes.
    expect(rows[0]!.barcodes[0]!.code).toBe(sampleEan('A-1001'));
  });

  it('reports bad rows with their line number', () => {
    const csv = 'sku,name_de,supplier,order_unit,price_chf,ean,storage_area\nX1,Test,S,Stk,abc,4006381333932,Keller\n';
    const { rows, errors } = parseItemsCsv(csv);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/Zeile 2 .*price_chf.*Prüfziffer/);
    expect(errors[0]).toMatch(/storage_area/);
  });
});
