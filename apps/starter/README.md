# Blanxer storefront starter

A plain, fast Next.js 16 (App Router, TypeScript) website for a [Blanxer](https://blanxer.com) store, ready to restyle and deploy to your own Cloudflare account. Blanxer stays the admin: products, stock, orders, payments, delivery charges and SEO text come from Blanxer through the public API, and the checkout is Blanxer's own checkout from [`@blanxer-dev/storefront`](https://www.npmjs.com/package/@blanxer-dev/storefront).

Building with an AI agent? Point it at https://developers.blanxer.com/llms.txt (Claude Code: `/plugin marketplace add blanxer-dev/blanxer-agent-skills`, then `/plugin install blanxer-website@blanxer`).

## Quick start

```bash
npx degit blanxer-dev/blanxer-storefront-starter my-store
cd my-store
cp .env.example .env          # set BLANXER_STORE=<your store subdomain>
npm install
npm run dev                   # http://localhost:3000 with your real products
```

| Script | Runs |
|---|---|
| `npm run dev` | `next dev` |
| `npm run build` | `next build` |
| `npm run check` | `blanxer-storefront check`: routes, secrets, login code, browser-only order calls, image budget (add `-- --lighthouse http://localhost:3000` with `next start` running) |
| `npm run images -- ./incoming ./public/images --max-width 2560` | optimise images (AVIF + WebP, metadata stripped) before they go into `public/` |
| `npm run preview` | `opennextjs-cloudflare build && opennextjs-cloudflare preview` (the site in the Workers runtime, locally) |
| `npm run deploy` | `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (after `npx wrangler login`) |

## Environment (`.env`)

| Variable | |
|---|---|
| `BLANXER_STORE` | required: the store subdomain (`mystore` in `mystore.blanxer.io`) |
| `BLANXER_API` | optional: default `https://api.blanxer.com` |
| `SITE_URL` | optional: the public URL, for canonical links; otherwise the website link saved in Blanxer |
| `NEXT_PUBLIC_BLANXER_IMAGE_LOADER` | optional: `wsrv` (default) / `cloudflare` / `none` |

OpenNext copies `.env` into the Worker, so the deployed site reads the same values. The site needs **no secret**: never add an `sk_` key, MCP token, password or payment gateway key.

## Routes

| Route | File | Notes |
|---|---|---|
| `/` | `src/app/page.tsx` | hero, categories, new arrivals, sale |
| `/products` | `src/app/products/page.tsx` | paged, sortable |
| `/product/[slug]` | `src/app/product/[slug]/page.tsx` | gallery + `<AddToCart>` (variants, custom fields, flash sale, back-in-stock), JSON-LD |
| `/collections/[slug]` | `src/app/collections/[slug]/page.tsx` | includes `new-arrivals` |
| `/brand/[slug]`, `/brands` | `src/app/brand/…`, `src/app/brands/…` | |
| `/search?q=`, `/sale` | `src/app/search/…`, `src/app/sale/…` | |
| `/cart` | `src/app/cart/page.tsx` | `<CartView>` |
| **`/checkout`** | `src/app/checkout/page.tsx` | `<Checkout>`: required, keep it |
| **`/payment/success`**, **`/payment/failed`** | `src/app/payment/…` | required: gateways return here |
| **`/track/[id]`** | `src/app/track/[id]/page.tsx` | required: order SMS/emails link here; cancel + review |
| `/forms/[slug]` | `src/app/forms/[slug]/page.tsx` | Blanxer forms |
| `/blogs`, `/blog/[slug]` | `src/app/blogs/…`, `src/app/blog/…` | |
| `/sitemap.xml`, `/sitemap-catalog.xml`, `/robots.txt` | route handlers | the catalog sitemap is built by Blanxer; don't build your own |

There is no `/account`, `/login` or `/p/[slug]`: custom sites use guest checkout.

## Restyling

- Colours and font come from the store (`customization.theme`, `customization.font`): `--brand` in `src/app/layout.tsx`, fonts in `src/lib/fonts.ts`. Change `src/app/globals.css` and the components in `src/components/` freely.
- The checkout and other package components are themed, not rewritten: `--bx-*` CSS variables, `bx-*` classes, the `theme` prop of `<BlanxerProvider>`, and `labels`/`header`/`footer` on `<Checkout>`. The "Checkout Powered by Blanxer" line stays (restyle `.bx-powered-by`).
- Images: `next/image` everywhere (the loader in `src/lib/image-loader.ts` resizes Blanxer product photos). Optimise your own images with `npm run images` first; `preload` only the first big image of a page.

## Caching on Cloudflare

Pages read Blanxer at most once a minute (`revalidate = 60`). `open-next.config.ts` ships without an incremental-cache binding so a first deploy needs no extra Cloudflare resources; `@blanxer-dev/storefront` keeps API responses for 60 s inside each Worker isolate. For full ISR, add an R2 bucket as described in `open-next.config.ts` and `wrangler.jsonc`.

## Deploy

```bash
npx wrangler login            # sign in to your own Cloudflare account
npm run deploy                # prints https://<name>.<account>.workers.dev
```

Change `name` (and the matching `WORKER_SELF_REFERENCE` service) in `wrangler.jsonc` first. Then save the live link in Blanxer (avatar menu → BlanxerAPI → Your website), so order SMS/emails, the product feed and the sitemap use it.

## License

MIT
