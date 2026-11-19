'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLanguageAction } from '@/app/actions';
import { useLang } from './client';
import { LANGS, type Lang } from './translate';

/** DE | EN | TH, remembered on this phone. */
export function LanguageSwitch({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (next: Lang) => {
    if (next === lang) return;
    start(async () => {
      await setLanguageAction(next);
      router.refresh();
    });
  };
  const base = 'min-h-0 px-2 py-1.5 text-xs font-bold rounded-btn sm:px-3';
  const on = dark ? 'bg-white text-navy' : 'bg-navy text-white';
  const off = dark ? 'text-white/80 hover:bg-white/10' : 'text-navy hover:bg-navy-50';
  return (
    <div className={`inline-flex gap-1 sm:gap-1.5 ${className}`} role="group" aria-label="Language / Sprache / ภาษา">
      {LANGS.map((l) => (
        <button key={l} type="button" disabled={pending} onClick={() => pick(l)} className={`${base} ${lang === l ? on : off}`} aria-pressed={lang === l}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
