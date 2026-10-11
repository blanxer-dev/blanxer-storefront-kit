import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategory } from '@blanxer-dev/storefront/server';
import { breadcrumbJsonLd, categoryMetadata } from '@blanxer-dev/storefront/seo';
import { ProductGrid } from '@/components/product-card';
import { JsonLd } from '@/components/json-ld';
import { origin, slugParam, store } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [s, o, res] = await Promise.all([store(), origin(), getCategory(slugParam(slug))]);
  if (!res) return { title: 'Collection not found', robots: { index: false } };
  return categoryMetadata(s, { ...res.category, ...(res.storeCategory || {}), slug: res.category.slug }, { origin: o });
}

/** `/collections/<slug>`, including the virtual `new-arrivals`. */
export default async function Collection({ params }: Props) {
  const { slug } = await params;
  const [s, o, res] = await Promise.all([store(), origin(), getCategory(slugParam(slug))]);
  if (!res) notFound();
  const name = res.storeCategory?.name || res.category.name;
  return (
    <section className="section container">
      <JsonLd
        data={breadcrumbJsonLd(
          [
            { name: 'Home', path: '/' },
            { name, path: `/collections/${res.category.slug}` },
          ],
          { origin: o },
        )}
      />
      <h1>{name}</h1>
      <ProductGrid products={res.products} store={s} eagerCount={4} empty="No products in this collection yet." />
    </section>
  );
}
