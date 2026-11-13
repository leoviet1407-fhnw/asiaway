import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import { ServiceWorker } from '@/components/ServiceWorker';
import { LangProvider } from '@/i18n/client';
import { getLang } from '@/i18n/server';
import { withBase } from '@/lib/base-path';
import './globals.css';

const plex = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'AsiaWay Staff', template: '%s · AsiaWay Staff' },
  description: 'Bestellungen und Wareneingang für AsiaWay',
  applicationName: 'AsiaWay Staff',
  appleWebApp: { capable: true, title: 'AsiaWay Staff', statusBarStyle: 'black-translucent' },
  icons: { icon: withBase('/icons/icon-192.png'), apple: withBase('/icons/apple-touch-icon.png') },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#09141d',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={plex.variable}>
      <body className="min-h-screen">
        <LangProvider lang={lang}>
          {children}
          <ServiceWorker />
        </LangProvider>
      </body>
    </html>
  );
}
