import { cache } from 'react';
import { getStore, siteOrigin } from '@blanxer/storefront/server';
import { currencyLabel, formatCurrency } from '@blanxer/storefront/core';
import type { Store } from '@blanxer/storefront/core';

/** The full store config (server only: it contains plugin data the browser must not see). */
export const store = cache((): Promise<Store> => getStore());

/**
 * The site's public origin for canonical links, or '' until it is known
 * (SITE_URL, or the website link saved in Blanxer). Never reads the request,
 * so pages stay static.
 */
export const origin = cache(async (): Promise<string | undefined> => (await siteOrigin({ fromRequest: false })) || undefined);

/** "Rs. 1,200" with the store's currency label. */
export const price = (s: Store, amount: number) => `${currencyLabel(s)} ${formatCurrency(amount)}`;

/** Paths this site serves. Links from Blanxer menus that point elsewhere (Blanxer page-builder pages, /p/…) are dropped. */
const OWN_PATH = /^\/(?:$|products|product\/|collections\/|brand\/|brands|search|sale|cart|blogs|blog\/|forms\/|track\/)/;

export const usableHref = (href: unknown): string | null => {
  const h = String(href || '').trim();
  if (!h || h === '#') return null;
  if (/^https?:\/\//.test(h)) return h;
  return OWN_PATH.test(h) ? h : null;
};

/** Route param → API slug (tolerates params that arrive still percent-encoded). */
export const slugParam = (v: string): string => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
