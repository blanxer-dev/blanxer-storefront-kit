# Changelog

## 0.3.0

### Advance payment ("pay part online, rest on delivery") and paying an order again

Needs the Blanxer backend from the advance-payment release. Older backends send no `advance` anywhere, and the checkout then works as in 0.2.0, except for the three changes marked **all stores** below. The server works out every amount; the package never computes an advance.

- **Checkout, stores with the advance on** (`store.checkout.advance_payment.enabled`, from `check_domain`; display only):
  - The Cash on delivery tile adds "Rs 150 now · rest on delivery".
  - In shopper's-choice mode the line reads "or Rs 150 now · rest on delivery".
  - Picking it shows "Pay the Rs 150 advance with" and the store's online methods as radios (`role="radiogroup"`). In shopper's-choice mode (`required: false`) the last radio is "No advance: pay Rs 2,500 on delivery", picked by default.
  - The summary adds "Pay now (advance)" and "Pay on delivery" under the Total (`aria-live="polite"`). The button reads "Pay Rs 150 & place order", with "Rs 2,350 cash on delivery" under it.
  - COD is hidden where the advance is the whole order and required.
  - Place order waits for the advance quote while COD is picked.
  - The order is sent with `advance_via`. When the answer has `advance`, the order is paid like an online order with that method; when it is `null`, it is plain COD.
- **Where the advance comes from:**
  - Stores on Offers: the cart quote's new `advance`, always the COD advance whatever method is picked (one quote). The quote now also sends `customization_charge` per line.
  - Other stores: `quoteAdvance` (same `/quote` endpoint, `payment: 'cod'`, the place, lines, legacy `coupon` id and phone; debounced; a stale request is aborted).
  - A 404, network error or non-JSON answer is plain COD.
- **Stores on Offers: the server's total.** When the quote carries `payable` (`{ customization, member_discount, total }`), the summary Total, "Place Order · Rs X" and the pixel value show `payable.total` and the package stops adding customization itself. Older backends: the 0.2.0 sum.
- **All stores: the cart is kept until the payment is confirmed** for every online and advance order (redirect gateways included). The order waits in sessionStorage `checkout_pending_order` (`PendingOrder`). Its lines leave the cart on `/payment/success` or when the in-page QR confirms.
- **All stores: retry on the same order.**
  - When a QR is closed unpaid or expires, or the shopper comes back to checkout with the same cart, a "Payment not finished" panel replaces Place order. It offers "Try again" or another online method, both on the same order id.
  - A shopper's-choice advance order can switch to "Pay all in cash on delivery instead": the hold is released and a new plain COD order is placed.
  - "Change the order details" releases the hold and forgets the waiting order, so the form can be edited and placed again.
  - The hold is released by the payment attempt when known, else by the order's 10-digit phone (`releaseHold({ store_id, order_id, phone_number })`, e.g. after a failed redirect).
  - "Pay Rs X" amounts come from the server's `amount_to_pay` (create-order, the order read).
  - A retry refused as "already paid" goes to the success page. One refused as "cancelled" lets the shopper place a new order.
  - No second order is placed while one waits for this cart.
- **All stores: payment tiles stay real radio inputs** (keyboard-accessible).
- **QR modals:** "Advance for order #1234 · Rs 2,350 on delivery" above the amount (QR inits that send `advance`). The countdown follows the hold the init answers (every attempt, retries included). With no hold left there is no countdown: the QR never shows "expired" and nothing is released on a timer. Older backends: create-order's `hold_seconds`, as before. The new `onUnpaid(reason)` prop fires when the QR is cancelled, expires or the shopper retries. With `onUnpaid`, the expired screen's main button is "Try again".
- **`PaymentFailed`:** when this tab placed the order, the main action is "Try payment again" (`/track/<id>`, prop `trackHref`), with "Shop More" second. In that case the pending Purchase is kept for the retry.
- **`OrderTracking`:**
  - An online payment or advance still due shows "Advance due — Pay Rs X" or "Payment not received — Pay Rs X", with the online methods as radios and a "Pay Rs X" button for this order. This box replaces the "order placed" banner.
  - The amount to pay is the order read's `amount_to_pay`.
  - A paid advance shows "Paid online (advance)" and "To pay on delivery" (the read's `cod_to_collect` when present, else the advance's `on_delivery`). The old partial-payment rows stay for staff-recorded partials.
  - The payment status `Partial` reads "Advance paid".
