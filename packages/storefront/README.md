# @blanxer-dev/storefront

Store data, the full Blanxer checkout, SEO helpers and site checks for custom Next.js websites of Blanxer stores (BlanxerAPI). Blanxer stays the admin: products, stock, orders, payments, delivery and SEO text live in Blanxer and are read through the public API (`https://api.blanxer.com`, no key).

Start from the starter instead of wiring this by hand: [`blanxer-dev/blanxer-storefront-starter`](https://github.com/blanxer-dev/blanxer-storefront-starter). Docs: https://developers.blanxer.com (agents: https://developers.blanxer.com/llms.txt).

```bash
npm install @blanxer-dev/storefront
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
- **Offers are priced by the server.** For stores on Offers, every total, line saving, gift line, free delivery and code result comes from the cart quote. Nothing in the package (or a site) computes a discount itself. See [Offers](#offers).
- **The advance is worked out by the server.** "Pay part online, rest on delivery" amounts come from the quote and the order; nothing computes an advance. See [Advance payment and retry](#advance-payment-and-retry).

## Subpaths

### `@blanxer-dev/storefront/server` (Server Components, `generateMetadata`, route handlers)

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
| `getOffers(opts?)` | `{ enabled, data: PublicOffer[], settings, server_time }` (cached 30 s; `enabled: false` when the store isn't on Offers) |
| `getBlogPosts({ cursor, category, tag, author, q })` / `getBlogPost(slug)` | `{ items, next_cursor, has_more, all_categories }` / post or `null` |
| `getForm(slug)` | form or `null` |
| `getHomeSeo()` | `{ seo_title, seo_description, seo_image }` from the Blanxer landing page |
| `siteOrigin({ fromRequest? })` | `SITE_URL` → `storefront_url` → request host. `{ fromRequest: false }` returns `''` instead of reading the request (keeps pages static) |
| `apiBase()`, `storeHandle()`, `blanxerGet(path, opts?)` | low-level helpers |

`opts` is `{ revalidate?: number | false }` (default 60). Responses are also kept per server process / Worker isolate for the same 60 s, so a Cloudflare Worker without an incremental-cache binding still reads the catalog about once a minute, not once per page view.

### `@blanxer-dev/storefront/client` (browser only)

`placeOrder(storeId, payload)`, `applyCoupon({ store, code, products })`, `getOffers(storeId)`, `getProductOffers(storeId, productId)`, `quoteCart(storeId, body)` → `Quote | null`, `quoteAdvance(storeId, body)` → `Advance | null`, `readPendingOrder` / `savePendingOrder` / `clearPendingOrder`, `getProductPublic(storeId, idOrSlug)`, `startPayment(method, { store, order, url? })` → `PaymentStart` (`none` / `redirect` / `form` / `qr` / `fonepay_checkout`), `followPayment(start)` (navigates or auto-posts the eSewa/NPX form), `checkPayment('qr' | 'fonepay_checkout', transaction)` → `boolean`, `releaseHold({ store_id, order_id, transaction_id })`, `getOrder(storeId, orderId)`, `cancelOrder({ store_id, order_id, phone_number })`, `submitReview({ store_id, product_id, order_id, rating, review, phone_number })`, `requestStockAlert({ store, product, variant_id?, phone?, email?, product_name?, product_url? })`, `submitForm(storeId, slug, data)`, `trackEvent(event, customData?, { eventId?, email?, phone? })` (Meta pixel + GTM dataLayer + Blanxer CAPI relay with one event id; Purchase is never relayed), `firePurchase(order.meta)` (browser Purchase with the id and value the backend returned; the backend sends its own server Purchase), `pushMetaEvent` / `dlPush` (GTM dataLayer), `rememberCheckoutUser`, `localOrderMeta`, `savePendingPurchase` / `takePendingPurchase`, plus `getDeliveryCharges`, `getFlashSaleForProduct`, `notifyFlashSale`, `uploadCustomFieldImage`, `pingAnalytics`, `pixelTrack`, `getEventId`, `buildOrderMeta`, `initMetaCapi`, `configureClient`, `BlanxerApiError`, `errorMessage`, `fieldError`.

`url` on orders and payments is always the site's own origin (`window.location.origin`); gateways return through the API to `<url>/payment/success` or `<url>/payment/failed`.

### `@blanxer-dev/storefront/react` (client components; unstyled behaviour + optional default CSS)

| Component / hook | Props |
|---|---|
| `<BlanxerProvider>` | `store` (from `getClientStore()`/`toClientStore()`), `apiBase?`, `theme?: BlanxerTheme`, `notify?: (n: Notice) => void`, `children`. Includes the cart, offers (`OffersProvider`), `?promo=` capture, the session ping, Meta CAPI switch, CSS variables and toasts |
| `useBlanxer()` / `useStore()` | `{ store, storeId, apiBase, notify }` / store |
| `CartProvider`, `useCart()` | cart in localStorage `cart_items` (+ selection in `cart_selection`): `items`, `selectedItems`, `count`, `totalPrice`, `addToCart`, `removeFromCart`, `removeLine`, `setQuantity`, `toggleSelection`, `selectAll`, `deselectAll`, `removeSelectedFromCart`, `resetCart`, `hydrated`, `open`/`setOpen` |
| `<CartLines>` | `selectable?`, `editable?`, `productHref?`, `className?`, `empty?`, `quote?` (stores on Offers: line offers and server-added gift lines) |
| `<CartView>` | `checkoutHref?`, `continueHref?`, `className?` |
| `<AddToCart>` | `product`, `selection?`, `showPrice?`, `showVariants?`, `showCustomFields?`, `showQuantity?`, `showFlashSale?`, `showStockAlert?`, `checkoutHref?`, `labels?: { add, checkout, outOfStock, comingSoon, added }`, `onAdded?`, `className?`, `children?` |
| `useProductSelection(product)`, `<VariantPicker selection>`, `<CustomFields selection>`, `<QuantityPicker selection>` | build your own product form from the same state (`ProductSelection`) |
| `<FlashSaleStrip>` | `productId`, `productName?`, `onRules?`, `className?` |
| `<Checkout>` | `delivery?` (from `getDeliveryCharges()`; fetched in the browser if omitted), `labels?: Partial<CheckoutLabels>`, `className?`, `header?`, `footer?`, `paymentMethodIcons?: Partial<Record<PaymentMethodName, ReactNode>>`, `onOrderPlaced?(order, method)` |
| `<PaymentSuccess>` | `className?`, `children?` |
| `<PaymentFailed>` | `method?` (`?method=`), `homeHref?`, `trackHref?: (orderId) => string` (default `/track/<id>`), `className?` |
| `<OrderTracking>` | `orderId`, `fromCheckout?`, `className?` |
| `<BlanxerForm>` | `form` (from `getForm()`), `className?`, `onSubmitted?` |
| `<StockAlertForm>` (alias `BackInStockForm`) | `product`, `variantId?`, `className?` |
| `<Pixel>` | `store?`. Loads the Meta Pixel (digits-only id, once; skipped if GTM already set up the same pixel), GA4, GTM and Clarity from the store's plugins. Pushes `bx_page_view` to GTM on every route change. |
| `<Money amount>`, `useMoney()`, `<BlanxerImage>` | store currency label; `next/image` with the Blanxer loader |
| `QrPaymentModal`, `FonepayCheckoutModal`, `PaymentCloseConfirm`, `usePaymentHold`, `formatTimeLeft`, `qrSeconds` | the in-page payment screens `Checkout` uses (`onUnpaid?(reason)`: closed, expired or "Try again") |
| `usePayOrder(opts?)`, `<PaymentDueBox>`, `<AdvanceSummaryRows>`, `useAdvanceQuote(opts)` | paying an existing order again, the "Advance due" box, the Pay now / Pay on delivery rows, the advance for stores not on Offers (see [Advance payment and retry](#advance-payment-and-retry)) |

Styling: import `@blanxer-dev/storefront/styles.css` once (optional), then override `--bx-*` variables (`--bx-primary`, `--bx-bg`, `--bx-fg`, `--bx-muted`, `--bx-border`, `--bx-surface`, `--bx-danger`, `--bx-success`, `--bx-radius`, `--bx-font`) or the `bx-*` classes. `BlanxerProvider` sets `--bx-primary` from the store's theme colour; its `theme` prop wins over that.

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
- Coupons (stores not on Offers): apply by code (also `?promo=` anywhere on the site), client rules for minimum order, COD-only/online-only and places, discount for flat/percent/shipping types; the order carries the coupon's `_id`, never the code.
- Offers (stores on Offers): the summary, code field, delivery line and Place Order amount come from the server's quote; the order carries `code`, `removed_offers` and `gift_choices` (see [Offers](#offers)).
- Custom fields on cart lines (`label|||type|||value`, image upload through `POST /product/:store/:product/file`, `customization_charge`), print lines, cart selection (only ticked lines are ordered).
- Order body exactly as the storefront sends it, `url = window.location.origin`, with the Meta `meta` block (`fbp`, `fbc`, `fbclid`); `sessionStorage.checkout_order_id` + the pending Purchase (the backend's `order.meta`) for `/payment/success`.
- **Meta Purchase is owned by the backend.**
  - **COD:** it sends Purchase when the order is created.
  - **Online payments:** it sends Purchase when the payment is verified.
  - **The browser:** the pixel fires once with the same `purchase_event_id`, so Meta keeps one.
  - **Every event is also pushed to GTM's `dataLayer`** in GA4 ecommerce shape (`view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase`, …) with `meta_event_id`. Agencies can add page-level tags in GTM without code.
- eSewa and NPX: auto-posted form. Khalti, Fonepay and Nabil card: redirect. Blanxer QR and Fonepay QR: QR modal with a countdown from `hold_seconds` (minus 20 s), auto-check every 5 s and on return to the tab. Checkout by Fonepay: bank list on mobile, QR on desktop, Fonepay websocket + check every 10 s. Closing a live QR asks first and then releases the hold; expiry releases it too.
- The cart is cleared right after the order for plain COD, and for every online or advance order only once the payment is confirmed (`/payment/success` or the QR's confirmation). An order whose payment didn't finish is paid again on the same order, never placed twice (see [Advance payment and retry](#advance-payment-and-retry)).

## `@blanxer-dev/storefront/seo`

`storeMetadata(store, { origin?, homeSeo? })`, `productMetadata(product, store, { origin? })`, `categoryMetadata(store, category, { origin? })`, `brandMetadata(store, brand, page?, { origin? })`, `blogPostMetadata(post, store, { origin? })`, `noIndexMetadata(title)`, `verificationMetadata(store)` (Search Console and other `meta_tags` plugin tags), `productJsonLd`, `organizationJsonLd`, `breadcrumbJsonLd`, `jsonLd(data)` (safe serialiser). They read the SEO fields merchants edit in Blanxer (`seo_title`, `seo_description`, `seo_image`). Canonical URLs are only emitted when the origin is known.

## `@blanxer-dev/storefront/next`

```ts
// app/sitemap.xml/route.ts          export const GET = sitemapIndexRoute();      // + { extra: ['/sitemap-pages.xml'] }
// app/sitemap-catalog.xml/route.ts  export const GET = catalogSitemapRoute();    // proxies ${BLANXER_API}/public/sitemap/<store_id>.xml
// app/robots.txt/route.ts           export const GET = robotsRoute();
```

`blanxerImageLoader` / `createImageLoader(provider)`: `next/image` loader. Remote images go through `https://wsrv.nl/?url=…&w=…&q=…&output=webp` (or `/cdn-cgi/image/…` with `cloudflare`); local files and SVGs are returned as they are. For a global loader: `images: { loader: 'custom', loaderFile: './src/lib/image-loader.ts' }` with `export { default } from '@blanxer-dev/storefront/image-loader'`.

## Extra subpaths

- `@blanxer-dev/storefront/core`: the pure logic (delivery, COD rule, coupons, payment method list, order payload, custom fields, validation, variants, formatting, store helpers, types). Safe on server and client.
- `@blanxer-dev/storefront/image-loader`: the default loader as a default export (for `loaderFile`).
- `@blanxer-dev/storefront/styles.css`: default styles.

## CLI

```bash
npx blanxer-storefront check [dir] [--lighthouse <url>[,<url>…]] [--offline] [--no-worker-size] [--json]
npx blanxer-storefront images <in> <out> [--max-width 2560] [--quality 75] [--formats avif,webp]
```

`check` prints a PASS/FAIL table and exits 1 on any failure: Next.js + the package present; all contract routes (`/`, `/products`, `/product/[slug]`, `/collections/[slug]`, `/brand/[slug]`, `/brands`, `/search`, `/sale`, `/cart`, `/checkout`, `/payment/success`, `/payment/failed`, `/track/[id]`, `/forms/[slug]`, `/blogs`, `/blog/[slug]`, `/sitemap.xml`, `/sitemap-catalog.xml`, `/robots.txt`); `/checkout` renders the package `<Checkout>`; no account/login/wishlist/rewards/`/p/` pages; no secrets (`sk_` keys, gateway keys, plugin tokens, passwords, JWTs) in source, env files, `wrangler` config or `.next`/`.open-next` output; no `/customer/auth|account|wishlist|rewards`; `@blanxer-dev/storefront/client` not imported by server files; no direct payment/coupon/hold API calls; image budget in `public/` (no file over 300 KB or wider than 2560 px, no JPEG/PNG where AVIF/WebP fits); no raw `<img>`; every `<Image>` sized (`width`+`height` or `fill`), with a warning when no image is marked as the LCP image; the store resolves and its delivery places and payment methods are listed; Worker size after an OpenNext build. `--lighthouse http://localhost:3000` audits home, one product page and `/checkout` (mobile, needs ≥ 90 and LCP < 2.5 s; runs `npx lighthouse`, needs Chrome).

`images` resizes (never enlarges) to `--max-width`, strips EXIF/GPS, writes AVIF (quality − 20) and WebP (quality) copies, copies SVGs, and prints a before/after table. Needs `sharp` (an optional dependency of this package).

## Offers

Stores with Blanxer's **Offers** plugin (automatic discounts, codes, buy more save more, buy X get Y, bundles, free gifts, free delivery) are priced by the server. The rule for every site: **show the quote, never compute a discount.**

**Is the store on Offers?** Only stores whose document carries the `offers` plugin are asked (`toClientStore` passes its public `{ enabled, display }`); for every other store the package makes no offers call and the checkout is the 0.1.3 coupon flow (`applyCoupon`, `couponId` on the order) from the first render. Stores with the plugin are asked `GET /public/promotions/:store_id` (`{ enabled, data, settings, server_time }`); `useOffers().enabled` is true only when that answer says so. A 404 (a backend without Offers), a network error or a non-JSON answer from `/public/promotions` or `/quote` means offers off: coupon flow, no error UI, one `console.debug` line per page load (the browser still logs its own line for a 404 response). `getOffers` / `getProductOffers` never throw; `quoteCart` resolves null in those cases and throws `QuoteUnavailableError` only for a rate limit or a 5xx (offers stay on; the order is priced by the server anyway). Until the answer arrives, `Checkout` shows neither the coupon field nor the code field.

**The quote.** `POST /public/promotions/:store_id/quote` with `buildQuoteRequest({ lines, code, place, paymentMethod, phone, removedOffers, giftChoices })`: product ids, variants, quantities and per-unit `customization_charge` only. Lines the server added (`added_by`: gifts, free items) are shown and never sent back. The answer has `lines` (per-line `allocations`, `net`, `free_qty`), `applications` (one per offer used), `code` (`applied` / `rejected` with the server's `message`), `delivery` (`before`, `discount`, `after`, `pending` until the place is known), `totals` (`gross`, `promo_discount`, `goods`, `delivery`, `total`) and `messages` (upsells with `data.remaining_amount` / `threshold` for progress bars). Newer backends also answer `payable` (`{ customization, member_discount, total }`): show `payable.total` (`quotePayable(quote)`) as the order total, customization included. Older backends: customization charges are not in the quote; add them to `totals` as the cart does. Rate-limited (300 / 10 min / IP): use `useCartQuote`, which debounces, re-quotes when the lines, code, place, payment or phone change, aborts the request it replaces and never shows a stale answer.

**The order.** `buildOrderPayload({ ..., offers: { code, removedOffers, giftChoices } })` sends `code`, `removed_offers` and `gift_choices` (and an empty `coupon`). The server prices the order again. A code it rejects comes back as a field error `{ fields: { code } }`; `codeFieldError(err)` reads it and `Checkout` shows it under the code field. The response carries `offers { applications, code, totals }`.

**Gift choice.** When a gift offer has several items (or an item with several options), `OfferGiftPicker` (in `CartView` and `Checkout`) lets the shopper pick one; the pick goes to the quote and the order as `gift_choices: { offerId: 'productId|variantId' }` and the server adds that gift.

**Tracking.** `OrderTracking` shows one row per offer on orders priced by Offers (tiers with their level, e.g. "· 15%", on orders that carry it), any discount on top as "Discount", free units ("Free" / "1 free") and a waived delivery charge struck through. Older orders keep the single discount row. Helpers: `orderOfferSummary(order)`, `orderLineFree(line)`.

**React.**

| Component / hook | What |
|---|---|
| `useOffers()` | `{ enabled, offers, display, code, setCode, removedOffers, removeOffer, restoreOffer, giftChoices, chooseGift, clearChoices, clockOffset, ready, refresh }`. The code is kept in localStorage `promo_code` (also set by `?promo=`) |
| `useCartQuote(opts?)` | `{ quote, request, fresh, loading, error, refresh }`; `opts`: `lines?` (default the selected cart lines), `place?`, `paymentMethod?`, `phone?`, `code?`, `debounceMs?`, `enabled?` |
| `useProductOffers(productId)` | the offers that touch one product |
| `<OfferBadges product>`, `<OfferCardHint product>` | card / gallery badges and the line under the price (`product`: `_id`, `price`, `categories`, variant ids) |
| `<ProductOffers product>` | tier table, delivery / gift / code notes with countdowns, "Bundle & save" (`<OfferTierTable>`, `<OfferNotes>`, `<BundleOffer>` on their own) |
| `<OfferGiftPicker quote>` | pick a gift when a gift offer has several |
| `<OfferProgress quote>`, `<OfferMessages quote>`, `<OfferSummary quote>`, `<OfferCodeField request quote>` (`useOfferCode` for your own field) | cart / checkout pieces; `CartView` and `Checkout` use them automatically |
| `<OffersList offers? offerHref?>`, `<OfferTopBar>`, `<OffersLink>`, `<OfferCodeChip code>` | the Offers page, the top bar and the nav link |

Each component respects the store's display settings (`badges`, `badge_style`, `badge_corner`, `saving_as`, `colors`, `pdp_tiers`, `pdp_notes`, `pdp_bundle`, `pdp_delivery`, `cart_progress`, `cart_upsell`, `cart_savings`, `code_field`, `top_bar`, `offers_page`, `countdowns`) and renders nothing when the store isn't on Offers. Restyle with the `bx-offer-*` classes; badge colours come in as `--bx-offer-tone`.

**Core helpers** (`/core`, no discount maths): `buildQuoteRequest`, `quoteKey`, `quotePayment`, `offerOrderFields`, `codeFieldError`, `createLatest` (newest-request-wins), `quoteSavings`, `summaryRows`, `quoteLineFor`, `lineOffers`, `addedLines`, `upsellMessages`, `upsellProgress`, `cartMilestones`, `milestoneBar`, `offersForProduct`, `productBadges`, `productHint`, `tierRows` (active tier from the quote), `offerHeadline`, `offerTagline`, `offerConditionsText`, `offersDisplay`, `offersPlugin`.

## Advance payment and retry

Stores can ask for part of a cash-on-delivery order online first: the delivery charge, a fixed amount, or a percent. The setting is `store.checkout.advance_payment` (from `check_domain`; display only). It can be required, or the shopper's choice with plain COD kept. **The server works out every amount**: the quote returns `advance: { amount, on_delivery, total, basis, required, full } | null`, create-order works it out again, and the gateway charges only the advance. Needs the backend from the advance-payment release; older backends send no `advance` and everything works as before.

**Checkout (automatic).**
- **The payment methods are unchanged.** The COD tile adds one line: "Rs 150 online now · rest on delivery" ("or …" when the advance is the shopper's choice).
- **The summary** adds "Pay now (advance)" and "Pay on delivery" (`aria-live`). The button reads "Pay Rs 150 & place order", with "Rs 2,350 cash on delivery" under it.
- **The advance modal.** Pressing that button (after the form checks) opens "Pay the Rs 150 advance with": the store's online methods as radios and "Pay Rs 150". The order is created only on confirm; Back places nothing. With shopper's choice the last option is "Pay all Rs 2,500 on delivery instead" (button "Place order", a plain COD order). A required advance with one online method goes straight to it (`advanceFlow`).
- **When COD is hidden:** where the advance is the whole order and required.
- **The order** goes as `paymentMethod: 'COD'` + `advance_via`. When the answer has `advance`, the order is paid online with that method like any online order. When it is `null`, it is plain COD.
- **Where the advance comes from:**
  - Stores on Offers: the cart quote (always the COD advance, whatever method is picked). Its `payable.total` (customization included) is the Total and the "Place Order · Rs X" amount; older backends: `totals.total` + customization.
  - Other stores with the setting on: `quoteAdvance` (`POST /public/promotions/:store/quote`, answered `{ enabled: false, data: { advance, totals } }`).
  - Any failure is plain COD.

**Paying again on the same order (every online order, not only advances).**
- **The waiting order.** After placing an online or advance order, the order waits in sessionStorage `checkout_pending_order` (`PendingOrder`: order id and number, cart line ids, cart signature, method, advance). The cart keeps those lines until the payment is confirmed.
- **"Payment not finished".** A QR closed unpaid or expired, or a return to `/checkout` with the same cart, shows this panel instead of Place order:
  - "Try again" (the last method, same order id) and "Pay another way" (the method modal, online methods only);
  - "Pay all in cash on delivery instead", only for a shopper's-choice advance: it releases the hold and places a new plain COD order;
  - "Change the order details instead": releases the hold and forgets the waiting order.
  The hold is released by the payment attempt when known, else by the order's phone (`releaseHold({ store_id, order_id, phone_number })`).
- **Refused retries.** The server refuses a retry with "already paid" (the checkout goes to the success page) or "was cancelled" (a new order can be placed).
- **`/payment/failed`** offers "Try payment again" (the order's tracking page) when this tab placed the order.
- **Amounts and the hold.** Every "Pay Rs X" is the server's `amount_to_pay`. The QR countdown follows the hold each init answers; once the hold has ended there is no countdown (the QR stays payable and never shows "expired").
- **`/track/<id>`** shows "Advance due — Pay Rs X" or "Payment not received — Pay Rs X" with the online methods. It pays this order in the page, or through the gateway's redirect. After an advance is paid, it shows "Paid online (advance) Rs X" and "To pay on delivery Rs Y" (the read's `cod_to_collect`).

**Building your own.** Use `usePayOrder()` to start (or restart) a payment for an order id with the QR modals; render its `modals`. Use `<PaymentDueBox due={paymentDue(order)} methods={paymentMethodsFor(store, { codAllowed: false })} onPay={...} />` (main "Pay Rs X" + "Pay another way"), `<AdvanceMethodModal>` and `<AdvanceSummaryRows advance={activeAdvance(...)} />`.

The pure rules are in `/core` (`advance.ts`, the same functions as the Blanxer storefront):
- `toAdvance`, `codOffer` (`plain` / `advance` / `hidden`), `pickAdvanceVia`, `activeAdvance`, `advanceFlow` (`plain` / `direct` / `choose`);
- `advanceOrderFields`, `advanceBlocks`, `advanceWords` (all shopper copy);
- `paymentDue`, `pendingDue`, `placedAmount`, `advanceSplit`, `advanceInitLine`, `retryRefused`, `quotePayable`, `holdSecondsOf`;
- `cartSignature`, `parsePending`, `pendingFor`;
- kit-only: `advancePaymentOn`, `advanceFromAnswer`, `orderAdvance`.

Never show an amount you worked out yourself.

## Deviations from the storefront and the contract

- Test contacts (phone `0000000000` or a `mailinator.net` email) make the API answer `{ success: true }` without an order. The storefront then navigates to `/track/undefined`; `Checkout` shows a "test order accepted" notice instead and keeps the cart.
- Not ported on purpose: the customer login gate, loyalty tier discount and points preview (custom sites have no login, so the quote never sends a member's `Authorization` header), a store-specific notice, and Card (cybersource), which the contract keeps off.
- The newer backend delivery-date rules (`checkout.extras.delivery_date_required`, blocked dates/weekdays, lead hours) are not on storefront `main` either, so `Checkout` only offers the optional date from today, like the storefront.
- Payment methods are shown by name; logos are opt-in through `paymentMethodIcons`.
- Extra exports beyond the contract: `/core`, `/image-loader`, `/styles.css`; `getClientStore`, `toClientStore`, `getHomeSeo`, `apiBase`, `storeHandle`, `blanxerGet` and the `{ fromRequest }` option of `siteOrigin` on `/server`; `blogPostMetadata`, `noIndexMetadata`, `jsonLd` on `/seo`; `sitemapIndexRoute`, `createImageLoader` on `/next`; `followPayment` and helpers on `/client`. `startPayment` returns a description of the next step (redirect URL, form fields or QR data) and `followPayment` performs it.

## License

MIT
