/**
 * @blanxer-dev/storefront/seo — Next `Metadata` objects and JSON-LD from the SEO
 * fields merchants edit in Blanxer (product/category/brand `seo_title`,
 * `seo_description`, `seo_image`; landing page SEO; blog SEO) and the store's
 * Search Console / meta-tag plugins. Pure functions: usable in
 * `generateMetadata` and Server Components.
 */
import type { Metadata } from 'next';
import { storeName } from '../core/store.js';
import { listPrice } from '../core/variants.js';
import type { Product, Store } from '../core/types.js';

type Origin = { origin?: string };

const abs = (origin: string | undefined, path: string) => (origin ? `${origin.replace(/\/+$/, '')}${path}` : path);
const clip = (s: string | undefined, n = 300) => {
  const v = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
/** `alternates.canonical` + `openGraph.url` only when the site origin is known (else Next would resolve them against localhost). */
const canonical = (origin: string | undefined, path: string) => (origin ? { canonical: abs(origin, path) } : null);
const images = (...urls: Array<string | undefined | null>) => {
  const u = urls.find((x) => !!x);
  return u ? [{ url: u }] : undefined;
};

/** `<meta name=…>` tags from the store's plugins: Google Search Console and other `meta_tags`. */
export function verificationMetadata(store: Partial<Store> | null | undefined): Metadata {
  const tags: Array<{ n: string; c: string }> = [];
  for (const p of store?.plugins || []) {
    if (p?.name === 'meta_tags' && Array.isArray(p.details)) {
      for (const t of p.details) if (t?.n && t?.c) tags.push({ n: String(t.n), c: String(t.c) });
    }
  }
  if (!tags.length) return {};
  const other: Record<string, string> = {};
  let google: string | undefined;
  for (const t of tags) {
    if (/^google-site-verification$/i.test(t.n)) google = t.c;
    else other[t.n] = t.c;
  }
  return {
    ...(google ? { verification: { google } } : {}),
    ...(Object.keys(other).length ? { other } : {}),
  };
}

/** Site-wide defaults for the root layout: title template, description, favicon, OG, verification. */
export function storeMetadata(
  store: Partial<Store>,
  opts: Origin & { homeSeo?: { seo_title?: string; seo_description?: string; seo_image?: string } } = {},
): Metadata {
  const name = storeName(store);
  const description = clip(opts.homeSeo?.seo_description || store.description || store.customization?.top_bar_text || name, 300);
  const image = opts.homeSeo?.seo_image || store.customization?.hero_images?.[0] || store.customization?.brand_logo;
  const fav = store.customization?.favicon;
  const v = verificationMetadata(store);
  return {
    ...(opts.origin ? { metadataBase: new URL(opts.origin) } : {}),
    title: { default: opts.homeSeo?.seo_title || name, template: `%s | ${name}` },
    description,
    applicationName: name,
    ...(fav ? { icons: { icon: fav, apple: fav } } : {}),
    openGraph: {
      type: 'website',
      siteName: name,
      title: opts.homeSeo?.seo_title || name,
      description,
      locale: 'en_US',
      ...(images(image) ? { images: images(image) } : {}),
      ...(opts.origin ? { url: abs(opts.origin, '/') } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.homeSeo?.seo_title || name,
      description,
      ...(image ? { images: [image] } : {}),
    },
    ...(opts.origin ? { alternates: { canonical: abs(opts.origin, '/') } } : {}),
    robots: { index: true, follow: true },
    ...v,
    // Marks the site as a BlanxerAPI site for this store. Blanxer's nightly check reads these
    // two tags to confirm a saved website link really serves this store; keep them.
    generator: 'Blanxer Storefront',
    other: { ...(v.other || {}), 'blanxer-store': String(store._id || '') },
  };
}

/** Product page metadata: `seo_title`/`seo_description`/`seo_image` with fallbacks to name/description/first image. */
export function productMetadata(product: Product, store: Partial<Store>, opts: Origin = {}): Metadata {
  const name = storeName(store);
  const title = product.seo_title || product.name;
  const description = clip(product.seo_description || product.description || product.name, 300);
  const image = product.seo_image || product.image_urls?.[0];
  const c = canonical(opts.origin, `/product/${product.slug}`);
  const { price } = listPrice(product);
  return {
    title,
    description,
    ...(c ? { alternates: c } : {}),
    openGraph: {
      type: 'website',
      siteName: name,
      title,
      description,
      ...(c ? { url: c.canonical } : {}),
      ...(images(image) ? { images: images(image) } : {}),
    },
    twitter: { card: 'summary_large_image', title, description, ...(image ? { images: [image] } : {}) },
    other: {
      'product:price:amount': String(price),
      'product:price:currency': 'NPR',
    },
  };
}

/** Collection page metadata from the store category's SEO fields (falls back to its name). */
export function categoryMetadata(
  store: Partial<Store>,
  category: { name?: string; slug: string; seo_title?: string; seo_description?: string; seo_image?: string; image?: string },
  opts: Origin = {},
): Metadata {
  const storeCat = (store.categories || []).find((c) => c.slug === category.slug);
  const title = storeCat?.seo_title || category.seo_title || storeCat?.name || category.name || category.slug;
  const description = clip(
    storeCat?.seo_description || category.seo_description || store.description || `Shop ${title} at ${storeName(store)}.`,
    300,
  );
  const image = storeCat?.seo_image || storeCat?.image || category.seo_image || store.customization?.hero_images?.[0];
  const c = canonical(opts.origin, `/collections/${category.slug}`);
  return {
    title,
    description,
    ...(c ? { alternates: c } : {}),
    openGraph: { type: 'website', title, description, ...(c ? { url: c.canonical } : {}), ...(images(image) ? { images: images(image) } : {}) },
  };
}

/** Brand page metadata from the brand page's SEO fields. */
export function brandMetadata(
  store: Partial<Store>,
  brand: { name: string; slug: string; logo?: string },
  page?: { seo_title?: string; seo_description?: string; seo_image?: string } | null,
  opts: Origin = {},
): Metadata {
  const title = page?.seo_title || brand.name;
  const description = clip(page?.seo_description || `Shop ${brand.name} at ${storeName(store)}.`, 300);
  const image = page?.seo_image || brand.logo;
  const c = canonical(opts.origin, `/brand/${brand.slug}`);
  return {
    title,
    description,
    ...(c ? { alternates: c } : {}),
    openGraph: { type: 'website', title, description, ...(c ? { url: c.canonical } : {}), ...(images(image) ? { images: images(image) } : {}) },
  };
}

/** Blog post metadata (`seo_title`, `seo_description`, `seo_image`, `no_index`). */
export function blogPostMetadata(post: any, store: Partial<Store>, opts: Origin = {}): Metadata {
  const title = post?.seo_title || post?.name || 'Blog';
  const description = clip(post?.seo_description || post?.excerpt || store.description || '', 300);
  const image = post?.seo_image || post?.featured_image;
  const c = canonical(opts.origin, `/blog/${post?.slug}`);
  return {
    title,
    description,
    ...(c ? { alternates: c } : {}),
    ...(post?.no_index ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: 'article',
      title,
      description,
      ...(c ? { url: c.canonical } : {}),
      ...(post?.published_at ? { publishedTime: post.published_at } : {}),
      ...(post?.author?.name ? { authors: [post.author.name] } : {}),
      ...(images(image) ? { images: images(image) } : {}),
    },
  };
}

/** For checkout, cart, payment and tracking pages. */
export const noIndexMetadata = (title: string): Metadata => ({ title, robots: { index: false, follow: false } });

// ------------------------------------------------------------------ JSON-LD

const SCHEMA = 'https://schema.org';

const inStock = (p: Product) =>
  !!p.continue_selling ||
  Number(p.quantity) > 0 ||
  (p.variants || []).some((v) => Number(v?.quantity) > 0);

/** schema.org Product — same rules as the Blanxer storefront (only real data, no placeholders). */
export function productJsonLd(product: Product, store: Partial<Store>, opts: Origin = {}) {
  const origin = (opts.origin || '').replace(/\/+$/, '');
  const url = `${origin}/product/${product.slug}`;
  const price = product.variants?.length ? product.variants[0]?.price ?? listPrice(product).price : product.price;
  const name = storeName(store);
  const schema: Record<string, any> = {
    '@context': `${SCHEMA}/`,
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    url,
    description: product.seo_description || clip(product.description, 5000) || product.name,
    image: (product.image_urls || []).filter(Boolean),
    offers: {
      '@type': 'Offer',
      url,
      ...(price != null ? { price: `${price}` } : {}),
      priceCurrency: 'NPR',
      availability: inStock(product) ? `${SCHEMA}/InStock` : `${SCHEMA}/OutOfStock`,
      itemCondition: `${SCHEMA}/NewCondition`,
      seller: { '@type': 'Organization', name, url: `${origin}/` },
    },
  };
  if (product.sku) schema.sku = product.sku;
  if (product.barcode) schema.gtin = product.barcode;
  const brand = typeof product.brand === 'object' ? product.brand : null;
  if (brand?.name) schema.brand = { '@type': 'Brand', name: brand.name, ...(brand.logo ? { logo: brand.logo } : {}) };
  const ids = (product.categories || []).map(String);
  const cat = (store.categories || []).find((c) => ids.includes(String(c._id)) || ids.includes(c.name));
  if (cat?.name) schema.category = cat.name;
  if (Number(product.review_count) > 0 && Number(product.total_rating) > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: `${product.total_rating}`,
      reviewCount: `${product.review_count}`,
    };
  }
  const reviews = (product.reviews || []).filter((r: any) => r?.rating);
  if (reviews.length) {
    schema.review = reviews.map((r: any) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r?.customer_name || 'Customer' },
      reviewRating: { '@type': 'Rating', ratingValue: `${r.rating}` },
      ...(r?.review ? { reviewBody: r.review } : {}),
      ...(r?.created_at ? { datePublished: r.created_at } : {}),
    }));
  }
  return schema;
}

