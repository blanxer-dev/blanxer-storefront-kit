'use client';
import { OffersList, useStore } from '@blanxer-dev/storefront/react';
import type { PublicOffer } from '@blanxer-dev/storefront/core';

/** Where "Shop now" goes: the offer's category or product, else all products. */
export function OffersPageList({ offers }: { offers: PublicOffer[] }) {
  const store = useStore();
  const categoryHref = (ids: string[] = []) => {
    const cat = (store.categories || []).find((c) => ids.map(String).includes(String(c._id)));
    return cat ? `/collections/${cat.slug}` : null;
  };
  const href = (o: PublicOffer): string => {
    const scope = o.tiers?.scope || o.amount_off?.scope || o.bxgy?.buy.scope;
    if (scope?.type === 'categories') return categoryHref(scope.categories) || '/products';
    if (scope?.type === 'products' && scope.products?.[0]) return `/product/${scope.products[0].product_id}`;
    if (o.bundle?.items[0]) return `/product/${o.bundle.items[0].product_id}`;
    return '/products';
  };
  return <OffersList offers={offers} offerHref={href} />;
}
