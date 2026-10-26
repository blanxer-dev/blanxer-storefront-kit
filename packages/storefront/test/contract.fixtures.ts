// Backend answers for the website advance payment, field for field as the backend sends them
// (api-contract-advance.md §A–§F; the same fixtures as the Blanxer storefront's
// src/features/checkout/contract.fixtures.ts). Typed against the package's own types
// (`npm run typecheck` covers test/), so a type that drifts from the backend fails too. When the
// backend renames or moves a field, change it HERE first: the tests reading it then fail.
import type { OrderResponse, PublicOrder, Quote, Store } from '../src/core/index.js';
import type { PaymentStart } from '../src/client/index.js';

export const ORDER_ID = '64b7f0c2a1b2c3d4e5f60718';
export const STORE_ID = '64b7f0c2a1b2c3d4e5f60700';

/** `check_domain` → `store.checkout.advance_payment` (§A; display only). */
export const STORE_WITH_ADVANCE = {
  _id: STORE_ID,
  checkout: {
    advance_payment: {
      enabled: true,
      basis: 'percent',
      amount: 0,
      percent: 10,
      required: true,
      min_order: 0,
      places: { mode: 'all', names: [] },
    },
  },
} satisfies Partial<Store>;

/** The quote's `advance` (§B; backend `AdvanceQuote`). */
export const QUOTE_ADVANCE = { amount: 150, on_delivery: 2350, total: 2500, basis: 'delivery', required: true, full: false } as const;

/** A store on Offers: `POST /public/promotions/:store/quote` (§B). */
export const QUOTE_ON_OFFERS = {
  success: true,
  enabled: true,
  data: {
    lines: [],
    applications: [],
    code: null,
    delivery: { before: 200, discount: 0, after: 200 },
    totals: { gross: 2300, product_discount: 0, order_discount: 0, promo_discount: 0, goods: 2300, delivery: 200, total: 2500 },
    messages: [],
    server_time: '2026-10-24T10:00:00.000Z',
    payable: { customization: 80, member_discount: 240, total: 2340 },
    advance: { ...QUOTE_ADVANCE, on_delivery: 2190, total: 2340 },
  } satisfies Quote,
};

/** A store not on Offers (offers engine off): `{ success, enabled: false, data: { advance, totals } }` (§B). */
export const QUOTE_OFFERS_OFF = {
  success: true,
  enabled: false,
  data: { advance: QUOTE_ADVANCE, totals: { goods: 2300, delivery: 200, total: 2500 }, payable: { total: 2500 } },
};

/** `POST /order/:store` with COD + `advance_via` where the advance applies (§C). */
export const CREATED_ADVANCE_ORDER = {
  _id: ORDER_ID,
  order_number: 1234,
  slug: '',
  total_price: 2300,
  delivery_charge: 200,
  meta: { purchase_event_id: 'pe_1', value: 2500, currency: 'NPR', contents: [], content_ids: [], num_items: 1, order_id: ORDER_ID },
  status: 'Inactive',
  amount_to_pay: 150,
  advance: { amount: 150, on_delivery: 2350, basis: 'delivery', required: true },
  hold_expires_at: '2026-10-24T10:05:00.000Z',
  hold_seconds: 300,
} satisfies OrderResponse;

/** Create-order with an online method: the whole order (with delivery) online, no advance (§C). */
export const CREATED_ONLINE_ORDER = { ...CREATED_ADVANCE_ORDER, amount_to_pay: 2500, advance: null } satisfies OrderResponse;

/** Plain COD (§C): nothing online, no hold. */
export const CREATED_COD_ORDER = {
  _id: ORDER_ID,
  order_number: 1234,
  slug: '',
  total_price: 2300,
  delivery_charge: 200,
  status: 'Pending',
  amount_to_pay: 0,
  advance: null,
} satisfies OrderResponse;

/** A QR init on an advance order (§D): `/payment/dynamic_qr/init` and friends. */
export const QR_INIT_ADVANCE = {
  prn: 'prn_1',
  transaction: 'tx_1',
  amount: 150,
  socket_url: 'wss://pay.test/socket',
  qr_message: '000201…',
  order_number: 1234,
  advance: { amount: 150, on_delivery: 2350 },
  amount_to_pay: 150,
  hold_expires_at: '2026-10-24T10:04:00.000Z',
  hold_seconds: 240,
};
export const QR_START_ADVANCE = { type: 'qr', ...QR_INIT_ADVANCE } satisfies PaymentStart;

/** The same init on a retry after the checkout hold ended: no hold fields at all (§D). */
export const QR_INIT_AFTER_HOLD = (() => {
  const { hold_expires_at: _e, hold_seconds: _s, ...rest } = QR_INIT_ADVANCE;
  return { ...rest, transaction: 'tx_2' };
})();

const publicOrder = (over: Partial<PublicOrder>): PublicOrder => ({
  _id: ORDER_ID,
  order_number: 1234,
  status: 'Inactive',
  payment_status: 'Unpaid',
  payment_method: 'COD',
  product_total_price: 2300,
  customization_total: 0,
  delivery_charge: 200,
  discount: { d_value: 0 },
  partial_payment_amount: 0,
  customer_phone_number: '•••••••678',
  advance: null,
  amount_to_pay: 0,
  cod_to_collect: 2500,
  ...over,
});

