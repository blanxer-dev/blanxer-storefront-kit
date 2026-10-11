# @blanxer/storefront

Store data, the full Blanxer checkout, SEO helpers and site checks for custom Next.js websites of Blanxer stores (BlanxerAPI). Blanxer stays the admin: products, stock, orders, payments, delivery and SEO text live in Blanxer and are read through the public API (`https://api.blanxer.com`, no key).

Start from the starter instead of wiring this by hand: [`blanxer-dev/blanxer-storefront-starter`](https://github.com/blanxer-dev/blanxer-storefront-starter). Docs: https://developers.blanxer.com (agents: https://developers.blanxer.com/llms.txt).

```bash
npm install @blanxer/storefront
```

Requires Next.js ≥ 16 (App Router), React ≥ 19, Node ≥ 20.9. ESM with TypeScript types.

## Environment

| Variable | Required | |
|---|---|---|
| `BLANXER_STORE` | yes | the store subdomain (`mystore` in `mystore.blanxer.io`) or its custom domain; resolved with `GET /store/check_domain` |
| `BLANXER_API` | no | API base, default `https://api.blanxer.com` (sandbox `https://api-dev.blanxer.com`) |
| `SITE_URL` | no | the site's public origin for canonical links, `robots.txt` and the sitemap index. Default: the website link saved in Blanxer (`storefront_url`) |
| `NEXT_PUBLIC_BLANXER_IMAGE_LOADER` | no | `wsrv` (default), `cloudflare` or `none` |

The site needs no secret. Never put an `sk_` key, MCP token, password or gateway key in the code, `.env` or the build.

## Hard rules the package enforces or assumes

- **Orders, coupons, payment starts and checks, hold release, back-in-stock, forms, cancel and review run in the browser** (`/client`, `/react`). `/client` imports `client-only`, so importing it from a Server Component, route handler or server action fails the build.
- **Server reads** (`/server`) use `fetch(..., { next: { revalidate: 60 } })` with a normal browser `User-Agent`.
- **The checkout is not rewritten by sites.** Restyle it (classes, CSS variables, `labels`, slots); the behaviour is fixed.
- **No customer login.** Nothing in the package calls `/customer/auth`, accounts, wishlist or rewards.

## Subpaths

### `@blanxer/storefront/server` (Server Components, `generateMetadata`, route handlers)

| Export | Returns |
|---|---|
| `getStore(opts?)` | full store config from `check_domain` (server only: contains plugin data) |
| `getClientStore(opts?)` / `toClientStore(store)` | the browser-safe subset for `<BlanxerProvider store>` (drops gateway keys and third-party plugin tokens) |
| `getStoreId()` | store `_id` (memoised) |
| `getProducts(opts?)` | every active product (unpaginated; prefer `getProductsPage`) |
| `getProductsPage({ page, perPage ≤ 100, sortBy, sortOrder }, opts?)` | `{ meta, products }` |
| `getProduct(slug)` | product or `null` (missing, inactive or POS-only) |
| `getCategory(slug)` | `{ category, storeCategory, products }` or `null`; `new-arrivals` is virtual |
| `getBrands()` / `getBrand(slug)` | brands / `{ brand, page, products }` or `null` |
| `searchProducts(q)` | products (≥ 3 characters, else `[]`) |
| `getSaleProducts()` | products on sale |
| `getDeliveryCharges()` | `{ defaults, places }` |
| `getFlashSales(opts?)` | `{ server_time, sales }` (not cached by default) |
| `getBlogPosts({ cursor, category, tag, author, q })` / `getBlogPost(slug)` | `{ items, next_cursor, has_more, all_categories }` / post or `null` |
| `getForm(slug)` | form or `null` |
| `getHomeSeo()` | `{ seo_title, seo_description, seo_image }` from the Blanxer landing page |
| `siteOrigin({ fromRequest? })` | `SITE_URL` → `storefront_url` → request host. `{ fromRequest: false }` returns `''` instead of reading the request (keeps pages static) |
| `apiBase()`, `storeHandle()`, `blanxerGet(path, opts?)` | low-level helpers |

`opts` is `{ revalidate?: number | false }` (default 60). Responses are also kept per server process / Worker isolate for the same 60 s, so a Cloudflare Worker without an incremental-cache binding still reads the catalog about once a minute, not once per page view.

### `@blanxer/storefront/client` (browser only)

`placeOrder(storeId, payload)`, `applyCoupon({ store, code, products })`, `startPayment(method, { store, order, url? })` → `PaymentStart` (`none` / `redirect` / `form` / `qr` / `fonepay_checkout`), `followPayment(start)` (navigates or auto-posts the eSewa/NPX form), `checkPayment('qr' | 'fonepay_checkout', transaction)` → `boolean`, `releaseHold({ store_id, order_id, transaction_id })`, `getOrder(storeId, orderId)`, `cancelOrder({ store_id, order_id, phone_number })`, `submitReview({ store_id, product_id, order_id, rating, review, phone_number })`, `requestStockAlert({ store, product, variant_id?, phone?, email?, product_name?, product_url? })`, `submitForm(storeId, slug, data)`, `trackEvent(event, customData?, { eventId?, email?, phone? })` (Meta pixel + Blanxer CAPI relay with one event id), plus `getDeliveryCharges`, `getFlashSaleForProduct`, `notifyFlashSale`, `uploadCustomFieldImage`, `pingAnalytics`, `pixelTrack`, `getEventId`, `buildOrderMeta`, `initMetaCapi`, `configureClient`, `BlanxerApiError`, `errorMessage`, `fieldError`.

`url` on orders and payments is always the site's own origin (`window.location.origin`); gateways return through the API to `<url>/payment/success` or `<url>/payment/failed`.

### `@blanxer/storefront/react` (client components; unstyled behaviour + optional default CSS)

| Component / hook | Props |
|---|---|
| `<BlanxerProvider>` | `store` (from `getClientStore()`/`toClientStore()`), `apiBase?`, `theme?: BlanxerTheme`, `notify?: (n: Notice) => void`, `children`. Includes the cart, `?promo=` capture, the session ping, Meta CAPI switch, CSS variables and toasts |
| `useBlanxer()` / `useStore()` | `{ store, storeId, apiBase, notify }` / store |
| `CartProvider`, `useCart()` | cart in localStorage `cart_items` (+ selection in `cart_selection`): `items`, `selectedItems`, `count`, `totalPrice`, `addToCart`, `removeFromCart`, `removeLine`, `setQuantity`, `toggleSelection`, `selectAll`, `deselectAll`, `removeSelectedFromCart`, `resetCart`, `hydrated`, `open`/`setOpen` |
| `<CartLines>` | `selectable?`, `editable?`, `productHref?`, `className?`, `empty?` |
| `<CartView>` | `checkoutHref?`, `continueHref?`, `className?` |
| `<AddToCart>` | `product`, `selection?`, `showPrice?`, `showVariants?`, `showCustomFields?`, `showQuantity?`, `showFlashSale?`, `showStockAlert?`, `checkoutHref?`, `labels?: { add, checkout, outOfStock, comingSoon, added }`, `onAdded?`, `className?`, `children?` |
| `useProductSelection(product)`, `<VariantPicker selection>`, `<CustomFields selection>`, `<QuantityPicker selection>` | build your own product form from the same state (`ProductSelection`) |
| `<FlashSaleStrip>` | `productId`, `productName?`, `onRules?`, `className?` |
| `<Checkout>` | `delivery?` (from `getDeliveryCharges()`; fetched in the browser if omitted), `labels?: Partial<CheckoutLabels>`, `className?`, `header?`, `footer?`, `paymentMethodIcons?: Partial<Record<PaymentMethodName, ReactNode>>`, `onOrderPlaced?(order, method)` |
| `<PaymentSuccess>` | `className?`, `children?` |
| `<PaymentFailed>` | `method?` (`?method=`), `homeHref?`, `className?` |
| `<OrderTracking>` | `orderId`, `fromCheckout?`, `className?` |
| `<BlanxerForm>` | `form` (from `getForm()`), `className?`, `onSubmitted?` |
| `<StockAlertForm>` (alias `BackInStockForm`) | `product`, `variantId?`, `className?` |
| `<Pixel>` | `store?`; loads Meta Pixel, GA4, GTM and Clarity from the store's plugins |
| `<Money amount>`, `useMoney()`, `<BlanxerImage>` | store currency label; `next/image` with the Blanxer loader |
| `QrPaymentModal`, `FonepayCheckoutModal`, `PaymentCloseConfirm`, `usePaymentHold`, `formatTimeLeft`, `qrSeconds` | the in-page payment screens `Checkout` uses |

Styling: import `@blanxer/storefront/styles.css` once (optional), then override `--bx-*` variables (`--bx-primary`, `--bx-bg`, `--bx-fg`, `--bx-muted`, `--bx-border`, `--bx-surface`, `--bx-danger`, `--bx-success`, `--bx-radius`, `--bx-font`) or the `bx-*` classes. `BlanxerProvider` sets `--bx-primary` from the store's theme colour; its `theme` prop wins over that.

#### "Checkout Powered by Blanxer"

`Checkout` always renders, under the Place Order button:

```html
<p class="bx-powered-by">Checkout Powered by <a href="https://blanxer.com" target="_blank" rel="noopener noreferrer">Blanxer</a></p>
```

There is no prop to remove it. Restyle it through `.bx-powered-by`; don't hide it.

#### What `Checkout` does (ported from the Blanxer storefront checkout, `main` cabd695)

- Fields and validation: full name, 10-digit phone, optional alternate phone (10 digits if typed), email (required and validated when `checkout.extras.email_required`), order note, City/District (the store's delivery places), address, landmark. Sender name/phone/email when `checkout.receiver_info` (sender email required when `checkout.extras.sender_email_required`), company name + PAN when `checkout.pan`, delivery date (from today) when `checkout.estimated_delivery`. Server field errors are shown on their fields.
- Delivery charge by total cart weight: brackets ≤1, ≤2, ≤3, ≤5, ≤10, >10 kg; a place value of `-1` uses the store default. Recomputed on every change (the storefront's stale weight memo is fixed).
- Payment methods: COD only for places whose flag is `true` or `'Y'`; online methods only on `basic`/`premium`/`plus`/`platinum` plans, each when the store has it on (`QR_Dynamic`, `FonepayCheckout`, `QR`, `Esewa`, `FonePay`, `Khalti`, `NPX`, `nbank_card`). Card is never offered.
- Coupons: apply by code (also `?promo=` anywhere on the site), client rules for minimum order, COD-only/online-only and places, discount for flat/percent/shipping types; the order carries the coupon's `_id`, never the code.
- Custom fields on cart lines (`label|||type|||value`, image upload through `POST /product/:store/:product/file`, `customization_charge`), print lines, cart selection (only ticked lines are ordered).
- Order body exactly as the storefront sends it, `url = window.location.origin`, with the Meta `meta` block; `sessionStorage.checkout_order_id` + the pending Purchase event for `/payment/success`.
- eSewa and NPX: auto-posted form. Khalti, Fonepay and Nabil card: redirect. Blanxer QR and Fonepay QR: QR modal with a countdown from `hold_seconds` (minus 20 s), auto-check every 5 s and on return to the tab. Checkout by Fonepay: bank list on mobile, QR on desktop, Fonepay websocket + check every 10 s. Closing a live QR asks first and then releases the hold; expiry releases it too.
- The cart is cleared when the storefront clears it: right after the order for COD and redirect gateways, and only after the payment is confirmed for the in-page QR methods.

## `@blanxer/storefront/seo`

`storeMetadata(store, { origin?, homeSeo? })`, `productMetadata(product, store, { origin? })`, `categoryMetadata(store, category, { origin? })`, `brandMetadata(store, brand, page?, { origin? })`, `blogPostMetadata(post, store, { origin? })`, `noIndexMetadata(title)`, `verificationMetadata(store)` (Search Console and other `meta_tags` plugin tags), `productJsonLd`, `organizationJsonLd`, `breadcrumbJsonLd`, `jsonLd(data)` (safe serialiser). They read the SEO fields merchants edit in Blanxer (`seo_title`, `seo_description`, `seo_image`). Canonical URLs are only emitted when the origin is known.

## `@blanxer/storefront/next`

```ts
// app/sitemap.xml/route.ts          export const GET = sitemapIndexRoute();      // + { extra: ['/sitemap-pages.xml'] }
// app/sitemap-catalog.xml/route.ts  export const GET = catalogSitemapRoute();    // proxies ${BLANXER_API}/public/sitemap/<store_id>.xml
// app/robots.txt/route.ts           export const GET = robotsRoute();
```

`blanxerImageLoader` / `createImageLoader(provider)`: `next/image` loader. Remote images go through `https://wsrv.nl/?url=…&w=…&q=…&output=webp` (or `/cdn-cgi/image/…` with `cloudflare`); local files and SVGs are returned as they are. For a global loader: `images: { loader: 'custom', loaderFile: './src/lib/image-loader.ts' }` with `export { default } from '@blanxer/storefront/image-loader'`.

## Extra subpaths

- `@blanxer/storefront/core`: the pure logic (delivery, COD rule, coupons, payment method list, order payload, custom fields, validation, variants, formatting, store helpers, types). Safe on server and client.
- `@blanxer/storefront/image-loader`: the default loader as a default export (for `loaderFile`).
- `@blanxer/storefront/styles.css`: default styles.

## CLI

```bash
npx blanxer-storefront check [dir] [--lighthouse <url>[,<url>…]] [--offline] [--no-worker-size] [--json]
npx blanxer-storefront images <in> <out> [--max-width 2560] [--quality 75] [--formats avif,webp]
```

`check` prints a PASS/FAIL table and exits 1 on any failure: Next.js + the package present; all contract routes (`/`, `/products`, `/product/[slug]`, `/collections/[slug]`, `/brand/[slug]`, `/brands`, `/search`, `/sale`, `/cart`, `/checkout`, `/payment/success`, `/payment/failed`, `/track/[id]`, `/forms/[slug]`, `/blogs`, `/blog/[slug]`, `/sitemap.xml`, `/sitemap-catalog.xml`, `/robots.txt`); `/checkout` renders the package `<Checkout>`; no account/login/wishlist/rewards/`/p/` pages; no secrets (`sk_` keys, gateway keys, plugin tokens, passwords, JWTs) in source, env files, `wrangler` config or `.next`/`.open-next` output; no `/customer/auth|account|wishlist|rewards`; `@blanxer/storefront/client` not imported by server files; no direct payment/coupon/hold API calls; image budget in `public/` (no file over 300 KB or wider than 2560 px, no JPEG/PNG where AVIF/WebP fits); no raw `<img>`; every `<Image>` sized (`width`+`height` or `fill`), with a warning when no image is marked as the LCP image; the store resolves and its delivery places and payment methods are listed; Worker size after an OpenNext build. `--lighthouse http://localhost:3000` audits home, one product page and `/checkout` (mobile, needs ≥ 90 and LCP < 2.5 s; runs `npx lighthouse`, needs Chrome).

`images` resizes (never enlarges) to `--max-width`, strips EXIF/GPS, writes AVIF (quality − 20) and WebP (quality) copies, copies SVGs, and prints a before/after table. Needs `sharp` (an optional dependency of this package).

## Deviations from the storefront and the contract

- Test contacts (phone `0000000000` or a `mailinator.net` email) make the API answer `{ success: true }` without an order. The storefront then navigates to `/track/undefined`; `Checkout` shows a "test order accepted" notice instead and keeps the cart.
- Not ported on purpose: the customer login gate, loyalty tier discount and points preview (custom sites have no login), a store-specific notice, and Card (cybersource), which the contract keeps off.
- The newer backend delivery-date rules (`checkout.extras.delivery_date_required`, blocked dates/weekdays, lead hours) are not on storefront `main` either, so `Checkout` only offers the optional date from today, like the storefront.
- Payment methods are shown by name; logos are opt-in through `paymentMethodIcons`.
- Extra exports beyond the contract: `/core`, `/image-loader`, `/styles.css`; `getClientStore`, `toClientStore`, `getHomeSeo`, `apiBase`, `storeHandle`, `blanxerGet` and the `{ fromRequest }` option of `siteOrigin` on `/server`; `blogPostMetadata`, `noIndexMetadata`, `jsonLd` on `/seo`; `sitemapIndexRoute`, `createImageLoader` on `/next`; `followPayment` and helpers on `/client`. `startPayment` returns a description of the next step (redirect URL, form fields or QR data) and `followPayment` performs it.

## License

MIT
