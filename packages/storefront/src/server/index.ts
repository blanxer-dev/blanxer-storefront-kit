/**
 * @blanxer/storefront/server — store and catalog reads for Server Components,
 * `generateMetadata`, route handlers and build time.
 *
 * Every call is a GET with Next's data cache (`revalidate: 60` by default) and
 * a normal browser User-Agent. Nothing here places orders or starts payments:
 * those calls are browser-only (`@blanxer/storefront/client`).
 *
 * Env: BLANXER_STORE (subdomain, required), BLANXER_API (default https://api.blanxer.com),
 * SITE_URL (optional, the site's public origin; used for canonical URLs and robots/sitemaps).
 */
import { BROWSER_USER_AGENT, normalizeApiBase } from '../core/config.js';
import { BlanxerApiError, readBody } from '../core/http.js';
import { toClientStore } from '../core/store.js';
import type { DeliveryTable, Product, ProductsPage, Store, StoreCategory } from '../core/types.js';

export { toClientStore };

type NextFetchInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };

export interface ServerFetchOptions {
  /** Seconds to keep the response in Next's data cache. Default 60. */
  revalidate?: number | false;
}

/** API base from `BLANXER_API` (no trailing slash). */
export const apiBase = (): string => normalizeApiBase(process.env.BLANXER_API);

/** The `BLANXER_STORE` subdomain (or custom domain). Throws a clear error when unset. */
export const storeHandle = (): string => {
  const v = String(process.env.BLANXER_STORE || '').trim();
  if (!v) {
    throw new Error(
      '[@blanxer/storefront] BLANXER_STORE is not set. Add BLANXER_STORE=<your store subdomain> to .env (and to the Cloudflare Worker vars).',
    );
  }
  return v;
};

const DEFAULT_REVALIDATE = 60;

// Per-process / per-Worker-isolate copy of recent responses, kept for the same
// `revalidate` seconds. Next's data cache already does this under `next start`;
// on Cloudflare Workers without an incremental cache binding (the starter's
// default OpenNext config) this memo is what keeps catalog reads at ~1 per
// minute per isolate instead of one per page view.
const MEMO_MAX = 300;
const memo = new Map<string, { at: number; ttl: number; body: any }>();

const memoGet = (url: string) => {
  const hit = memo.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl * 1000) {
    memo.delete(url);
    return undefined;
  }
  return hit.body;
};

const memoSet = (url: string, ttl: number, body: any) => {
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(url, { at: Date.now(), ttl, body });
};

/** Low-level GET against the Blanxer API with caching and the browser UA. Returns `null` on 404. */
export async function blanxerGet<T = any>(path: string, opts: ServerFetchOptions = {}): Promise<T | null> {
  const url = `${apiBase()}${path}`;
  const revalidate = opts.revalidate ?? DEFAULT_REVALIDATE;
  const ttl = typeof revalidate === 'number' && revalidate > 0 ? revalidate : 0;
  if (ttl) {
    const cached = memoGet(url);
    if (cached !== undefined) return cached as T | null;
  }
  const init: NextFetchInit = {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_USER_AGENT },
    ...(revalidate === 0 ? { cache: 'no-store' as RequestCache } : { next: { revalidate, tags: ['blanxer'] } }),
  };
  const res = await fetch(url, init);
  if (res.status === 404) {
    if (ttl) memoSet(url, ttl, null);
    return null;
  }
  const body = await readBody(res);
  if (!res.ok) throw new BlanxerApiError(res.status, body, url);
  if (ttl) memoSet(url, ttl, body);
  return body as T;
}

const enc = encodeURIComponent;

// The store id never changes for a handle, so it is memoised for the life of
// the server process / Worker isolate on top of the 60 s data cache.
const storeIdMemo = new Map<string, string>();

/** Full store config from `GET /store/check_domain?domain=BLANXER_STORE` (branding, checkout, categories, plugins…). */
export async function getStore(opts?: ServerFetchOptions): Promise<Store> {
  const handle = storeHandle();
  const store = await blanxerGet<Store>(`/store/check_domain?domain=${enc(handle)}`, opts);
  if (!store?._id) {
    throw new Error(`[@blanxer/storefront] No Blanxer store found for BLANXER_STORE="${handle}" at ${apiBase()}.`);
  }
  storeIdMemo.set(handle, store._id);
  return store;
}

/** The store `_id` (cached). */
export async function getStoreId(): Promise<string> {
  const handle = storeHandle();
  const hit = storeIdMemo.get(handle);
  if (hit) return hit;
  return (await getStore())._id;
}

/** The browser-safe subset of the store, for `<BlanxerProvider store>`. */
export async function getClientStore(opts?: ServerFetchOptions): Promise<Store> {
  return toClientStore(await getStore(opts));
}

