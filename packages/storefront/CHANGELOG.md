# Changelog

## Unreleased

### Website traffic sources

- **`/client`:** `pingAnalytics` now sends where the visit came from (`visitDetails()`: referrer, host, landing path, `utm_source/medium/campaign`, click id), so the dashboard's Analytics → Traffic can show sources, landing pages and campaigns for custom sites too. An older backend ignores the body.

### Product structured data

- **`/seo`:** `productJsonLd` no longer reports a "continue selling" product with no stock as `InStock` on an advanced-inventory store (owner, 2026-10-28: continue selling never applies there). Simple stores are unchanged. The bundle offer block and `isOutOfStock` already treated advanced stores this way.

## 0.4.0

### Store pickup

Needs the Blanxer backend from the store-pickup release (TSK-154). Older backends send no `store_pickup`, and the checkout works as in 0.3.1.

- **Checkout:** "How do you want it?" (Home delivery / Pick up at store) when the store lists pickup outlets; each outlet with what it has of the cart (`POST /order/public/pickup-stock`) and a Recommended tag; the picked store follows the stock; Place order waits while the picked store lacks the cart. A pickup has no delivery charge ("Store pickup · Thamel"), sends `fulfilment: 'pickup'` + `pickup_outlet`, and prices the quote with `fulfilment: 'pickup'`.
- **Paying for a pickup:** "Pay at store" instead of cash on delivery (new `payAtStoreIcon` prop; still `COD` on the order), hidden when the store takes pickups paid online only; the store's pickup advance (from the quote) with "at the store" in every advance word. A pickup never takes the delivery advance.
- **Tracking:** "Store pickup · <outlet>" on the delivery row.
- **One pickup outlet** (backend FU-1b: a Platinum store with one outlet can offer pickup): the checkout lists that one store, and when it lacks the cart the hint reads "The store doesn’t have everything in your cart right now" instead of "No store has…".
- **`/core`:** `pickup.ts` (`pickupOutletsOf`, `pickupPaymentOf`, `pickedOutlet`, `pickupStockLine`, `recommendLine`, `pickupOrderFields`, `pickupBlocks`, `pickupMethods`, `pickupStockBody`, `pickupLabel`); `quoteCheckout({ pickup })`; `buildOrderPayload({ pickupOutlet })`; `buildQuoteRequest({ pickup })` (+ `fulfilment` in `quoteKey`); `advanceWords(advance, money, 'store')`. Types `PickupOutlet`, `PickupStockRow`, `OrderFulfilment`; `Store.store_pickup`; `OrderResponse.fulfilment`, `PublicOrder.fulfilment`.
- **`/client`:** `pickupStock(storeId, lines)` (never throws except an abort; a failed call or a store without pickup is `{ outlets: [], recommended: null }`).
- **`/react`:** `PickupChoice`, `usePickupStock`; `useCartQuote({ pickup })`, `useAdvanceQuote({ pickup })`, `AdvanceSummaryRows atStore`, `AdvanceMethodModal cashSuffix`.
- **Styles:** `bx-pickup*`.

## 0.3.1

### Stop orders for stock that isn't there

Needs the Blanxer backend from the stock-oversell release. Older backends send no `stock_error` and have no stock check, so the checkout works as in 0.3.0. The server decides every number; the package never works out stock.

