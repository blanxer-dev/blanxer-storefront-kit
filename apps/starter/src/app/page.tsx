import Image from 'next/image';
import Link from 'next/link';
import { getCategory, getSaleProducts } from '@blanxer-dev/storefront/server';
import { organizationJsonLd } from '@blanxer-dev/storefront/seo';
import { ProductGrid } from '@/components/product-card';
import { JsonLd } from '@/components/json-ld';
import { origin, store, usableHref } from '@/lib/site';

export default async function Home() {
  const [s, o, latest, sale] = await Promise.all([store(), origin(), getCategory('new-arrivals'), getSaleProducts()]);
  const c = s.customization || {};
  const hero = c.hero_images?.[0];
  const heroLink = usableHref(c.hero_links?.[0]) || '/products';
  const categories = (s.categories || []).filter((cat) => cat.image).slice(0, 8);

  return (
    <>
      <JsonLd data={organizationJsonLd(s, { origin: o })} />
      {hero ? (
        <section className="hero">
          {/* The LCP image: preload, full width. */}
          <Image src={hero} alt={c.hero_taglines?.[0] || s.name} fill preload sizes="100vw" />
          <div className="hero-text">
            <div className="hero-inner">
              {c.hero_taglines?.[0] ? <p>{c.hero_taglines[0]}</p> : null}
              <Link href={heroLink} className="hero-cta">
                Shop now
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {categories.length ? (
        <section className="section container">
          <div className="section-head">
            <h2>Shop by category</h2>
            <Link href="/products">All products</Link>
          </div>
          <div className="tiles">
            {categories.map((cat) => (
              <Link key={cat._id} href={`/collections/${cat.slug}`} className="tile">
                <span className="tile-media">
                  <Image src={cat.image!} alt={cat.name} fill sizes="(max-width: 640px) 50vw, 180px" />
                </span>
                {cat.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section container">
        <div className="section-head">
          <h2>New arrivals</h2>
          <Link href="/collections/new-arrivals">See all</Link>
        </div>
        <ProductGrid products={(latest?.products || []).slice(0, 8)} store={s} eagerCount={hero ? 0 : 4} />
      </section>

      {sale.length ? (
        <section className="section container">
          <div className="section-head">
            <h2>On sale</h2>
            <Link href="/sale">See all</Link>
          </div>
          <ProductGrid products={sale.slice(0, 4)} store={s} />
        </section>
      ) : null}
    </>
  );
}