/** `GET /order/public/:store/id/:order` (§F): an advance order whose advance isn't paid yet. */
export const PUBLIC_ADVANCE_DUE = publicOrder({
  advance: { status: 'due', amount: 150, on_delivery: 2350, gateway: null, paid_at: null, via: 'QR_Dynamic' },
  amount_to_pay: 150,
  // before the advance is paid cod_to_collect is still the whole total (nothing kept yet)
  cod_to_collect: 2500,
  hold_expires_at: '2026-10-24T10:03:00.000Z',
  hold_seconds: 180,
});

/** The same order once the gateway confirmed the advance (§E/§F). */
export const PUBLIC_ADVANCE_PAID = publicOrder({
  status: 'Pending',
  payment_status: 'Partial',
  partial_payment_amount: 150,
  advance: { status: 'paid', amount: 150, on_delivery: 2350, gateway: 'fonepay', paid_at: '2026-10-24T10:02:00.000Z', via: 'QR_Dynamic' },
  amount_to_pay: 0,
  cod_to_collect: 2350,
});

/** Paid advance, Rs 50 of it refunded since (§H: the courier collects the refunded part again). */
export const PUBLIC_ADVANCE_PART_REFUNDED = publicOrder({ ...PUBLIC_ADVANCE_PAID, cod_to_collect: 2400 });

/** An online order (eSewa) whose payment failed: due in full on the same order (§D/§F). */
export const PUBLIC_ONLINE_UNPAID = publicOrder({ payment_method: 'Esewa', payment_status: 'Failed', amount_to_pay: 2500 });

/** Plain cash on delivery (§F). */
export const PUBLIC_COD = publicOrder({ status: 'Pending' });

/** The backend's refusals of a retry (§D, payment.service.ts), word for word. */
export const REFUSED = {
  paid: 'This order is already paid.',
  advancePaid: 'The advance for this order is already paid.',
  cancelled: 'This order was cancelled. Place a new order.',
};

// ---------------------------------------------------------------- stock (stock-oversell contract)
// Backend answers when the stock is gone, field for field as the backend sends them
// (`src/core/handlers/stock.error.ts`; api-contract §2, §4, §9; the same fixtures as the Blanxer
// storefront's src/features/checkout/stock.fixtures.ts).

export const BAG = '64b7f0c2a1b2c3d4e5f60801';
export const BAG_RED = '64b7f0c2a1b2c3d4e5f60802';
export const MUG = '64b7f0c2a1b2c3d4e5f60803';

/** §2: a payment start / retry with no stock left for a line (HTTP 400, nothing created). */
export const SOLD_OUT_AT_PAY = {
  message: 'Sorry, Hot-water bag just sold out. You were not charged.',
  stock_error: {
    code: 'SOLD_OUT',
    lines: [{ product_id: BAG, variant_id: BAG_RED, name: 'Hot-water bag', variant_name: 'Red', wanted: 2, available: 0 }],
    order_id: ORDER_ID,
    order_number: 2133,
  },
};

/** §2: the last units are in other shoppers' checkouts (HTTP 400). */
export const STOCK_HELD_AT_PAY = {
  message: "The last units of Hot-water bag are in other shoppers' checkouts right now. Please try again in about 2 minutes. You were not charged.",
  stock_error: {
    code: 'STOCK_HELD',
    lines: [{ product_id: BAG, variant_id: BAG_RED, name: 'Hot-water bag', variant_name: 'Red', wanted: 2, available: 0 }],
    order_id: ORDER_ID,
    order_number: 2133,
    retry_after_seconds: 120,
  },
};

/** §9: create-order with a short stop-selling line (HTTP 400, no order). */
export const OUT_OF_STOCK_AT_CREATE = {
  message: 'Only 1 of Hot-water bag left.',
  stock_error: {
    code: 'OUT_OF_STOCK',
    lines: [{ product_id: BAG, variant_id: BAG_RED, name: 'Hot-water bag', variant_name: 'Red', wanted: 3, available: 1 }],
  },
};

/** §5: staff only (lead confirm / re-open): never shown to a shopper. */
export const NO_STOCK_TO_CONFIRM = {
  message: "Hot-water bag has 0 left, so this order can't be confirmed. Create a new order instead.",
  stock_error: { code: 'NO_STOCK_TO_CONFIRM', lines: [], new_order: {} },
};

/** §9: `POST /order/public/stock-check` answer (`available` null for continue-selling). */
export const STOCK_CHECK = {
  lines: [
    { product: BAG, variant: BAG_RED, quantity: 3, available: 1, continue_selling: false },
    { product: MUG, variant: null, quantity: 5, available: null, continue_selling: true },
  ],
};

/** §2: every successful init now carries the fresh hold. */
export const QR_INIT_FRESH_HOLD = { ...QR_INIT_ADVANCE, transaction: 'tx_3', hold_expires_at: '2026-10-25T10:05:00.000Z', hold_seconds: 300 };

/** §4: the public order read of a payment that landed on a cancelled order with no stock. */
export const PUBLIC_PAID_AFTER_CANCEL = publicOrder({
  order_number: 2133,
  status: 'Cancelled',
  payment_status: 'Paid',
  payment_method: 'Esewa',
  stock_short: { state: 'open', reason: 'paid_after_cancel' },
});

/** §1/§4: paid (live), the stock was gone: still Pending, the store will be in touch. */
export const PUBLIC_PAID_NO_STOCK = publicOrder({
  status: 'Pending',
  payment_status: 'Paid',
  payment_method: 'Esewa',
  stock_short: { state: 'open', reason: 'paid_no_stock' },
});
