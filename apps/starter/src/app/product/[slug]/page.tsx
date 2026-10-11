import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct } from '@blanxer/storefront/server';
import { breadcrumbJsonLd, productJsonLd, productMetadata } from '@blanxer/storefront/seo';
import { AddToCart } from '@blanxer/storefront/react';
import { JsonLd } from '@/components/json-ld';
import { origin, slugParam, store } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [s, o, product] = await Promise.all([store(), origin(), getProduct(slugParam(slug))]);
  if (!product) return { title: 'Product not found', robots: { index: false } };
  return productMetadata(product, s, { origin: o });
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [s, o, product] = await Promise.all([store(), origin(), getProduct(slugParam(slug))]);
  if (!product) notFound();

  const images = (product.image_urls || []).filter(Boolean);
  const category = (s.categories || []).find((c) => (product.categories || []).map(String).includes(String(c._id)));
  const crumbs = [
    { name: 'Home', path: '/' },
    ...(category ? [{ name: category.name, path: `/collections/${category.slug}` }] : [{ name: 'Products', path: '/products' }]),
    { name: product.name, path: `/product/${product.slug}` },
  ];

  return (
    <div className="container">
      <JsonLd data={productJsonLd(product, s, { origin: o })} />
      <JsonLd data={breadcrumbJsonLd(crumbs, { origin: o })} />
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.slice(0, -1).map((c) => (
          <span key={c.path}>
            <Link href={c.path}>{c.name}</Link> /
          </span>
        ))}
      </nav>
      <div className="pdp">
        <div>
          <div className="gallery-main">
            {images[0] ? <Image src={images[0]} alt={product.name} fill preload sizes="(max-width: 860px) 100vw, 55vw" /> : null}
          </div>
          {images.length > 1 ? (
            <div className="gallery-thumbs">
              {images.slice(1, 9).map((src, i) => (
                <div key={src}>
                  <Image src={src} alt={`${product.name} ${i + 2}`} fill sizes="96px" />
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <h1>{product.name}</h1>
          {/* Price, flash sale, variants, custom fields, quantity, add to cart, back-in-stock: all from the package. */}
          <AddToCart product={product} />
          {product.description ? (
            <div className="prose" dangerouslySetInnerHTML={{ __html: product.description }} />
          ) : null}
        </div>
      </div>
      {product.long_description ? (
        <section className="section prose narrow" dangerouslySetInnerHTML={{ __html: product.long_description }} />
      ) : null}
    </div>
  );
}