/** Every active product (unpaginated, can be several MB for big stores — prefer `getProductsPage`). */
export async function getProducts(opts?: ServerFetchOptions): Promise<Product[]> {
  const id = await getStoreId();
  return (await blanxerGet<Product[]>(`/product/public/${id}`, opts)) || [];
}

export interface ProductsPageQuery {
  page?: number;
  /** ≤ 100 */
  perPage?: number;
  sortBy?: 'created_at' | 'price' | 'name' | string;
  sortOrder?: 'asc' | 'desc';
}

/** One page of active products. */
export async function getProductsPage(q: ProductsPageQuery = {}, opts?: ServerFetchOptions): Promise<ProductsPage> {
  const id = await getStoreId();
  const sp = new URLSearchParams();
  sp.set('page', String(Math.max(1, Math.floor(q.page || 1))));
  sp.set('per_page', String(Math.min(100, Math.max(1, Math.floor(q.perPage || 24)))));
  if (q.sortBy) sp.set('sort_by', q.sortBy);
  if (q.sortOrder) sp.set('sort_order', q.sortOrder);
  const res = await blanxerGet<any>(`/product/p/public/${id}?${sp.toString()}`, opts);
  return {
    meta: res?.meta || { page: 1, per_page: 0, total: 0, total_pages: 0, sort_by: '', sort_order: '' },
    products: res?.products || [],
  };
}

/** One product by slug (or id). `null` when missing, not active, or POS-only (channel 3). */
export async function getProduct(slug: string, opts?: ServerFetchOptions): Promise<Product | null> {
  const id = await getStoreId();
  try {
    const p = await blanxerGet<Product>(`/product/public/${id}/${enc(slug)}`, opts);
    if (!p?._id) return null;
    if (p.channel === 3) return null;
    if (p.status && p.status !== 'Active') return null;
    return p;
  } catch (e) {
    if (e instanceof BlanxerApiError && e.status < 500) return null;
    throw e;
  }
}

export interface CategoryResult {
  category: { _id: string | number; name: string; slug: string; [k: string]: any };
  /** The store-level category record (SEO fields, image), when it exists. `new-arrivals` has none. */
  storeCategory: StoreCategory | null;
  products: Product[];
}

/** Category (or the virtual `new-arrivals`) with its products. `null` when not found. */
export async function getCategory(slug: string, opts?: ServerFetchOptions): Promise<CategoryResult | null> {
  const store = await getStore(opts);
  try {
    const res = await blanxerGet<any>(`/product/public/${store._id}/category/${enc(slug)}`, opts);
    if (!res?.category) return null;
    const storeCategory = (store.categories || []).find((c) => c.slug === slug) || null;
    return { category: res.category, storeCategory, products: res.products || [] };
  } catch (e) {
    if (e instanceof BlanxerApiError && e.status < 500) return null;
    throw e;
  }
}

export interface Brand {
  _id: string;
  slug: string;
  name: string;
  logo?: string;
  [k: string]: any;
}

export async function getBrands(opts?: ServerFetchOptions): Promise<Brand[]> {
  const id = await getStoreId();
  const res = await blanxerGet<any>(`/brand/public/all/${id}`, opts);
  return res?.brands || [];
}

export interface BrandResult {
  brand: Brand;
  /** Brand page record: `seo_title`, `seo_description`, `seo_image`. */
  page: { seo_title?: string; seo_description?: string; seo_image?: string; [k: string]: any } | null;
  products: Product[];
}

/** Brand details + products. `null` when not found. */
export async function getBrand(slug: string, opts?: ServerFetchOptions): Promise<BrandResult | null> {
  const id = await getStoreId();
  try {
    const [details, list] = await Promise.all([
      blanxerGet<any>(`/brand/public/details/${id}/${enc(slug)}`, opts),
      blanxerGet<any>(`/brand/public/products/${id}/${enc(slug)}`, opts),
    ]);
    const brand = details?.brand || list?.brand;
    if (!brand) return null;
    const page = details?.page || (typeof list?.brand?.page === 'object' ? list.brand.page : null);
    return { brand, page, products: list?.products || [] };
  } catch (e) {
    if (e instanceof BlanxerApiError && e.status < 500) return null;
    throw e;
  }
}

/** Search (needs ≥ 3 characters; shorter queries return []). */
export async function searchProducts(q: string, opts?: ServerFetchOptions): Promise<Product[]> {
  const query = String(q || '').trim();
  if (query.length < 3) return [];
  const id = await getStoreId();
  const res = await blanxerGet<any>(`/product/public/search/${id}?q=${enc(query)}`, opts);
  return Array.isArray(res) ? res : res?.products || [];
}

