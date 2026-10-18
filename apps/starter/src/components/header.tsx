import Image from 'next/image';
import Link from 'next/link';
import { storeName, type Store } from '@blanxer-dev/storefront/core';
import { OfferTopBar, OffersLink } from '@blanxer-dev/storefront/react';
import { usableHref } from '@/lib/site';
import { CartLink } from './cart-link';

export function Header({ store }: { store: Store }) {
  const c = store.customization || {};
  const name = storeName(store);
  // The menu the merchant set in Blanxer, keeping links this site serves; else the first categories.
  const fromBlanxer = ((store.navigation?.items || []) as Array<{ n?: string; g?: string }>)
    .map((it) => ({ label: String(it.n || ''), href: usableHref(it.g) }))
    .filter((it): it is { label: string; href: string } => !!it.label && !!it.href && it.href !== '/');
  const seen = new Set<string>();
  const nav = (fromBlanxer.length ? fromBlanxer : (store.categories || []).slice(0, 5).map((cat) => ({ label: cat.name, href: `/collections/${cat.slug}` })))
    .filter((it) => (seen.has(it.href) ? false : (seen.add(it.href), true)))
    .slice(0, 6);

  return (
    <header className="header">
      {/* Offers the store puts in its top bar (Offers settings → Top bar). */}
      <OfferTopBar />
      {c.top_bar_text ? (
        <div className="topbar">
          {usableHref(c.top_bar_goto) ? <Link href={usableHref(c.top_bar_goto)!}>{c.top_bar_text}</Link> : c.top_bar_text}
        </div>
      ) : null}
      <div className="header-inner container">
        <Link href="/" className="header-logo" aria-label={name}>
          {c.brand_logo ? <Image src={c.brand_logo} alt={name} width={160} height={48} sizes="160px" loading="eager" /> : <span>{name}</span>}
        </Link>
        <nav className="header-nav" aria-label="Main">
          <Link href="/products">Shop</Link>
          {nav.map((it) => (
            <Link key={it.href} href={it.href}>
              {it.label}
            </Link>
          ))}
          {/* Only for stores on Offers with the Offers page turned on. */}
          <OffersLink href="/offers" className="header-nav-offers" />
        </nav>
        <form action="/search" className="header-search" role="search">
          <input name="q" type="search" placeholder="Search products" aria-label="Search products" minLength={3} />
        </form>
        <CartLink />
      </div>
    </header>
  );
}
