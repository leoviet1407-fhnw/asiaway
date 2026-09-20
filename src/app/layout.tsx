import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Sans_Thai } from 'next/font/google';
import './globals.css';

/* asiaway.ch serves both cuts from Typekit. The Google mirrors are the same
   designs and are self-hosted by next/font, so there is no third-party fetch
   on the guest's phone. */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['latin', 'thai'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-plex-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Asiaway',
  description: 'Order from your table at Asiaway.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#ac2025',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexThai.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
