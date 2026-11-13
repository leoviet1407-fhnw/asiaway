import { withBase } from '@/lib/base-path';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Offline') };
}

export default async function OfflinePage() {
  const t = await getT();
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mt-16 text-2xl">{t('Keine Verbindung')}</h1>
      <p className="mt-3">
        {t('Das Telefon ist gerade offline. Begonnene Wareneingänge bleiben auf dem Gerät gespeichert und werden gesendet, sobald die Verbindung zurück ist.')}
      </p>
      <a href={withBase('/')} className="btn-primary mt-6">
        {t('Nochmals versuchen')}
      </a>
    </main>
  );
}
