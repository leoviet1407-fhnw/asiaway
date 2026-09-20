import en from './messages/en.json' with { type: 'json' };
import de from './messages/de.json' with { type: 'json' };
import vi from './messages/vi.json' with { type: 'json' };
import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * A small, typed dictionary.
 *
 * Every user-visible string lives in messages/{en,de,vi}.json, never inline in a
 * component. English is the key set: a missing translation falls back to English
 * rather than rendering a raw key at a guest.
 */
export type Messages = typeof en;
export type MessageKey = keyof Messages;

const DICTIONARIES: Record<Locale, Partial<Messages>> = { en, de, vi };

export function getMessages(locale: Locale): Messages {
  return { ...en, ...DICTIONARIES[locale] };
}

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function createTranslator(locale: Locale): Translator {
  const messages = getMessages(locale);
  return (key, vars) => {
    const template = messages[key] ?? en[key] ?? String(key);
    if (!vars) return template;
    return Object.entries(vars).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template,
    );
  };
}

export { DEFAULT_LOCALE };
