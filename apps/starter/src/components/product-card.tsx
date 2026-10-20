import Image from 'next/image';
import Link from 'next/link';
import { discountPercent, listPrice, type Product, type Store } from '@blanxer-dev/storefront/core';
import { OfferBadges, OfferCardHint } from '@blanxer-dev/storefront/react';
import { price } from '@/lib/site';

/** What offer badges need of a product (keeps the page payload small). */
const offerRef = (p: Product) => ({
  _id: p._id,
  price: p.price ?? p.min_price ?? null,
  categories: (p.categories || []).map(String),
  variants: (p.variants || []).map((v) => ({ _id: v._id })),
});

/** `eager`: above-the-fold cards (load now instead of lazily); `lcp`: the one most likely to be the page's LCP image. */
export function ProductCard({ product, store, eager = false, lcp = false }: { product: Product; store: Store; eager?: boolean; lcp?: boolean }) {
  const { price: p, maxPrice, compareAtPrice } = listPrice(product);
  const off = discountPercent(p, compareAtPrice);
  const image = product.image_urls?.[0];
  return (
    <Link href={`/product/${product.slug}`} className="card">
      <div className="card-media">
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            loading={eager ? 'eager' : undefined}
            fetchPriority={lcp ? 'high' : undefined}
          />
        ) : null}
        {/* Offer badges (stores on Offers; style, corner and colours from the store's offer settings). */}
        <OfferBadges product={offerRef(product)} />
        {off > 0 ? <span className="card-badge">{off}% off</span> : null}
        {product.in_stock === false ? <span className="card-badge card-badge--muted">Sold out</span> : null}
      </div>
      <p className="card-name">{product.name}</p>
      <p className="card-price">
        {p > 0 ? (maxPrice > p ? `${price(store, p)} – ${price(store, maxPrice)}` : price(store, p)) : null}
        {compareAtPrice > p ? <s>{price(store, compareAtPrice)}</s> : null}
      </p>
      <OfferCardHint product={offerRef(product)} />
    </Link>
  );
}

/** `eagerCount`: how many leading cards are above the fold (the first is treated as the LCP image). */
export function ProductGrid({ products, store, eagerCount = 0, empty = 'No products yet.' }: { products: Product[]; store: Store; eagerCount?: number; empty?: string }) {
  if (!products.length) return <p className="muted">{empty}</p>;
  return (
    <div className="grid">
      {products.map((p, i) => (
        <ProductCard key={p._id} product={p} store={store} eager={i < eagerCount} lcp={i === 0 && eagerCount > 0} />
      ))}
    </div>
  );
}
