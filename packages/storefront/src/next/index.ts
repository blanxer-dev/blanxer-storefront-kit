/**
 * @blanxer-dev/storefront/next — route handlers and the image loader.
 *
 *   app/sitemap.xml/route.ts          export const GET = sitemapIndexRoute();
 *   app/sitemap-catalog.xml/route.ts  export const GET = catalogSitemapRoute();
 *   app/robots.txt/route.ts           export const GET = robotsRoute();
 */
import { BROWSER_USER_AGENT } from '../core/config.js';
import { apiBase, getStoreId, siteOrigin } from '../server/index.js';

export { blanxerImageLoader, createImageLoader } from './image-loader.js';
export type { ImageLoaderProps, ImageProvider } from './image-loader.js';

const xml = (body: string, maxAge: number, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
    },
  });

/**
 * GET handler that passes through the catalog sitemap Blanxer builds for the
 * store (products, collections, brands, blog) — `GET /public/sitemap/:store_id.xml`.
 * Cached 1 hour. Don't build your own catalog sitemap.
 */
export function catalogSitemapRoute(opts: { revalidate?: number } = {}) {
  const revalidate = opts.revalidate ?? 3600;
  return async function GET(): Promise<Response> {
    const id = await getStoreId();
    const res = await fetch(`${apiBase()}/public/sitemap/${id}.xml`, {
      headers: { Accept: 'application/xml', 'User-Agent': BROWSER_USER_AGENT },
      next: { revalidate },
    } as RequestInit);
    if (!res.ok) return xml('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', 60, 502);
    return xml(await res.text(), revalidate);
  };
}

/**
 * GET handler for `/sitemap.xml`: a sitemap index listing `/sitemap-catalog.xml`
 * plus any extra sitemaps of the site's own pages (paths or absolute URLs).
 */
export function sitemapIndexRoute(opts: { extra?: string[] } = {}) {
  return async function GET(): Promise<Response> {
    const origin = await siteOrigin();
    const list = ['/sitemap-catalog.xml', ...(opts.extra || [])].map((p) => (p.startsWith('http') ? p : `${origin}${p}`));
    const now = new Date().toISOString();
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      list.map((loc) => `  <sitemap><loc>${loc.replace(/&/g, '&amp;')}</loc><lastmod>${now}</lastmod></sitemap>`).join('\n') +
      `\n</sitemapindex>\n`;
    return xml(body, 3600);
  };
}

/** GET handler for `/robots.txt` (same rules as the Blanxer storefront, plus the sitemap index). */
export function robotsRoute(opts: { disallow?: string[] } = {}) {
  return async function GET(): Promise<Response> {
    const origin = await siteOrigin();
    const disallow = ['/checkout', '/cart', '/payment/', '/track/', '/cdn-cgi/', ...(opts.disallow || [])];
    const body = `User-agent: *\nAllow: /\n${disallow.map((d) => `Disallow: ${d}`).join('\n')}\n\nSitemap: ${origin}/sitemap.xml\n`;
    return new Response(body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
  };
}
