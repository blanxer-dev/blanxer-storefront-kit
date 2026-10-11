import type { Metadata } from 'next';
import Link from 'next/link';
import { getProductsPage } from '@blanxer-dev/storefront/server';
import { ProductGrid } from '@/components/product-card';
import { Pagination } from '@/components/pagination';
import { store } from '@/lib/site';

export const metadata: Metadata = { title: 'All products' };

const SORTS = [
  { key: 'newest', label: 'Newest', sortBy: 'created_at', sortOrder: 'desc' },
  { key: 'price-asc', label: 'Price: low to high', sortBy: 'price', sortOrder: 'asc' },
  { key: 'price-desc', label: 'Price: high to low', sortBy: 'price', sortOrder: 'desc' },
  { key: 'name', label: 'Name', sortBy: 'name', sortOrder: 'asc' },
] as const;

const PER_PAGE = 24;

export default async function Products({ searchParams }: { searchParams: Promise<{ page?: string; sort?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sort = SORTS.find((x) => x.key === sp.sort) || SORTS[0];
  const [s, res] = await Promise.all([store(), getProductsPage({ page, perPage: PER_PAGE, sortBy: sort.sortBy, sortOrder: sort.sortOrder })]);
  const href = (p: number, k: string = sort.key) => `/products?${new URLSearchParams({ ...(k !== 'newest' ? { sort: k } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <section className="section container">
      <h1>All products</h1>
      <nav className="chips" aria-label="Categories">
        <Link href="/collections/new-arrivals">New arrivals</Link>
        {(s.categories || []).map((cat) => (
          <Link key={cat._id} href={`/collections/${cat.slug}`}>
            {cat.name}
          </Link>
        ))}
      </nav>
      <nav className="sort" aria-label="Sort">
        <span className="muted">Sort:</span>
        {SORTS.map((x) => (
          <Link key={x.key} href={href(1, x.key)} aria-current={x.key === sort.key ? 'true' : undefined}>
            {x.label}
          </Link>
        ))}
      </nav>
      <ProductGrid products={res.products} store={s} eagerCount={4} />
      <Pagination page={res.meta.page || page} totalPages={res.meta.total_pages} href={(p) => href(p)} />
    </section>
  );
}