- **`/core`:**
  - `advance.ts`, ported from the storefront: `toAdvance`, `codOffer`, `pickAdvanceVia`, `activeAdvance`, `advanceOrderFields`, `advanceBlocks`, `advanceWords`, `paymentDue`, `pendingDue`, `placedAmount`, `advanceSplit`, `advanceInitLine`, `retryRefused`, `quotePayable`, `holdSecondsOf`, `cartSignature`, `PendingOrder` / `parsePending` / `pendingFor` / `PENDING_KEY`, `ONLINE_METHODS`.
  - Kit-only helpers: `advancePaymentOn`, `advanceFromAnswer`, `orderAdvance`.
  - `buildOrderPayload({ advance, advanceVia })`. `buildQuoteRequest({ coupon })` plus per-line `customization_charge`.
  - Types: `Quote.advance` / `payable`, `OrderResponse.advance` / `status` / `amount_to_pay`, `PublicOrder` (`amount_to_pay`, `cod_to_collect`, hold), `PublicOrder`, `PublicOrderAdvance`, `StoreCheckoutSettings.advance_payment`. `STORAGE_KEYS.pendingOrder`.
- **`/client`:** `quoteAdvance`, `readPendingOrder` / `savePendingOrder` / `clearPendingOrder`. `getOrder` is typed `PublicOrder`. `startPayment` may be called again for the same order. `releaseHold` takes `transaction_id` or `phone_number`.
- **`/react`:** `usePayOrder` (start or restart a payment with the QR modals), `PaymentDueBox`, `AdvanceSummaryRows`, `useAdvanceQuote`, `useOptionalCart`. The cart gains `removeLines(ids)`. `OfferSummary` takes `advance`.
- **Styles:** `bx-advance-*` classes, `bx-sr-only`, `bx-badge--partial`, `bx-result-actions`.
- Not in the kit: a logged-in member's `Authorization` header on the quote (custom sites have no customer login).

## 0.2.0

### Offers

Support for stores on Blanxer's Offers plugin (automatic discounts, codes, buy more save more, buy X get Y, bundles, free gifts, free delivery). The server prices everything; the package shows its cart quote and never computes a discount.

- `/client`: `getOffers`, `getProductOffers`, `quoteCart`, `getProductPublic`.
- `/server`: `getOffers` (cached 30 s).
- `/core`: offer, quote and display-settings types; `buildQuoteRequest` (never sends server-added lines), `offerOrderFields`, `codeFieldError`, `createLatest` (stale-response guard) and display helpers (progress from upsell messages, summary rows, badges, tier rows). `buildOrderPayload` takes `offers: { code, removedOffers, giftChoices }`. `toClientStore` passes the `offers` plugin's public `{ enabled, display }`.
- `/react`: `OffersProvider` (inside `BlanxerProvider`), `useOffers`, `useCartQuote` (debounced, cancels stale requests), `useProductOffers`, and `OfferBadges`, `OfferCardHint`, `ProductOffers` (tier table, notes, bundle block), `OfferProgress`, `OfferMessages`, `OfferCodeField`, `OfferSummary`, `OffersList`, `OfferTopBar`, `OffersLink`. `CartView`, `CartLines` and `Checkout` switch to the quote automatically for stores on Offers (gift lines with "Free", one code per order, the code's order-time error on its field).
- Stores not on Offers keep the coupon flow unchanged: without the `offers` plugin no offers call is made, and a 404, network error or non-JSON answer from `/public/promotions` or `/quote` is offers off (one `console.debug` line, no error UI). `QuoteUnavailableError` only for a rate limit or a 5xx.
- Gift choice: `OfferGiftPicker` when a gift offer has several items; sends `gift_choices`.
- Tracking: one row per offer (tiers with their level), free units, waived delivery; older orders unchanged (`orderOfferSummary`, `orderLineFree`).
- Styles: `bx-offer-*` classes; the checkout grid no longer overflows narrow screens.

## 0.1.3

- Remove the tracking consent banner.

Earlier versions: see the git history.