export async function getSaleProducts(opts?: ServerFetchOptions): Promise<Product[]> {
  const id = await getStoreId();
  const res = await blanxerGet<any>(`/product/public/sale/${id}`, opts);
  return Array.isArray(res) ? res : res?.products || [];
}

/** Delivery places and charges (`{ defaults, places }`). */
export async function getDeliveryCharges(opts?: ServerFetchOptions): Promise<DeliveryTable> {
  const id = await getStoreId();
  const res = await blanxerGet<DeliveryTable>(`/public/delivery_charge/${id}`, opts);
  return { defaults: res?.defaults || [], places: res?.places || [] };
}

/** Live and upcoming flash sales. Not cached by default (units change by the second). */
export async function getFlashSales(opts: ServerFetchOptions = { revalidate: 0 }): Promise<{ server_time: string; sales: any[] }> {
  const id = await getStoreId();
  const res = await blanxerGet<any>(`/public/flash-sale/${id}`, opts);
  return { server_time: res?.server_time || new Date().toISOString(), sales: res?.sales || [] };
}

export interface BlogQuery {
  cursor?: string;
  category?: string;
  tag?: string;
  author?: string;
  q?: string;
}

export interface BlogIndex {
  items: any[];
  next_cursor: string | null;
  has_more?: boolean;
  all_categories?: Array<{ slug: string; name: string; image?: string }>;
}

export async function getBlogPosts(q: BlogQuery = {}, opts?: ServerFetchOptions): Promise<BlogIndex> {
  const id = await getStoreId();
  const sp = new URLSearchParams();
  for (const k of ['cursor', 'category', 'tag', 'author', 'q'] as const) if (q[k]) sp.set(k, String(q[k]));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const res = await blanxerGet<BlogIndex>(`/public/blog/${id}${qs}`, opts);
  return { items: res?.items || [], next_cursor: res?.next_cursor ?? null, has_more: res?.has_more, all_categories: res?.all_categories || [] };
}

export async function getBlogPost(slug: string, opts?: ServerFetchOptions): Promise<any | null> {
  const id = await getStoreId();
  try {
    const post = await blanxerGet<any>(`/public/blog/${id}/${enc(slug)}`, opts);
    return post?._id ? post : null;
  } catch (e) {
    if (e instanceof BlanxerApiError && e.status < 500) return null;
    throw e;
  }
}

/** A Blanxer form (Forms in the dashboard). `null` when missing. */
export async function getForm(slug: string, opts?: ServerFetchOptions): Promise<any | null> {
  const id = await getStoreId();
  try {
    const form = await blanxerGet<any>(`/public/form/${id}/${enc(slug)}`, opts);
    return form?.fields ? form : form?.form || null;
  } catch (e) {
    if (e instanceof BlanxerApiError && e.status < 500) return null;
    throw e;
  }
}

/** Home-page SEO the merchant set on the Blanxer landing page (`seo_title`, `seo_description`, `seo_image`). */
export async function getHomeSeo(opts?: ServerFetchOptions): Promise<{ seo_title?: string; seo_description?: string; seo_image?: string }> {
  const id = await getStoreId();
  try {
    const page = await blanxerGet<any>(`/public/landing/${id}`, opts);
    return { seo_title: page?.seo_title || '', seo_description: page?.seo_description || '', seo_image: page?.seo_image || '' };
  } catch {
    return {};
  }
}

const cleanOrigin = (v: string) => {
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
};

/**
 * The site's public origin, e.g. `https://shop.example.com`:
 * `SITE_URL` env → the store's `storefront_url` (set when the site is linked
 * in Blanxer) → the request host.
 *
 * Reading the request host makes the calling route dynamic, so pages that
 * should stay static (layouts, `generateMetadata`) pass `{ fromRequest: false }`
 * and get `''` while the origin is unknown — the SEO helpers then leave
 * canonical URLs out instead of pointing them at localhost.
 */
export async function siteOrigin(opts: { fromRequest?: boolean } = {}): Promise<string> {
  const env = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return cleanOrigin(env);
  try {
    const store = await getStore();
    if (store.storefront_url) return cleanOrigin(store.storefront_url);
  } catch {
    /* fall through to the request host */
  }
  if (opts.fromRequest === false) return '';
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (host) {
      const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
      return `${proto.split(',')[0]}://${host.split(',')[0]}`;
    }
  } catch (e) {
    // Let Next's own control-flow errors (dynamic-usage bailout during prerender) through.
    const { unstable_rethrow } = await import('next/navigation');
    unstable_rethrow(e);
    /* outside a request */
  }
  return 'http://localhost:3000';
}
