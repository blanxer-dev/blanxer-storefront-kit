import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import '@blanxer-dev/storefront/styles.css';
import './globals.css';
import { BlanxerProvider, Pixel } from '@blanxer-dev/storefront/react';
import { apiBase, getHomeSeo, toClientStore } from '@blanxer-dev/storefront/server';
import { storeMetadata } from '@blanxer-dev/storefront/seo';
import { storeFont, storeThemeColor } from '@blanxer-dev/storefront/core';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { storeFontClass } from '@/lib/fonts';
import { origin, store } from '@/lib/site';

// Store data (prices, stock, branding) is re-read from Blanxer at most once a minute.
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [s, o, homeSeo] = await Promise.all([store(), origin(), getHomeSeo()]);
  return storeMetadata(s, { origin: o, homeSeo });
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: storeThemeColor(await store()) };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const s = await store();
  const brand = storeThemeColor(s);
  return (
    <html lang="en" className={storeFontClass(storeFont(s))} style={{ '--brand': brand } as CSSProperties}>
      <body>
        {/* Only the browser-safe part of the store goes to the client (no plugin tokens). */}
        <BlanxerProvider store={toClientStore(s)} apiBase={apiBase()} theme={{ primary: brand, radius: '10px' }}>
          <Pixel />
          <Header store={s} />
          <main className="main">{children}</main>
          <Footer store={s} />
        </BlanxerProvider>
      </body>
    </html>
  );
}
