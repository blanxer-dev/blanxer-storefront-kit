import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOffers } from '@blanxer-dev/storefront/server';
import { offersDisplay } from '@blanxer-dev/storefront/core';
import { OffersPageList } from './offers-list';

export const metadata: Metadata = { title: 'Offers', description: 'Everything on offer right now.' };

// Offers start and end on their own schedule: re-read at most every 30 s.
export const revalidate = 30;

/**
 * Stores on Offers with the Offers page on (Offers settings → Offers page). Every price
 * shown in the bag comes from the server's quote; this page only lists the offers' rules.
 */
export default async function OffersPage() {
  const res = await getOffers();
  if (!res.enabled || !offersDisplay(res.settings).offers_page) notFound();
  return (
    <section className="section container">
      <div className="offers-head">
        <h1>Offers</h1>
        <p className="muted">Everything on offer right now. Most apply in your bag automatically.</p>
      </div>
      <OffersPageList offers={res.data} />
    </section>
  );
}
