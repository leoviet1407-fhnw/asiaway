import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/en';
import { TH } from '@/i18n/th';
import { makeT, normalizeLang, translate } from '@/i18n/translate';
import { formatDay, monthLabel } from '@/lib/dates';
import { ORDER_STATUS_LABEL } from '@/domain/order';
import { LINE_STATUS_LABEL } from '@/domain/receiving';
import { ABSENCE_LABEL, ABSENCE_STATUS_LABEL, EMPLOYMENT_LABEL } from '@/domain/roster';
import { CLOSING_STATUS_LABEL, DIFFERENCE_LABEL } from '@/domain/closing';
import { STORAGE_AREA_LABEL } from '@/server/services/catalog-service';
import { MESSAGES } from '@/lib/messages';

describe('translation', () => {
  it('German is the source and the default', () => {
    expect(normalizeLang(undefined)).toBe('de');
    expect(normalizeLang('fr')).toBe('de');
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('th')).toBe('th');
    expect(makeT('de')('Neue Bestellung')).toBe('Neue Bestellung');
    expect(makeT('de')('Hallo {name}', { name: 'Anna' })).toBe('Hallo Anna');
  });

  it('English from the dictionary, with variables, falling back to German', () => {
    const t = makeT('en');
    expect(t('Neue Bestellung')).toBe('New order');
    expect(t('Hallo {name}', { name: 'Anna' })).toBe('Hello Anna');
    expect(t('Text ohne Eintrag')).toBe('Text ohne Eintrag');
    expect(t.lang).toBe('en');
  });

  it('translates the roster checks, including the weekday names', () => {
    expect(translate('en', 'Anna, Mo 12.11.: zwei Schichten überschneiden sich.')).toBe('Anna, Mon 12.11.: two shifts overlap.');
    expect(translate('en', 'Ben: nur 9 h Ruhezeit vor Di 13.11. (min. 11 h).')).toBe('Ben: only 9 h rest before Tue 13.11. (min. 11 h).');
    expect(translate('en', 'Carla (80 %): 30 h geplant, Ziel 32 h–34 h.')).toBe('Carla (80 %): 30 h planned, target 32 h–34 h.');
    expect(translate('en', 'Fehlbetrag von 217.35 CHF – bitte nochmals nachzählen.')).toBe('Shortfall of 217.35 CHF – please count again.');
  });

  it('every label shown through t() has an English entry', () => {
    const maps: Record<string, string>[] = [
      ORDER_STATUS_LABEL, LINE_STATUS_LABEL, ABSENCE_LABEL, ABSENCE_STATUS_LABEL, EMPLOYMENT_LABEL, CLOSING_STATUS_LABEL, DIFFERENCE_LABEL, STORAGE_AREA_LABEL, MESSAGES,
    ];
    const missing = maps.flatMap((m) => Object.values(m)).filter((text) => EN[text] === undefined);
    expect(missing).toEqual([]);
  });

  it('dates follow the language', () => {
    expect(formatDay('2026-11-14', 'de')).toBe('Sa, 14.11.2026');
    expect(formatDay('2026-11-14', 'en')).toBe('Sat, 14.11.2026');
    expect(monthLabel('2026-12', 'de')).toBe('Dezember 2026');
    expect(monthLabel('2026-12', 'en')).toBe('December 2026');
    expect(formatDay('2026-11-14', 'th')).toBe('ส., 14.11.2026');
    expect(monthLabel('2026-12', 'th')).toBe('ธันวาคม 2026'); // Western year, not the Buddhist 2569
  });

  it('Thai from its dictionary, falling back to English, then German', () => {
    const t = makeT('th');
    expect(t('Neue Bestellung')).toBe('ใบสั่งซื้อใหม่');
    expect(t('Hallo {name}', { name: 'Pui' })).toBe('สวัสดี Pui');
    expect(t('Text ohne Eintrag')).toBe('Text ohne Eintrag');
    expect(translate('th', 'Anna, Mo 12.11.: zwei Schichten überschneiden sich.')).toBe('Anna, จ. 12.11.: กะงานสองกะซ้อนกัน');
    expect(translate('th', 'Anna, Mo 23.11.: eingeteilt, obwohl Ferien.')).toBe('Anna, จ. 23.11.: ถูกจัดเข้างานทั้งที่ลาพักร้อน');
    expect(translate('en', 'Anna, Mo 23.11.: eingeteilt, obwohl Krank.')).toBe('Anna, Mon 23.11.: scheduled although sick.');
  });

  it('every English entry has a Thai one with the same {placeholders}', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    expect(Object.keys(EN).filter((k) => !(k in TH))).toEqual([]);
    expect(Object.keys(TH).filter((k) => ph(TH[k]!) !== ph(EN[k]!))).toEqual([]);
  });

  it('every screen text t("…") in the app has an English entry', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !p.includes('/i18n/') ? [p] : [];
      });
    const missing = new Set<string>();
    for (const f of files('src')) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        const key = m[1]!.replace(/\\'/g, "'");
        if (!(key in EN)) missing.add(`${key}  (${f})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