/** schema.org WebSite + Organization graph for the home page (storefront `buildStoreSchema`). */
export function organizationJsonLd(store: Partial<Store>, opts: Origin = {}) {
  const url = (opts.origin || '').replace(/\/+$/, '');
  const name = storeName(store);
  const logo = store.customization?.brand_logo || store.display_image || '';
  const description = store.description || '';
  const businessAddress = store.compliance?.business_address || '';
  const website: Record<string, any> = {
    '@type': 'WebSite',
    '@id': `${url}/#website`,
    url: `${url}/`,
    name,
    publisher: { '@id': `${url}/#organization` },
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${url}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
  if (description) website.description = description;
  const org: Record<string, any> = {
    '@type': businessAddress ? ['Organization', 'LocalBusiness'] : 'Organization',
    '@id': `${url}/#organization`,
    name,
    url: `${url}/`,
  };
  if (logo) {
    org.logo = { '@type': 'ImageObject', url: logo };
    org.image = logo;
  }
  if (description) org.description = description;
  if (businessAddress) org.address = { '@type': 'PostalAddress', streetAddress: businessAddress };
  const social = store.social || {};
  const sameAs = [social.facebook, social.instagram, social.tiktok].filter(
    (v: any) => typeof v === 'string' && /^https?:\/\//.test(v),
  );
  if (sameAs.length) org.sameAs = sameAs;
  return { '@context': SCHEMA, '@graph': [website, org] };
}

/** schema.org BreadcrumbList. `items` are `{ name, path }` from the home page down. */
export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>, opts: Origin = {}) {
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(opts.origin, it.path),
    })),
  };
}

/** Serialise JSON-LD for `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(x) }} />` (escapes `<`). */
export const jsonLd = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');
