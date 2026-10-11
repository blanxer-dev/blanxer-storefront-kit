import { sitemapIndexRoute } from '@blanxer-dev/storefront/next';

// Sitemap index: Blanxer's catalog sitemap (/sitemap-catalog.xml) plus any
// sitemaps of this site's own extra pages, e.g. sitemapIndexRoute({ extra: ['/sitemap-pages.xml'] }).
export const GET = sitemapIndexRoute();
