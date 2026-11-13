/**
 * German and English UI text. German is the source language: a text IS its own
 * key, `t('Neue Bestellung')`. English comes from the dictionary; a text with no
 * entry shows in German (never blank), and dev mode logs it so it gets added.
 *
 * Variables: `t('Hallo {name}', { name })`. Sentences made of fixed words plus
 * numbers and names (e.g. the roster checks) are matched by PATTERNS.
 */
import { EN, PATTERNS } from './en';

export type Lang = 'de' | 'en';
export const LANGS: readonly Lang[] = ['de', 'en'];
export const LANG_COOKIE = 'aw_lang';
export const DEFAULT_LANG: Lang = 'de';

export function normalizeLang(value: string | undefined | null): Lang {
  return value === 'en' ? 'en' : DEFAULT_LANG;
}

export type Vars = Record<string, string | number>;
export type TFunction = ((text: string, vars?: Vars) => string) & { lang: Lang };

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);
const warned = new Set<string>();
const EN_DAYS: Record<string, string> = { Mo: 'Mon', Di: 'Tue', Mi: 'Wed', Do: 'Thu', Fr: 'Fri', Sa: 'Sat', So: 'Sun' };
/** The roster checks name days like "Mo 12.11."; in English they read "Mon 12.11.". */
const englishWeekdays = (text: string) => text.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So) (\d{2}\.\d{2}\.)/g, (_, d: string, rest: string) => `${EN_DAYS[d]} ${rest}`);

export function translate(lang: Lang, text: string, vars?: Vars): string {
  if (lang === 'de') return fill(text, vars);
  const exact = EN[text];
  if (exact !== undefined) return fill(exact, vars);
  for (const [re, out] of PATTERNS) {
    const m = re.exec(text);
    if (m) return englishWeekdays(out.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? ''));
  }
  if (process.env.NODE_ENV !== 'production' && /[A-Za-zÄÖÜäöü]{3}/.test(text) && !warned.has(text)) {
    warned.add(text);
    console.warn(`[i18n] no English for: ${JSON.stringify(text)}`);
  }
  return fill(text, vars);
}

export function makeT(lang: Lang): TFunction {
  const t = ((text: string, vars?: Vars) => translate(lang, text, vars)) as TFunction;
  t.lang = lang;
  return t;
}
