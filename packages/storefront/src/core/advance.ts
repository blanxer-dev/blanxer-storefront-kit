/**
 * Website advance payment ("pay part online, rest on delivery") and paying an order again.
 * Pure helpers only (tested in test/advance.test.ts). Ported from the Blanxer storefront
 * (`src/features/checkout/advance.ts`): same names, same rules, same shopper words.
 *
 * The server works out every amount: the advance comes from the quote
 * (`POST /public/promotions/:store/quote` → `advance`), create-order works it out again, and the
 * order read says what is still due. Nothing here computes an advance; it only decides what to
 * show and send from the server's numbers.
 */

export type AdvanceBasis = 'delivery' | 'fixed' | 'percent';

/** The quote's `advance` (contract §B). */
export interface Advance {
  /** pay now, whole rupees */
  amount: number;
  /** order total − amount: what the courier collects */
  on_delivery: number;
  /** the order total it was worked from */
  total: number;
  basis: AdvanceBasis;
  /** true: plain cash on delivery isn't offered here */
  required: boolean;
  /** the advance is the whole order: pay online in full, no cash part */
  full: boolean;
}

/**
 * The storefront names of the methods that can pay online (never COD). Same list as the
 * storefront; the kit never offers `Card` (`paymentMethodsFor` leaves it out).
 */
export const ONLINE_METHODS = [
  'QR_Dynamic',
  'FonepayCheckout',
  'QR',
  'Esewa',
  'FonePay',
  'Khalti',
  'Card',
  'NPX',
  'nbank_card',
  'QR_Static',
] as const;

export const isOnlineMethod = (name: unknown) => typeof name === 'string' && (ONLINE_METHODS as readonly string[]).includes(name);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);

/** The quote's advance as the page uses it; anything unexpected (or none) is null = plain COD. */
export const toAdvance = (raw: any): Advance | null => {
  if (!raw || typeof raw !== 'object') return null;
  const amount = num(raw.amount);
  const onDelivery = num(raw.on_delivery);
  const total = num(raw.total);
  if (!(amount > 0) || !(onDelivery >= 0)) return null;
  return {
    amount,
    on_delivery: onDelivery,
    total: total >= 0 ? total : amount + onDelivery,
    basis: raw.basis === 'fixed' || raw.basis === 'percent' ? raw.basis : 'delivery',
    required: raw.required !== false,
    full: raw.full === true,
  };
};

/**
 * How cash on delivery is offered with this advance (contract §A–C):
 * - `plain`: as today (no advance here, or the advance is optional and would be the whole order);
 * - `advance`: COD with the advance paid online first; `optional` = shopper's choice, where
 *   plain COD stays as a choice too;
 * - `hidden`: the advance is the whole order and required: pay online in full, no COD.
 */
export type CodOffer = { mode: 'plain' } | { mode: 'advance'; advance: Advance; optional: boolean } | { mode: 'hidden'; advance: Advance };

export const codOffer = (advance: Advance | null): CodOffer => {
  if (!advance) return { mode: 'plain' };
  if (advance.full) return advance.required ? { mode: 'hidden', advance } : { mode: 'plain' };
  return { mode: 'advance', advance, optional: !advance.required };
};

/** The cash-on-delivery choice under the COD tile: an online method name, or '' = no advance. */
export type AdvanceChoice = string;

/**
 * The advance method picked: kept while still offered, else the shopper's remembered method when
 * online, else the first online method. Shopper's choice starts at '' (plain COD, as today).
 */
export const pickAdvanceVia = (
  prev: AdvanceChoice,
  online: string[],
  opts: { optional: boolean; preferred?: string | null },
): AdvanceChoice => {
  if (prev === '' && opts.optional) return '';
  if (prev && online.includes(prev)) return prev;
  if (opts.optional) return '';
  if (opts.preferred && online.includes(opts.preferred)) return opts.preferred;
  return online[0] || '';
};

/**
 * The advance this order is placed with, or null (plain COD or an online method): COD picked,
 * the advance applies (not full), and an online method is picked for it.
 */
