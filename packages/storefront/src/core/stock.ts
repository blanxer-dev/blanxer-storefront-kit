/**
 * Stock the server refused (stock-oversell api-contract §2, §4, §9). Pure helpers only, ported
 * from the Blanxer storefront's `src/features/checkout/stock.ts` (same names, same words; tested
 * in test/stock.test.ts). Kit changes: `toStockRefusal` also reads a `BlanxerApiError`'s `body`,
 * and `CapLine` is the kit's `CartItem` (bundle lines are optional).
 *
 * The server decides every number: create-order and every payment start / retry answer 400
 * `{ message, stock_error: { code, lines[{ name, variant_name, wanted, available }] } }` when the
 * stock is gone, and `POST /order/public/stock-check` says how many of each line this checkout
 * can have. The page shows the server's message, caps the cart at the server's `available`
 * (removing a line at 0) and never starts a payment for an order the server refused. Nothing
 * here works out stock by itself.
 */

/** What the shopper can be told (staff-only codes such as NO_STOCK_TO_CONFIRM are not here). */
export type StockCode = 'SOLD_OUT' | 'STOCK_HELD' | 'OUT_OF_STOCK';
const CODES: StockCode[] = ['SOLD_OUT', 'STOCK_HELD', 'OUT_OF_STOCK'];

/** One short line, as the server sends it (§2). */
export interface StockLine {
  product_id: string;
  variant_id: string | null;
  name: string;
  variant_name: string;
  wanted: number;
  available: number;
}

