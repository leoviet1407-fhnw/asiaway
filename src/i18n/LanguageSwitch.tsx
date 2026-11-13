'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLanguageAction } from '@/app/actions';
import { useLang } from './client';

/** DE | EN, remembered on this phone. */
export function LanguageSwitch({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (next: 'de' | 'en') => {
    if (next === lang) return;
    start(async () => {
      await setLanguageAction(next);
      router.refresh();
    });
  };
  const base = 'min-h-0 px-3 py-1.5 text-xs font-bold rounded-btn';
  const on = dark ? 'bg-white text-navy' : 'bg-navy text-white';
  const off = dark ? 'text-white/80 hover:bg-white/10' : 'text-navy hover:bg-navy-50';
  return (
    <div className={`inline-flex gap-1.5 ${className}`} role="group" aria-label="Language / Sprache">
      {(['de', 'en'] as const).map((l) => (
        <button key={l} type="button" disabled={pending} onClick={() => pick(l)} className={`${base} ${lang === l ? on : off}`} aria-pressed={lang === l}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