export const activeAdvance = (
  paymentMethod: string,
  offer: CodOffer,
  via: AdvanceChoice,
  online: string[],
): Advance | null => {
  if (paymentMethod !== 'COD' || offer.mode !== 'advance') return null;
  if (!via || !online.includes(via)) return null;
  return offer.advance;
};

/** What the order call adds: `advance_via` only with COD and an advance that applies (§C). */
export const advanceOrderFields = (advance: Advance | null, via: AdvanceChoice): { advance_via?: string } =>
  advance && via && isOnlineMethod(via) ? { advance_via: via } : {};

/** Place order is blocked: a required advance with no online method to pay it. */
export const advanceBlocks = (paymentMethod: string, offer: CodOffer, via: AdvanceChoice, online: string[]) =>
  paymentMethod === 'COD' && offer.mode === 'advance' && !offer.optional && !(via && online.includes(via));

export type Money = (n: number) => string;

/** The shopper-facing words for an advance (shown amounts are always the server's). */
export const advanceWords = (advance: Advance, money: Money) => ({
  /** second line of the COD tile (shopper's choice: the advance is an option) */
  codLine: `${advance.required ? '' : 'or '}${money(advance.amount)} now · rest on delivery`,
  /** above the online methods under COD */
  pickerLabel: `Pay the ${money(advance.amount)} advance with`,
  /** shopper's choice: the plain COD radio */
  noAdvance: `No advance: pay ${money(advance.total)} on delivery`,
  payNowLabel: 'Pay now (advance)',
  onDeliveryLabel: 'Pay on delivery',
  button: `Pay ${money(advance.amount)} & place order`,
  underButton: `${money(advance.on_delivery)} cash on delivery`,
  /** read out when the split changes (aria-live) */
  live: `Pay ${money(advance.amount)} now and ${money(advance.on_delivery)} on delivery.`,
});

// ── paying an order (again) ──────────────────────────────────────────────────────────────────

/** An online payment still owed on an order (contract §D, §F). */
export interface PaymentDue {
  order_id: string;
  order_number: string;
  /** what the gateway is asked for now (the server charges it again on init) */
  amount: number;
  /** an advance: the cash part on delivery; null for a fully online order */
  on_delivery: number | null;
  advance: boolean;
  /** the method picked at checkout (to preselect) */
  via: string | null;
}

const SETTLED = ['paid', 'partial', 'waiting reconcile', 'refunded'];
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * What is still to be paid online on this order (the public order read), or null. An advance
 * order that isn't paid yet → the advance (`amount_to_pay`, else the advance's amount); any other
 * online order still Inactive and not settled → the server's `amount_to_pay` (null when it says
 * 0 or nothing). Cancelled / returned / settled orders and plain COD → null.
 */
export const paymentDue = (o: any): PaymentDue | null => {
  if (!o || !o._id) return null;
  const status = lc(o.status);
  if (status !== 'inactive') return null;
  if (SETTLED.includes(lc(o.payment_status))) return null;
  const id = String(o._id);
  const number = String(o.order_number ?? '');
  const adv = o.advance;
  if (adv && typeof adv === 'object') {
    if (adv.status !== 'due') return null;
    const amount = Number(o.amount_to_pay) > 0 ? Number(o.amount_to_pay) : Number(adv.amount) || 0;
    if (!(amount > 0)) return null;
    return {
      order_id: id,
      order_number: number,
      amount,
      on_delivery: Number(adv.on_delivery) || 0,
      advance: true,
      via: isOnlineMethod(adv.via) ? adv.via : null,
    };
  }
  const method = String(o.payment_method ?? '');
  if (!method || method === 'COD') return null;
  const amount = Number(o.amount_to_pay) || 0;
  if (!(amount > 0)) return null;
  return { order_id: id, order_number: number, amount, on_delivery: null, advance: false, via: isOnlineMethod(method) ? method : null };
};

/**
 * The split on a placed order: "Paid online (advance)" / "To pay on delivery" (§F). The cash part
 * is the server's `cod_to_collect` when the read has it (it counts refunds), else the advance's
 * `on_delivery`.
 */
