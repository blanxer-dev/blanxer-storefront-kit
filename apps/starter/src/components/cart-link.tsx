'use client';
import Link from 'next/link';
import { useCart } from '@blanxer-dev/storefront/react';

export function CartLink() {
  const { count, hydrated } = useCart();
  return (
    <Link href="/cart" className="header-cart" aria-label={`Cart${hydrated && count ? `, ${count} items` : ''}`}>
      Cart{hydrated && count ? <span className="header-cart-count">{count}</span> : null}
    </Link>
  );
}
