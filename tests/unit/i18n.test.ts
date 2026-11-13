import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/en';
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
  });
});
