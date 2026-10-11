import type { Metadata } from 'next';
import { searchProducts } from '@blanxer-dev/storefront/server';
import { ProductGrid } from '@/components/product-card';
import { store } from '@/lib/site';

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : 'Search', robots: { index: false, follow: true } };
}

export default async function Search({ searchParams }: Props) {
  const q = String((await searchParams).q || '').trim();
  const [s, results] = await Promise.all([store(), searchProducts(q)]);
  return (
    <section className="section container">
      <h1>Search</h1>
      <form action="/search" className="chips" role="search">
        <input className="bx-input" name="q" type="search" defaultValue={q} placeholder="Search products" aria-label="Search products" minLength={3} />
      </form>
      {q.length < 3 ? (
        <p className="muted">Type at least 3 characters.</p>
      ) : (
        <ProductGrid products={results} store={s} eagerCount={4} empty={`Nothing found for “${q}”.`} />
      )}
    </section>
  );
}
