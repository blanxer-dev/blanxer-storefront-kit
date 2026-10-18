# Changelog

## 0.2.0

### Offers

Support for stores on Blanxer's Offers plugin (automatic discounts, codes, buy more save more, buy X get Y, bundles, free gifts, free delivery). The server prices everything; the package shows its cart quote and never computes a discount.

- `/client`: `getOffers`, `getProductOffers`, `quoteCart`, `getProductPublic`.
- `/server`: `getOffers` (cached 30 s).
- `/core`: offer, quote and display-settings types; `buildQuoteRequest` (never sends server-added lines), `offerOrderFields`, `codeFieldError`, `createLatest` (stale-response guard) and display helpers (progress from upsell messages, summary rows, badges, tier rows). `buildOrderPayload` takes `offers: { code, removedOffers, giftChoices }`. `toClientStore` passes the `offers` plugin's public `{ enabled, display }`.
- `/react`: `OffersProvider` (inside `BlanxerProvider`), `useOffers`, `useCartQuote` (debounced, cancels stale requests), `useProductOffers`, and `OfferBadges`, `OfferCardHint`, `ProductOffers` (tier table, notes, bundle block), `OfferProgress`, `OfferMessages`, `OfferCodeField`, `OfferSummary`, `OffersList`, `OfferTopBar`, `OffersLink`. `CartView`, `CartLines` and `Checkout` switch to the quote automatically for stores on Offers (gift lines with "Free", one code per order, the code's order-time error on its field).
- Stores not on Offers keep the coupon flow unchanged.
- Styles: `bx-offer-*` classes; the checkout grid no longer overflows narrow screens.

## 0.1.3

- Remove the tracking consent banner.

Earlier versions: see the git history.
