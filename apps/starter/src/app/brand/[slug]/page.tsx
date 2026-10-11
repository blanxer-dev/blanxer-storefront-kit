import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBrand } from '@blanxer-dev/storefront/server';
import { brandMetadata } from '@blanxer-dev/storefront/seo';
import { ProductGrid } from '@/components/product-card';
import { origin, slugParam, store } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [s, o, res] = await Promise.all([store(), origin(), getBrand(slugParam(slug))]);
  if (!res) return { title: 'Brand not found', robots: { index: false } };
  return brandMetadata(s, res.brand, res.page, { origin: o });
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const [s, res] = await Promise.all([store(), getBrand(slugParam(slug))]);
  if (!res) notFound();
  return (
    <section className="section container">
      <h1>{res.brand.name}</h1>
      <ProductGrid products={res.products} store={s} eagerCount={4} empty="No products from this brand yet." />
    </section>
  );
}
