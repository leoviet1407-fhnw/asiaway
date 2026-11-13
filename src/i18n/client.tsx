'use client';

import { createContext, useContext, useMemo } from 'react';
import { makeT, type Lang, type TFunction } from './translate';

const LangContext = createContext<Lang>('de');

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** The translation function for client components. */
export function useT(): TFunction {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