export const advanceSplit = (o: any): { paid: number; on_delivery: number } | null => {
  const adv = o?.advance;
  if (!adv || adv.status !== 'paid') return null;
  const paid = Number(adv.amount) || 0;
  if (!(paid > 0)) return null;
  const onDelivery = typeof o.cod_to_collect === 'number' && Number.isFinite(o.cod_to_collect) ? o.cod_to_collect : Number(adv.on_delivery) || 0;
  return { paid, on_delivery: onDelivery };
};

/** The line on a QR / payment screen: "Advance for order #1234 · Rs 2,350 on delivery" (§D). */
export const advanceInitLine = (init: any, money: Money): string | null => {
  const adv = init?.advance;
  if (!adv || !(Number(adv.amount) > 0)) return null;
  const n = init?.order_number != null && init.order_number !== '' ? ` for order #${init.order_number}` : '';
  return `Advance${n} · ${money(Number(adv.on_delivery) || 0)} on delivery`;
};

/** The words of a refused retry (§D): already paid / cancelled → stop offering to pay. */
export const retryRefused = (message: unknown): 'paid' | 'cancelled' | null => {
  const m = lc(message);
  if (m.includes('already paid')) return 'paid';
  if (m.includes('was cancelled')) return 'cancelled';
  return null;
};

// ── the order waiting for payment, kept with the cart ────────────────────────────────────────

/** The cart lines an order was placed with, as one comparable string. */
export const cartSignature = (lines: { id?: string; product?: string; variant?: string; quantity?: number }[]) =>
  lines
    .map((l) => `${l.id || `${l.product}_${l.variant || ''}`}x${Number(l.quantity) || 0}`)
    .sort()
    .join('|');

/** An order placed from this tab whose online payment isn't confirmed yet. */
export interface PendingOrder {
  order_id: string;
  order_number: string;
  /** cart line ids it was placed with (removed from the cart once paid) */
  lines: string[];
  signature: string;
  method: string;
  /** what the server said is to pay now (the advance, else the order total), for the button */
  amount: number;
  /** an advance order: plain COD may replace it only when the advance is optional */
  advance: null | { amount: number; on_delivery: number; required: boolean };
  /** the last payment attempt (releasing the hold needs it) */
  transaction?: string;
}

export const PENDING_KEY = 'checkout_pending_order';

export const parsePending = (raw: string | null): PendingOrder | null => {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p.order_id !== 'string' || !p.order_id || !Array.isArray(p.lines)) return null;
    return {
      order_id: p.order_id,
      order_number: String(p.order_number ?? ''),
      lines: p.lines.map(String),
      signature: String(p.signature ?? ''),
      method: String(p.method ?? ''),
      amount: Number(p.amount) > 0 ? Number(p.amount) : 0,
      advance: p.advance && Number(p.advance.amount) > 0 ? { amount: Number(p.advance.amount), on_delivery: Number(p.advance.on_delivery) || 0, required: p.advance.required !== false } : null,
      ...(p.transaction ? { transaction: String(p.transaction) } : {}),
    };
  } catch {
    return null;
  }
};

/** The waiting order still belongs to this cart (same lines, same quantities). */
export const pendingFor = (pending: PendingOrder | null, signature: string): PendingOrder | null =>
  pending && pending.signature && pending.signature === signature ? pending : null;

/** The waiting order as something to pay (the checkout's "Payment not finished" panel). */
export const pendingDue = (p: PendingOrder): PaymentDue => ({
  order_id: p.order_id,
  order_number: p.order_number,
  amount: p.advance ? p.advance.amount : p.amount,
  on_delivery: p.advance ? p.advance.on_delivery : null,
  advance: !!p.advance,
  via: isOnlineMethod(p.method) ? p.method : null,
});

/**
 * What an order just placed asks to be paid online now, from create-order's answer: the server's
 * `amount_to_pay`, else the advance's amount. 0 when the answer doesn't say.
 */
