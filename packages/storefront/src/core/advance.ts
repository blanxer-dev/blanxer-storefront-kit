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

/** The method chosen for the advance: an online method name, or '' = no advance (plain COD). */
export type AdvanceChoice = string;

/**
 * The method preselected in the pay modal ("Pay Rs X & place order"): kept while still offered,
 * else the shopper's remembered method when online, else the first online method.
 */
export const pickAdvanceVia = (
  prev: AdvanceChoice,
  online: string[],
  opts: { preferred?: string | null } = {},
): AdvanceChoice => {
  if (prev && online.includes(prev)) return prev;
  if (opts.preferred && online.includes(opts.preferred)) return opts.preferred;
  return online[0] || '';
};

/**
 * The advance the summary and button show (Pay now / Pay on delivery, "Pay Rs X & place
 * order"): COD picked where the advance applies (required or shopper's choice), else null. The
 * method that pays it is chosen only when the order is placed (`advanceFlow`).
 */
export const activeAdvance = (paymentMethod: string, offer: CodOffer): Advance | null =>
  paymentMethod === 'COD' && offer.mode === 'advance' ? offer.advance : null;

/**
 * What "Pay Rs X & place order" does: `choose` opens the small pay modal ("Pay Rs X & place order")
 * (the order is created only when the shopper confirms there); `direct` goes straight to the
 * store's only online method (a required advance); `plain` is today's COD.
 */
export type AdvanceFlow = { kind: 'plain' } | { kind: 'direct'; via: string } | { kind: 'choose' };

export const advanceFlow = (offer: CodOffer, online: string[]): AdvanceFlow => {
  if (offer.mode !== 'advance') return { kind: 'plain' };
  if (!offer.optional && online.length === 1) return { kind: 'direct', via: online[0] };
  return { kind: 'choose' };
};

/** What the order call adds: `advance_via` only with COD and an advance that applies (§C). */
export const advanceOrderFields = (advance: Advance | null, via: AdvanceChoice): { advance_via?: string } =>
  advance && via && isOnlineMethod(via) ? { advance_via: via } : {};

/**
 * The pay modal's head and button for the option picked: an online method → the advance words
 * ("Pay Rs 150 & place order" / "Rs 950 cash on delivery" / "Pay Rs 150"); shopper's choice's
 * plain COD option ('') → "Place order" / "Rs 1,100 cash on delivery" / "Place order · Rs 1,100
 * cash on delivery" (the quote's total). Back to the advance words when a method is picked again.
 */
export const payModalText = (
  via: string,
  w: { title: string; cod?: string; payLabel: string; noAdvance?: { title: string; cod?: string; button: string } },
): { title: string; cod?: string; button: string } =>
  via === '' && w.noAdvance ? { title: w.noAdvance.title, cod: w.noAdvance.cod, button: w.noAdvance.button } : { title: w.title, cod: w.cod, button: w.payLabel };

/** Place order is blocked: a required advance and no online method to pay it. */
export const advanceBlocks = (paymentMethod: string, offer: CodOffer, online: string[]) =>
  paymentMethod === 'COD' && offer.mode === 'advance' && !offer.optional && !online.length;

export type Money = (n: number) => string;

