/**
 * German, English and Thai UI text. German is the source language: a text IS its own
 * key, `t('Neue Bestellung')`. English and Thai come from their dictionaries (en.ts, th.ts).
 * A Thai text that is missing falls back to English, an English one to German, so a
 * screen is never blank; dev mode logs what is missing so it gets added.
 *
 * Variables: `t('Hallo {name}', { name })`. Sentences made of fixed words plus
 * numbers and names (e.g. the roster checks) are matched by PATTERNS.
 */
import { EN, PATTERNS } from './en';
import { TH, PATTERNS_TH } from './th';

export type Lang = 'de' | 'en' | 'th';
export const LANGS: readonly Lang[] = ['de', 'en', 'th'];
export const LANG_COOKIE = 'aw_lang';
export const DEFAULT_LANG: Lang = 'de';
/** How each language names itself on the switch. */
export const LANG_NAME: Record<Lang, string> = { de: 'Deutsch', en: 'English', th: 'ไทย' };
/** Locale for dates and month names (Thai with the Western calendar, not the Buddhist year). */
export const LOCALE: Record<Lang, string> = { de: 'de-CH', en: 'en-GB', th: 'th-TH-u-ca-gregory' };

export function normalizeLang(value: string | undefined | null): Lang {
  return value === 'en' || value === 'th' ? value : DEFAULT_LANG;
}

export type Vars = Record<string, string | number>;
export type TFunction = ((text: string, vars?: Vars) => string) & { lang: Lang };

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);
const warned = new Set<string>();

/** Short weekday names per language, Sunday first. */
export const WEEKDAY_SHORT: Record<Lang, readonly string[]> = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  th: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],
};
const DE_INDEX: Record<string, number> = { So: 0, Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6 };
/** The roster checks name days like "Mo 12.11."; in English they read "Mon 12.11.", in Thai "จ. 12.11.". */
const localWeekdays = (lang: Lang, text: string) =>
  text.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So) (\d{2}\.\d{2}\.)/g, (_, d: string, rest: string) => `${WEEKDAY_SHORT[lang][DE_INDEX[d]!]} ${rest}`);

const DICT: Record<Exclude<Lang, 'de'>, Record<string, string>> = { en: EN, th: TH };
const PATTERN_SET: Record<Exclude<Lang, 'de'>, [RegExp, string][]> = { en: PATTERNS, th: PATTERNS_TH };

function lookup(lang: Exclude<Lang, 'de'>, text: string, vars?: Vars): string | null {
  const exact = DICT[lang][text];
  if (exact !== undefined) return fill(exact, vars);
  for (const [re, out] of PATTERN_SET[lang]) {
    const m = re.exec(text);
    if (m) return localWeekdays(lang, out.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? ''));
  }
  return null;
}

export function translate(lang: Lang, text: string, vars?: Vars): string {
  if (lang === 'de') return fill(text, vars);
  const found = lookup(lang, text, vars) ?? (lang === 'th' ? lookup('en', text, vars) : null);
  if (found !== null) return found;
  if (process.env.NODE_ENV !== 'production' && /[A-Za-zÄÖÜäöü]{3}/.test(text) && !warned.has(`${lang}|${text}`)) {
    warned.add(`${lang}|${text}`);
    console.warn(`[i18n] no ${lang === 'th' ? 'Thai' : 'English'} for: ${JSON.stringify(text)}`);
  }
  return fill(text, vars);
}

export function makeT(lang: Lang): TFunction {
  const t = ((text: string, vars?: Vars) => translate(lang, text, vars)) as TFunction;
  t.lang = lang;
  return t;
}
