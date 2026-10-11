import Link from 'next/link';
import { storeName, type Store } from '@blanxer-dev/storefront/core';
import { usableHref } from '@/lib/site';

const SOCIAL: Array<[key: string, label: string]> = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
];

export function Footer({ store }: { store: Store }) {
  const name = storeName(store);
  const d = store.footer?.details || {};
  const columns = ((d.column || []) as Array<{ id?: string; title?: string; links?: Array<{ id?: string; label?: string; link?: string }> }>)
    .map((col) => ({ ...col, links: (col.links || []).filter((l) => l.label && usableHref(l.link)) }))
    .filter((col) => col.links.length);
  const social = SOCIAL.filter(([k]) => /^https?:\/\//.test(String(store.social?.[k] || '')));

  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <p className="footer-name">{name}</p>
          {d.title_text ? <p className="footer-text">{d.title_text}</p> : null}
          {social.length ? (
            <p className="footer-social">
              {social.map(([k, label]) => (
                <a key={k} href={store.social![k]} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              ))}
            </p>
          ) : null}
        </div>
        <nav aria-label="Shop">
          <p className="footer-title">Shop</p>
          <Link href="/products">All products</Link>
          <Link href="/collections/new-arrivals">New arrivals</Link>
          <Link href="/sale">Sale</Link>
          <Link href="/brands">Brands</Link>
          <Link href="/blogs">Blog</Link>
        </nav>
        {columns.map((col) => (
          <nav key={col.id || col.title} aria-label={col.title}>
            <p className="footer-title">{col.title}</p>
            {col.links.map((l) => (
              <a key={l.id || l.link} href={usableHref(l.link)!}>
                {l.label}
              </a>
            ))}
          </nav>
        ))}
      </div>
      <p className="container footer-copy">{d.footer_text || `© ${new Date().getFullYear()} ${name}`}</p>
    </footer>
  );
}