- **Checkout:**
  - The lines being checked out are checked with the server while the checkout is shown (`POST /order/public/stock-check`, debounced) and again right before Place order. A cart above what is left is held to it (a line at 0 is removed) and nothing is placed: the notice says "Only 1 of Hot-water bag (Red) left." with each line ("you wanted 3" · "Only 1 left") and "Continue with the rest".
  - Create-order refused for stock (`OUT_OF_STOCK`, or `STOCK_HELD` for units in other shoppers' checkouts): the server's message in a small notice, not the "Error creating order" toast. "Change my order" holds the cart to the server's `available` (removed at 0) so the shopper places a new order. `STOCK_HELD` also offers "Try again", enabled after the server's `retry_after_seconds` ("Try again in 1:58"); its lines read "In other checkouts", not "Sold out".
  - While an order of this cart waits for its payment, the check carries that order and its proof (the last attempt's `transaction_id`, else the order's 10-digit phone; contract v1.2), so its own hold isn't counted. No proof: no check while it waits. A shortage then is told once per answer ("Change my order" gives the waiting order up, releasing its hold, then holds the cart to what is left); the cart is never changed behind the shopper's back while an order waits.
- **Paying an order (all stores):** the first payment, "Try again" / "Pay another way" on "Payment not finished", "Pay Rs X" on the tracking page, and "Try again" on an expired QR. A start refused for stock shows the same notice instead of an error, and the QR / method modal closes. Nothing was charged.
  - `SOLD_OUT`: the waiting order is forgotten and never offered for payment again. "Change my order" holds the cart to what is left and goes back to the checkout, so a new order is placed (the old one stays Inactive).
  - `STOCK_HELD`: the order is kept. "Try again" on the same order after the server's wait, or "Change my order". The wait is kept per order for this tab (sessionStorage `checkout_stock_wait`): the pay panel's own "Try again" / "Pay Rs X" / "Pay another way" read "Try again in 1:58" and stay disabled until it is over, and no payment is started for that order meanwhile.
- **The shopper's code is kept (all stores):** placing an order clears the code (the `?promo=` code; on Offers stores also the saved code, gift picks and removed offers). For an order that waits for its payment they are kept with it (sessionStorage `checkout_order_choices`) and given back when that order is given up: a payment start refused for stock, "Change my order", "Change the order details instead", "Pay all in cash on delivery instead". The replacement order sends the code again and the server prices it again. Gone once the order is paid.
- **Cart (`CartView`, the checkout's lines):** with the server's caps, "+" stops at the cap and the line says "Only N left". Quantities above the cap are lowered, with the notice. While an order of this tab waits, the cart's check sends its last attempt as proof and only "+" / "Only N left" follow the answer.
- **`OrderTracking`:** an open `stock_short` on the order read shows "We received your payment, but this order was cancelled. The store will refund you." (paid after it was cancelled, or money received only), or "We received your payment, but an item in this order sold out. The store will contact you to refund you or change the order." It replaces the "order placed" banner. New prop `changeOrderHref` (default `/checkout`).
- **QR timer:** every successful payment init now carries `hold_expires_at` + `hold_seconds`; the countdown already follows the init's hold (unchanged).
- **`/core`:** `stock.ts`, ported from the storefront (same names and words): `toStockRefusal` (also reads a `BlanxerApiError`'s `body`), `stockWords`, `stockNoticeTitle`, `retryLabel`, `stockLineName`, `stockLineLeft`, `refusalEndsOrder`, `stockKey`, `noCaps`, `capsFromRefusal`, `stockCheckBody`, `capsFromCheck`, `capCart`, `canAddOne`, `lineCap`, `refusalFromChanges`, `stockShortNote`, `stockWaitLeft`, `waitingProof`; `stockCheckBody(store_id, lines, waiting?)`. Types: `StockRefusal`, `StockLine`, `StockCode`, `StockCaps`, `CapLine`, `CartChange`, `WaitingProof`, `PublicStockShort`; `PublicOrder.stock_short`. `STORAGE_KEYS.stockWait`, `STORAGE_KEYS.orderChoices`.
- **`/client`:** `stockCheck(storeId, lines, waiting?)` → `StockCaps` (never throws except an abort; a 404, network error, rate limit or non-JSON answer is no caps). `noteStockWait` / `stockWaitFor` (`startPayment` notes a STOCK_HELD wait itself). `keepOrderChoices` / `takeOrderChoices` (`OrderChoices`); `clearPendingOrder` also forgets the kept choices.
- **`/react`:** `StockNotice`, `StockNoticeModal`, `useStockCaps` (`waiting`, returns `checked`), `useCartStockCaps` (`waiting`, `onShort`), `useOrderChoices`. The offers context gains `choices()` / `restoreChoices(saved)` (`OfferChoices`). `PaymentDueBox` waits for the order's STOCK_HELD wait. The cart gains `capLines(caps, ids?)`. `CartLines` takes `caps`. `usePayOrder` takes `onStockRefused`, `onChangeOrder`, `changeOrderHref` and returns `stockRefusal` and `changeOrder`. `usePayOrder`, `PaymentDueBox`, `AdvanceMethodModal` and `PAYMENT_ERRORS` are now exported from `/react` (documented in 0.3.0 but missing from the index).
- **Styles:** `bx-stock-notice*`, `bx-stock-modal`, `bx-stock-left`.
- The payment methods are unchanged (no second list of methods).

## 0.3.0

### Advance payment ("pay part online, rest on delivery") and paying an order again

Needs the Blanxer backend from the advance-payment release. Older backends send no `advance` anywhere, and the checkout then works as in 0.2.0, except for the three changes marked **all stores** below. The server works out every amount; the package never computes an advance.

- **Checkout, stores with the advance on** (`store.checkout.advance_payment.enabled`, from `check_domain`; display only):
  - The payment methods stay as they were; only the Cash on delivery tile adds a second line, "Rs 150 online now · rest on delivery" ("or Rs 150 online now · rest on delivery" when the advance is the shopper's choice).
  - The summary adds "Pay now (advance)" and "Pay on delivery" under the Total (`aria-live="polite"`). The button reads "Pay Rs 150 & place order", with "Rs 2,350 cash on delivery" under it.
  - Pressing that button (after the form checks) opens a small modal titled "Pay Rs 150 & place order" with "Rs 2,350 cash on delivery" under it: the store's online methods as radios (the last pick, else the first, preselected) and "Pay Rs 150". The order is created only on confirm; closing it places nothing. With shopper's choice the last option is "Pay all Rs 2,500 on delivery instead"; while it is picked the modal reads "Place order" / "Rs 2,500 cash on delivery" and its button "Place order · Rs 2,500 cash on delivery" (a plain COD order; `AdvanceMethodModal` `placeLabel` + `noAdvanceCod`, core `payModalText`). A required advance with exactly one online method skips the modal.
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
  - When a QR is closed unpaid or expires, or the shopper comes back to checkout with the same cart, a "Payment not finished" panel replaces Place order. It offers "Try again" (the last method, same order id) and "Pay another way" (the same method modal, online methods only; not shown with a single method). "Pay Rs X" only shows the server's amount (`amount_to_pay`, or the advance create-order answered); without one (an older backend) the panel shows "See your order to pay", a link to `/track/<id>`, instead of the pay buttons (`payOrderView`). Before that panel shows, the stored waiting order is read from the server (`loadPendingOrder` in `/client`; Place order waits for it): paid meanwhile (e.g. a webhook while the shopper was away) → forgotten, its lines leave the cart and "Order #N is paid" is shown; cancelled, returned, refunded or nothing left to pay → forgotten; still due → the server's `amount_to_pay`.
  - A shopper's-choice advance order can switch to "Pay all in cash on delivery instead": the hold is released and a new plain COD order is placed.
  - "Change the order details instead" releases the hold and forgets the waiting order, so the form can be edited and placed again.
  - The hold is released by the payment attempt when known, else by the order's 10-digit phone (`releaseHold({ store_id, order_id, phone_number })`, e.g. after a failed redirect).
  - "Pay Rs X" amounts come from the server's `amount_to_pay` (create-order, the order read).
  - A retry refused as "already paid" goes to the success page. One refused as "cancelled" lets the shopper place a new order.
  - No second order is placed while one waits for this cart.
- **All stores: payment tiles stay real radio inputs** (keyboard-accessible).
- **QR modals:** "Advance for order #1234 · Rs 2,350 on delivery" above the amount (QR inits that send `advance`). The countdown follows the hold the init answers (every attempt, retries included). With no hold left there is no countdown: the QR never shows "expired" and nothing is released on a timer. Older backends: create-order's `hold_seconds`, as before. The new `onUnpaid(reason)` prop fires when the QR is cancelled, expires or the shopper retries. With `onUnpaid`, the expired screen's main button is "Try again".
- **`PaymentFailed`:** when this tab placed the order, the main action is "Try payment again" (`/track/<id>`, prop `trackHref`), with "Shop More" second. In that case the pending Purchase is kept for the retry. With no waiting order in the tab it falls back to `?order=` (prop `order`; the gateway sends it back, e.g. an eSewa cancel).
- **`OrderTracking`:**
  - An online payment or advance still due shows "Advance due — Pay Rs X" or "Payment not received — Pay Rs X", with the online methods as radios and a "Pay Rs X" button for this order. This box replaces the "order placed" banner.
  - The amount to pay is the order read's `amount_to_pay`.
  - A paid advance shows "Paid online (advance)" and "To pay on delivery" (the read's `cod_to_collect` when present, else the advance's `on_delivery`). The old partial-payment rows stay for staff-recorded partials.
  - The payment status `Partial` reads "Advance paid".
- **`/core`:**
  - `advance.ts`, ported from the storefront: `toAdvance`, `codOffer`, `pickAdvanceVia`, `activeAdvance`, `advanceFlow`, `advanceOrderFields`, `advanceBlocks`, `advanceWords`, `paymentDue`, `pendingDue`, `placedAmount`, `advanceSplit`, `advanceInitLine`, `retryRefused`, `quotePayable`, `holdSecondsOf`, `toCollectOnDelivery`, `failedOrderId`, `cartSignature`, `PendingOrder` / `parsePending` / `pendingFor` / `PENDING_KEY`, `ONLINE_METHODS`.
  - Kit-only helpers: `advancePaymentOn`, `advanceFromAnswer`, `orderAdvance`.
  - `buildOrderPayload({ advance, advanceVia })`. `buildQuoteRequest({ coupon })` plus per-line `customization_charge`.
  - Types: `Quote.advance` / `payable`, `OrderResponse.advance` / `status` / `amount_to_pay`, `PublicOrder` (`amount_to_pay`, `cod_to_collect`, hold), `PublicOrder`, `PublicOrderAdvance`, `StoreCheckoutSettings.advance_payment`. `STORAGE_KEYS.pendingOrder`.
- **`/client`:** `quoteAdvance`, `readPendingOrder` / `savePendingOrder` / `clearPendingOrder`. `getOrder` is typed `PublicOrder`. `startPayment` may be called again for the same order. `releaseHold` takes `transaction_id` or `phone_number`.
- **`/react`:** `usePayOrder` (start or restart a payment with the QR modals), `PaymentDueBox` ("Pay Rs X" + "Pay another way"), `AdvanceMethodModal`, `AdvanceSummaryRows`, `useAdvanceQuote`, `useOptionalCart`. The cart gains `removeLines(ids)`. `OfferSummary` takes `advance`.
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
