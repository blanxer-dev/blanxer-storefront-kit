import type { Metadata } from 'next';
import { getSaleProducts } from '@blanxer/storefront/server';
import { ProductGrid } from '@/components/product-card';
import { store } from '@/lib/site';

export const metadata: Metadata = { title: 'Sale' };

export default async function Sale() {
  const [s, products] = await Promise.all([store(), getSaleProducts()]);
  return (
    <section className="section container">
      <h1>Sale</h1>
      <ProductGrid products={products} store={s} eagerCount={4} empty="No products on sale right now." />
    </section>
  );
}