export const placedAmount = (res: any): number => {
  const toPay = Number(res?.amount_to_pay) || 0;
  if (toPay > 0) return toPay;
  const adv = Number(res?.advance?.amount) || 0;
  return adv > 0 ? adv : 0;
};

/**
 * What the order will cost, as create-order prices it: the quote's `payable.total` (customization
 * and a member discount included), or null when the quote doesn't say (older backends: add
 * customization to `totals.total` yourself, as before).
 */
export const quotePayable = (quote: any): number | null => {
  const t = quote?.payable?.total;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : null;
};

/**
 * Seconds left on the checkout hold from a payment init (or create-order) answer, or null: the
 * hold has ended (or the backend doesn't say). With null, show no countdown and never "expired".
 */
export const holdSecondsOf = (data: any): number | null => {
  const h = Number(data?.hold_seconds);
  return h > 0 ? h : null;
};

// ── kit only ─────────────────────────────────────────────────────────────────────────────────

/** `store.checkout.advance_payment` as `check_domain` sends it (display only: the quote decides). */
export interface AdvancePaymentSetting {
  enabled?: boolean;
  basis?: AdvanceBasis;
  amount?: number;
  percent?: number;
  required?: boolean;
  min_order?: number;
  places?: { mode?: 'all' | 'only' | 'except'; names?: string[] };
  [key: string]: any;
}

/** The store switched the advance on (absent on older stores = off). Only then is it quoted. */
export const advancePaymentOn = (store?: { checkout?: { advance_payment?: AdvancePaymentSetting | null } | null } | null): boolean =>
  store?.checkout?.advance_payment?.enabled === true;

/**
 * The advance from a quote answer, on a store on Offers (`{ enabled: true, data: { …, advance } }`)
 * or not (`{ enabled: false, data: { advance, totals } }`). Anything else (an older backend, an
 * HTML page, an error body) is null: plain cash on delivery, as today.
 */
export const advanceFromAnswer = (raw: unknown): Advance | null => {
  const r = raw as any;
  if (!r || typeof r !== 'object' || !r.data || typeof r.data !== 'object') return null;
  return toAdvance(r.data.advance);
};

/** The advance on a create-order answer (`advance: { amount, on_delivery, basis, required }`), or null = plain COD. */
export const orderAdvance = (res: unknown): { amount: number; on_delivery: number; required: boolean } | null => {
  const a = (res as any)?.advance;
  if (!a || typeof a !== 'object' || !(Number(a.amount) > 0)) return null;
  return { amount: Number(a.amount), on_delivery: Number(a.on_delivery) || 0, required: a.required !== false };
};

/**
 * "To pay on delivery" on the track page (§F/§H). While the advance isn't paid the server's
 * `cod_to_collect` is still the whole total (nothing kept yet), so the advance's own
 * `on_delivery` shows; once it is paid, and on every other order, `cod_to_collect` (net of a
 * refunded advance). Null when the read says neither.
 */
export const toCollectOnDelivery = (o: any): number | null => {
  const adv = o?.advance;
  const unpaid = !!adv && (adv.status === 'due' || ((Number(adv.due) || 0) > 0 && !adv.paid_at && adv.status !== 'paid'));
  if (unpaid) return Number(adv.on_delivery) || 0;
  if (typeof o?.cod_to_collect === 'number' && Number.isFinite(o.cod_to_collect)) return o.cod_to_collect;
  if (adv && adv.on_delivery != null) return Number(adv.on_delivery) || 0;
  return null;
};

const ORDER_ID = /^[a-f0-9]{24}$/i;

/**
 * The order /payment/failed offers to pay again: this tab's waiting order, else the order the
 * gateway sent back (`?order=<id>`, e.g. an eSewa cancel, backend B1). Only a real order id.
 */
export const failedOrderId = (stored: (string | null | undefined)[], queryOrder?: unknown): string | null => {
  for (const id of stored) if (id && ORDER_ID.test(String(id))) return String(id);
  const q = Array.isArray(queryOrder) ? queryOrder[0] : queryOrder;
  return typeof q === 'string' && ORDER_ID.test(q.trim()) ? q.trim() : null;
};