/** The shopper-facing words for an advance (shown amounts are always the server's). */
export const advanceWords = (advance: Advance, money: Money) => ({
  /** second line of the COD tile (shopper's choice: the advance is an option) */
  codLine: `${advance.required ? '' : 'or '}${money(advance.amount)} online now · rest on delivery`,
  /** the pay modal's title and the smaller line under it (owner: same as the button) */
  modalTitle: `Pay ${money(advance.amount)} & place order`,
  modalNote: `${money(advance.on_delivery)} cash on delivery`,
  /** shopper's choice: the plain COD option in the modal */
  noAdvance: `Pay all ${money(advance.total)} on delivery instead`,
  /** while that option is picked: the modal's title / cash line / button (the whole order in cash) */
  noAdvanceTitle: 'Place order',
  noAdvanceNote: `${money(advance.total)} cash on delivery`,
  noAdvanceButton: `Place order · ${money(advance.total)} cash on delivery`,
  /** the modal's button */
  payButton: `Pay ${money(advance.amount)}`,
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

/** What the server says "Pay now" charges on this order (`amount_to_pay`, §C/§F); 0 if absent. */
const toPay = (o: any) => {
  const n = Number(o?.amount_to_pay);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * What is still to be paid online on this order (the public order read), or null. An advance
 * order that isn't paid yet → the advance; any other online order still Inactive and not
 * settled → the server's `amount_to_pay` (never worked out here). Cancelled / returned /
 * settled orders, plain COD and nothing to pay → null.
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
    const amount = toPay(o) || Number(adv.amount) || 0;
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
  const amount = toPay(o);
  if (!(amount > 0)) return null;
  return { order_id: id, order_number: number, amount, on_delivery: null, advance: false, via: isOnlineMethod(method) ? method : null };
};

/**
 * The split on a placed order: "Paid online (advance)" / "To pay on delivery" (§F). What the
 * courier collects is the server's `cod_to_collect` when the read has it (net of a refunded
 * advance, §H), else the advance view's `on_delivery`.
 */
export const advanceSplit = (o: any): { paid: number; on_delivery: number } | null => {
  const adv = o?.advance;
  if (!adv || adv.status !== 'paid') return null;
  const paid = Number(adv.amount) || 0;
  if (!(paid > 0)) return null;
  const collect = typeof o?.cod_to_collect === 'number' && Number.isFinite(o.cod_to_collect) ? o.cod_to_collect : Number(adv.on_delivery) || 0;
  return { paid, on_delivery: collect };
};

/**
 * The hold left on a payment attempt, from the init's answer (every attempt, retries too): the
 * QR timer follows it. Null once the hold ended (or none was sent): show no timer, never
 * "expired" (a payment that lands late is still taken, §D).
 */
export const holdSecondsOf = (data: any): number | null => {
  const n = Number(data?.hold_seconds);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * What the order will cost, from the quote's `payable` (§B: customization and the member
 * discount included). Null on an older backend: the page keeps its own sum as before.
 */
export const quotePayable = (quote: any): number | null => {
  const n = quote?.payable?.total;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
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

/**
 * What a "pay this order" panel shows (`PaymentDueBox`: checkout "Payment not finished", the
 * tracking page). "Pay Rs X" only with the server's amount (`amount_to_pay`, or the advance
 * create-order answered); without one (an older backend) no pay button: a link to the order's
 * tracking page instead, never a total worked out here.
 */
export const payOrderView = (due: PaymentDue, money: Money) => {
  const known = due.amount > 0;
  return {
    title: due.advance
      ? known
        ? `Advance due — Pay ${money(due.amount)}`
        : 'Advance due'
      : known
        ? `Payment not received — Pay ${money(due.amount)}`
        : 'Payment not received',
    /** the pay button (and the method modal); null: show `trackHref` instead */
    payLabel: known ? `Pay ${money(due.amount)}` : null,
    modalTitle: known ? (due.advance ? `Pay ${money(due.amount)}` : `Pay ${money(due.amount)} online`) : null,
    trackHref: known ? null : `/track/${due.order_id}`,
  };
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

/**
 * The waiting order as the server sees it now (the public order read), before the checkout
 * offers to pay it again: the tab's stored copy can be stale (paid by a webhook / callback while
 * the shopper was away). `paid` (Paid / Partial / Waiting Reconcile): forget it, its lines leave
 * the cart; `closed` (cancelled, returned, refunded, or nothing left to pay): forget it, keep the
 * cart; `due`: pay the server's `amount_to_pay`; `unknown` (no read, an older backend without
 * `amount_to_pay`): as stored.
 */
export type WaitingOnServer =
  | { state: 'paid' }
  | { state: 'closed' }
  | { state: 'due'; amount: number; on_delivery: number | null }
  | { state: 'unknown' };

export const waitingOnServer = (o: any): WaitingOnServer => {
  if (!o || !o._id) return { state: 'unknown' };
  const status = lc(o.status);
  const payment = lc(o.payment_status);
  if (status === 'cancelled' || status === 'returned' || payment === 'refunded') return { state: 'closed' };
  if (SETTLED.includes(payment)) return { state: 'paid' };
  if (typeof o.amount_to_pay !== 'number' || !Number.isFinite(o.amount_to_pay)) return { state: 'unknown' };
  if (!(o.amount_to_pay > 0)) return { state: 'closed' };
  const od = o.advance && typeof o.advance === 'object' ? Number(o.advance.on_delivery) : Number.NaN;
  return { state: 'due', amount: o.amount_to_pay, on_delivery: Number.isFinite(od) ? od : null };
};

/** The stored waiting order with what the server says is due now (`waitingOnServer` → due). */
export const withServerDue = (p: PendingOrder, due: { amount: number; on_delivery: number | null }): PendingOrder => ({
  ...p,
  amount: due.amount,
  advance: p.advance ? { ...p.advance, amount: due.amount, on_delivery: due.on_delivery ?? p.advance.on_delivery } : null,
});

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
 * What an order just placed asks to be paid online now: create-order's `amount_to_pay` (§C),
 * else the advance it answered. 0 when the answer doesn't say.
 */
export const placedAmount = (res: any): number => {
  const n = toPay(res);
  if (n > 0) return n;
  const adv = Number(res?.advance?.amount) || 0;
  return adv > 0 ? adv : 0;
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
