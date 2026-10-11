import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getBrands } from '@blanxer-dev/storefront/server';

export const metadata: Metadata = { title: 'Brands' };

export default async function Brands() {
  const brands = await getBrands();
  return (
    <section className="section container">
      <h1>Brands</h1>
      {brands.length ? (
        <div className="tiles">
          {brands.map((b) => (
            <Link key={b._id} href={`/brand/${b.slug}`} className="tile">
              <span className="tile-media">{b.logo ? <Image src={b.logo} alt={b.name} fill sizes="(max-width: 640px) 50vw, 180px" /> : null}</span>
              {b.name}
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">No brands yet.</p>
      )}
    </section>
  );
}