export interface StockRefusal {
  code: StockCode;
  /** the server's words, shown as they came ("Sorry, Hot-water bag just sold out. You were not charged.") */
  message: string;
  lines: StockLine[];
  /** STOCK_HELD: when "Try again" is worth it */
  retry_after_seconds: number | null;
  /** a payment start: the order it refused (the old order stays Inactive and is abandoned) */
  order_id: string | null;
  order_number: string | null;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const whole = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/** "Hot-water bag (Red)" */
export const stockLineName = (l: Pick<StockLine, 'name' | 'variant_name'>) =>
  `${l.name || 'An item'}${l.variant_name ? ` (${l.variant_name})` : ''}`;

const listNames = (lines: Pick<StockLine, 'name' | 'variant_name'>[]) => {
  const names = lines.map(stockLineName);
  if (names.length <= 1) return names[0] || 'An item';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * The words when the server sent none (an older proxy, a cut answer): the contract's sentences,
 * built from the server's lines.
 */
export const stockWords = (code: StockCode, lines: StockLine[], retry_after_seconds?: number | null): string => {
  const names = listNames(lines);
  if (code === 'STOCK_HELD') {
    const mins = Math.max(1, Math.round((retry_after_seconds || 120) / 60));
    return `The last units of ${names} are in other shoppers' checkouts right now. Please try again in about ${mins} minute${mins === 1 ? '' : 's'}. You were not charged.`;
  }
  if (code === 'SOLD_OUT') return `Sorry, ${names} just sold out. You were not charged.`;
  const l = lines[0];
  if (lines.length === 1 && l && l.available > 0) return `Only ${l.available} of ${stockLineName(l)} left.`;
  return `Sorry, ${names} ${lines.length > 1 ? 'are' : 'is'} out of stock.`;
};

/**
 * A stock refusal from a create-order or payment-start error: the kit's `BlanxerApiError` (its
 * `body`), the JSON body itself, or an axios-style `response.data` / `data`. Anything else (a
 * phone error, a staff-only code such as NO_STOCK_TO_CONFIRM) is null and handled as before.
 */
export const toStockRefusal = (err: unknown): StockRefusal | null => {
  const e = err as any;
  const body: any = e?.stock_error ? e : e?.body?.stock_error ? e.body : e?.response?.data ?? e?.data;
  const se = body?.stock_error;
  if (!se || typeof se !== 'object' || !CODES.includes(se.code)) return null;
  const lines: StockLine[] = (Array.isArray(se.lines) ? se.lines : []).map((l: any) => ({
    product_id: str(l?.product_id),
    variant_id: l?.variant_id ? String(l.variant_id) : null,
    name: str(l?.name),
    variant_name: str(l?.variant_name),
    wanted: whole(l?.wanted),
    available: whole(l?.available),
  }));
  const retry = Number(se.retry_after_seconds);
  const retry_after_seconds = se.code === 'STOCK_HELD' ? (Number.isFinite(retry) && retry > 0 ? retry : 120) : null;
  const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : stockWords(se.code, lines, retry_after_seconds);
  return {
    code: se.code,
    message,
    lines,
    retry_after_seconds,
    order_id: se.order_id ? String(se.order_id) : null,
    order_number: se.order_number !== undefined && se.order_number !== null && se.order_number !== '' ? String(se.order_number) : null,
  };
};

/**
 * A refused payment start ends that order for this shopper (SOLD_OUT / OUT_OF_STOCK: forget it,
 * place a new one from the changed cart); STOCK_HELD keeps it: "Try again" on the same order
 * after `retry_after_seconds`.
 */
export const refusalEndsOrder = (r: StockRefusal) => r.code !== 'STOCK_HELD';

/** The notice's heading; the server's message is the text under it. */
export const stockNoticeTitle = (code: StockCode) =>
  code === 'STOCK_HELD' ? 'In other shoppers\' checkouts' : code === 'SOLD_OUT' ? 'Just sold out' : 'Not enough in stock';

/**
 * Seconds left of a STOCK_HELD wait kept per order (`{ [order_id]: until ms }`): every "Try again"
 * / "Pay" for that order waits for it, not only the notice's own button.
 */
export const stockWaitLeft = (waits: Record<string, number> | null | undefined, order_id: string, now: number) => {
  const until = Number(waits?.[order_id]);
  return Number.isFinite(until) && until > now ? Math.ceil((until - now) / 1000) : 0;
};

/** "Try again in 1:58" while the server's wait runs, then "Try again". */
export const retryLabel = (secondsLeft: number) => {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return s > 0 ? `Try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Try again';
};

/** What a line says in the notice: "Sold out" / "Only 1 left" / "In other checkouts" (STOCK_HELD). */
export const stockLineLeft = (l: Pick<StockLine, 'available'>, code?: StockCode) =>
  l.available > 0 ? `Only ${l.available} left` : code === 'STOCK_HELD' ? 'In other checkouts' : 'Sold out';

// ── capping the cart at what the server allows ───────────────────────────────────────────────

/** A cart line as these helpers need it (the kit's `CartItem` fits; `bundle_parts` only on sites with bundle lines). */
export interface CapLine {
  id: string;
  product: string;
  variant?: string | null;
  quantity: number;
  product_name?: string;
  variant_name?: string;
  bundle_parts?: { name: string; variant_name?: string; qty: number }[];
}

/** product + variant, the key every cap is kept under. */
export const stockKey = (product: unknown, variant?: unknown) => `${str(product)}|${str(variant)}`;
const nameKey = (name: unknown, variant_name?: unknown) => `${str(name).trim().toLowerCase()}|${str(variant_name).trim().toLowerCase()}`;

/**
 * The most this checkout may have of each product / variant: the server's `available` (never
 * worked out here). `byName` lets a bundle line (whose items the cart knows only by name) find
 * the item the server named.
 */
export interface StockCaps {
  units: Map<string, number>;
  byName: Map<string, string>;
}

export const noCaps = (): StockCaps => ({ units: new Map(), byName: new Map() });

/** Caps from a refusal's lines (each line: at most its `available`). */
export const capsFromRefusal = (r: Pick<StockRefusal, 'lines'> | null): StockCaps => {
  const caps = noCaps();
  for (const l of r?.lines || []) {
    const k = stockKey(l.product_id, l.variant_id);
    caps.units.set(k, Math.min(caps.units.get(k) ?? Number.POSITIVE_INFINITY, l.available));
    if (l.name) caps.byName.set(nameKey(l.name, l.variant_name), k);
  }
  return caps;
};

/**
 * The order of this cart that waits for its payment, sent with the stock check (contract v1.2) so
 * its own hold isn't counted against the shopper; the proof is the one release-hold takes: the
 * last attempt's transaction, else the order's 10-digit phone (a wrong one: all holds count).
 */
export interface WaitingProof {
  order_id: string;
  transaction_id?: string;
  phone_number?: string;
}

/** The proof to send, or null when there is none (then the check is not made while it waits). */
export const waitingProof = (order_id: string | null | undefined, transaction?: string | null, phone?: string | null): WaitingProof | null => {
  if (!order_id) return null;
  if (transaction) return { order_id, transaction_id: String(transaction) };
  const p = String(phone || '').trim();
  return /^[0-9]{10}$/.test(p) ? { order_id, phone_number: p } : null;
};

/**
 * `POST /order/public/stock-check` body (§9): one line per product / variant, quantities summed;
 * with the waiting order and its proof when one waits.
 */
export const stockCheckBody = (store_id: string, lines: Pick<CapLine, 'product' | 'variant' | 'quantity'>[], waiting?: WaitingProof | null) => {
  const sum = new Map<string, { product: string; variant?: string; quantity: number }>();
  for (const l of lines) {
    if (!l?.product) continue;
    const k = stockKey(l.product, l.variant);
    const prev = sum.get(k);
    if (prev) prev.quantity += whole(l.quantity);
    else sum.set(k, { product: String(l.product), ...(l.variant ? { variant: String(l.variant) } : {}), quantity: whole(l.quantity) });
  }
  return { store_id, lines: [...sum.values()], ...(waiting ? waiting : {}) };
};

/**
 * Caps from the stock-check answer: `available` for stop-selling lines; `null` /
 * `continue_selling` lines have no cap. An unexpected answer (an older backend) caps nothing.
 */
export const capsFromCheck = (answer: any): StockCaps => {
  const caps = noCaps();
  const lines = Array.isArray(answer?.lines) ? answer.lines : Array.isArray(answer?.data?.lines) ? answer.data.lines : [];
  for (const l of lines) {
    if (l?.continue_selling === true || l?.available === null || l?.available === undefined) continue;
    const n = Number(l.available);
    if (!Number.isFinite(n)) continue;
    caps.units.set(stockKey(l.product, l.variant), Math.max(0, Math.floor(n)));
  }
  return caps;
};

/** One line the cap changed: `to` 0 = removed. */
export interface CartChange {
  id: string;
  name: string;
  from: number;
  to: number;
  /** the server's `available` for it */
  available: number;
}

/**
 * The cart with every line held to the server's caps: lines of the same product / variant share
 * its units in cart order; a bundle line takes whole sets of its capped items; a line left with
 * 0 is removed. Lines with no cap stay as they are.
 */
export const capCart = <T extends CapLine>(lines: T[], caps: StockCaps): { lines: T[]; changes: CartChange[] } => {
  const left = new Map(caps.units);
  const changes: CartChange[] = [];
  const out: T[] = [];
  const name = (l: T) => `${l.product_name || 'An item'}${l.variant_name ? ` (${l.variant_name})` : ''}`;
  for (const l of lines) {
    const want = whole(l.quantity);
    let allowed = want;
    let available = Number.POSITIVE_INFINITY;
    const k = stockKey(l.product, l.variant);
    if (left.has(k)) {
      available = caps.units.get(k)!;
      allowed = Math.min(allowed, left.get(k)!);
    }
    const parts = (l.bundle_parts || [])
      .map((p) => ({ key: caps.byName.get(nameKey(p.name, p.variant_name)), per: Math.max(1, whole(p.qty)) }))
      .filter((p): p is { key: string; per: number } => !!p.key && left.has(p.key));
    for (const p of parts) {
      allowed = Math.min(allowed, Math.floor(left.get(p.key)! / p.per));
      available = Math.min(available, Math.floor(caps.units.get(p.key)! / p.per));
    }
    if (left.has(k)) left.set(k, left.get(k)! - allowed);
    for (const p of parts) left.set(p.key, left.get(p.key)! - allowed * p.per);
    if (allowed < want) changes.push({ id: l.id, name: name(l), from: want, to: allowed, available: Number.isFinite(available) ? available : allowed });
    if (allowed > 0) out.push(allowed === want ? l : { ...l, quantity: allowed });
  }
  return { lines: out, changes };
};

/**
 * Whether "+" may add one more of this line: the cart's total of its product / variant is below
 * the server's cap (no cap: always). Never a number worked out here.
 */
export const canAddOne = (line: CapLine, cart: CapLine[], caps: StockCaps): boolean => {
  const k = stockKey(line.product, line.variant);
  const cap = caps.units.get(k);
  if (cap === undefined) return true;
  const inCart = cart.filter((l) => stockKey(l.product, l.variant) === k).reduce((s, l) => s + whole(l.quantity), 0);
  return inCart < cap;
};

/** The server's cap for a line ("Only 2 left" under it in the cart), or null. */
export const lineCap = (line: CapLine, caps: StockCaps): number | null => {
  const cap = caps.units.get(stockKey(line.product, line.variant));
  return cap === undefined ? null : cap;
};

/**
 * The notice for a cart the stock check had to change before Place order (no order was made):
 * the changed lines as the server's numbers, in the contract's words.
 */
export const refusalFromChanges = (changes: CartChange[]): StockRefusal | null => {
  if (!changes.length) return null;
  const lines: StockLine[] = changes.map((c) => ({ product_id: '', variant_id: null, name: c.name, variant_name: '', wanted: c.from, available: c.available }));
  return { code: 'OUT_OF_STOCK', message: stockWords('OUT_OF_STOCK', lines), lines, retry_after_seconds: null, order_id: null, order_number: null };
};

// ── the track page (§4) ──────────────────────────────────────────────────────────────────────

/** Why a paid order is short (contract §1); the public read sends only `{ state, reason }`. */
export type StockShortReason = 'paid_no_stock' | 'paid_after_cancel' | 'received_only' | 'retries_ran_out';

/** `stock_short` on the public order read (`GET /order/public/:store/id/:order`). */
export interface PublicStockShort {
  state: 'open' | 'resolved';
  reason: StockShortReason | (string & {});
}

/**
 * What the track page tells the shopper about a paid order whose stock was gone (the public read
 * sends only `stock_short: { state, reason }`): paid after it was cancelled → the contract's
 * words; paid but out of stock → that the store will be in touch. Nothing once resolved.
 */
export const stockShortNote = (o: any): string | null => {
  const s = o?.stock_short;
  if (!s || s.state !== 'open') return null;
  if (s.reason === 'paid_after_cancel' || s.reason === 'received_only')
    return 'We received your payment, but this order was cancelled. The store will refund you.';
  if (s.reason === 'paid_no_stock')
    return 'We received your payment, but an item in this order sold out. The store will contact you to refund you or change the order.';
  return null;
};
