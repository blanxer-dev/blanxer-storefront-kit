/**
 * Offers (stores with Blanxer's Offers plugin): types for the public offers API and helpers
 * to show what the server returns.
 *
 * The server prices everything. Nothing here computes a cart discount: totals, line savings,
 * gift lines, free delivery and code results all come from the quote
 * (`POST /public/promotions/:store_id/quote`). These helpers only pick out and label what
 * the quote already says, and turn an offer's public rules into display text (badges,
 * tier tables, the Offers page).
 *
 * Stores not on Offers (`enabled: false`) keep the coupon flow (`coupon.ts`) unchanged.
 */
import { formatCurrency } from './format.js';
import type { Advance } from './advance.js';
import type { CartItem, Loose, Store } from './types.js';

export type OfferKind = 'amount_off' | 'free_delivery' | 'bxgy' | 'tiers' | 'bundle' | 'gift';
export type OfferClass = 'product' | 'order' | 'delivery';
export type OfferMethod = 'automatic' | 'code';
export type OfferState = 'draft' | 'scheduled' | 'live' | 'ended' | 'paused' | 'archived';

/** How offers look on the website (`store.plugins[offers].details.display`). */
export interface OffersDisplay {
  badges: boolean;
  badge_style: 'pill' | 'square' | 'ribbon';
  badge_corner: 'top-left' | 'top-right';
  /** "bigger": % under Rs 100 of saving, rupees above */
  saving_as: 'bigger' | 'percent' | 'amount';
  /** `#rrggbb`, or `success` / `theme` (the store colour) */
  colors: { saving: string; bxgy: string; gift: string; bundle: string; tier: string };
  pdp_tiers: boolean;
  pdp_notes: boolean;
  pdp_bundle: boolean;
  pdp_delivery: boolean;
  cart_progress: boolean;
  cart_upsell: boolean;
  cart_savings: boolean;
  code_field: boolean;
  top_bar: boolean;
  offers_page: boolean;
  countdowns: boolean;
}

/** The server's defaults (backend `promotion/service/settings.ts`). */
export const DEFAULT_OFFERS_DISPLAY: OffersDisplay = {
  badges: true,
  badge_style: 'pill',
  badge_corner: 'top-left',
  saving_as: 'bigger',
  colors: { saving: 'success', bxgy: '#111827', gift: '#db2777', bundle: '#7c3aed', tier: '#0e7490' },
  pdp_tiers: true,
  pdp_notes: true,
  pdp_bundle: true,
  pdp_delivery: true,
  cart_progress: true,
  cart_upsell: true,
  cart_savings: true,
  code_field: true,
  top_bar: false,
  offers_page: true,
  countdowns: true,
};

/** Saved settings over the defaults (missing keys keep the default). */
export const offersDisplay = (s?: Partial<OffersDisplay> | null): OffersDisplay => ({
  ...DEFAULT_OFFERS_DISPLAY,
  ...(s || {}),
  colors: { ...DEFAULT_OFFERS_DISPLAY.colors, ...(s?.colors || {}) },
});

/** Which cart items an offer looks at. `variant_ids` empty = every variant. */
export interface OfferScope {
  type: 'all' | 'categories' | 'products';
  categories?: string[];
  products?: { product_id: string; variant_ids?: string[] }[];
}

export interface OfferItemRef {
  product_id: string;
  variant_id?: string | null;
  qty: number;
}

export interface OfferLevel {
  min: number;
  value_type: 'percent' | 'fixed';
  value: number;
}

/** One offer as shoppers may see it (`GET /public/promotions/:store_id`). Rules only, no counts. */
export interface PublicOffer extends Loose {
  id: string;
  title: string;
  description: string;
  kind: OfferKind;
  method: OfferMethod;
  /** the shared code, for public code offers */
  code: string | null;
  state: OfferState;
  starts_at: string | null;
  ends_at: string | null;
  channels: string[];
  display: { public?: boolean; badge?: string; top_bar?: boolean; offers_page?: boolean; countdown?: boolean; promo_link?: boolean };
  conditions: {
    min_amount: number | null;
    min_qty: number | null;
    payment: 'any' | 'cod' | 'online';
    places: string[];
    customers: 'everyone' | 'new' | 'members';
  };
  skip_on_sale: boolean;
  amount_off?: { value_type: 'percent' | 'fixed'; value: number; max_discount?: number | null; scope: OfferScope };
  free_delivery?: { value_type: 'percent' | 'fixed'; value: number; max_discount?: number | null };
  tiers?: { basis: 'qty' | 'amount'; scope: OfferScope; per_product?: boolean; levels: OfferLevel[] };
  bxgy?: {
    buy: { basis: 'qty' | 'amount'; min: number; scope: OfferScope };
    get: { qty: number; scope: OfferScope; value_type: 'free' | 'percent' | 'fixed'; value?: number; add?: { product_id: string; variant_id?: string | null } | null };
    repeat: boolean;
    max_free?: number | null;
  };
  bundle?: { items: OfferItemRef[]; price_type: 'price' | 'percent' | 'fixed'; value: number; max_sets?: number | null; slug?: string; image_url?: string };
  gift?: { trigger: { basis: 'amount' | 'products'; min_amount?: number; scope?: OfferScope; min_qty?: number }; items: OfferItemRef[]; auto_add: boolean };
}

/** `GET /public/promotions/:store_id` (and `/product/:product_id`). */
export interface OffersResponse {
  /** false: the store isn't on Offers; keep the coupon flow */
  enabled: boolean;
  data: PublicOffer[];
  settings: Partial<OffersDisplay>;
  server_time: string;
}

/** `POST /public/promotions/:store_id/quote` body. Ids and quantities only: the server prices. */
export interface QuoteRequest {
  /** `customization_charge`: per unit, as on create-order (counted in the advance's total) */
  products: { product: string; variant: string; quantity: number; customization_charge?: number }[];
  /** one code per order */
  code?: string;
  /** delivery place name (as in the delivery table); delivery offers wait for it */
  place?: string;
  payment?: 'cod' | 'online' | null;
  /** 10-digit phone, for once-per-customer and new-customer offers */
  phone?: string;
  /** automatic offers the shopper removed (e.g. a gift) */
  removed_offers?: string[];
  /** gift picked per offer id: `productId|variantId` */
  gift_choices?: Record<string, string>;
  delivery_charge?: number | null;
  /** legacy coupon `_id` (stores not on Offers: the advance is worked from the total after it) */
  coupon?: string;
}

export interface QuoteAllocation {
  promotion_id: string;
  amount: number;
}

export interface QuoteLine {
  key: string;
  product_id: string | null;
  variant_id: string | null;
  name: string;
  unit_price: number;
  qty: number;
  gross: number;
  allocations: QuoteAllocation[];
  promo_discount: number;
  net: number;
  /** units of this line that are free (gifts, free Y units) */
  free_qty: number;
  /** offer id when the server added this line (gift / free item): show it, never send it back */
  added_by?: string;
  image_url?: string;
  variant_name?: string;
}

export interface QuoteApplication {
  promotion_id: string;
  title: string;
  kind: OfferKind;
  class: OfferClass;
  method: OfferMethod;
  code?: string | null;
  amount: number;
  detail?: Record<string, any>;
}

export type QuoteRejectReason =
  | 'not_found'
  | 'not_active'
  | 'not_started'
  | 'ended'
  | 'used_up'
  | 'customer_used'
  | 'need_phone'
  | 'channel'
  | 'payment'
  | 'place'
  | 'customer'
  | 'min_amount'
  | 'min_qty'
  | 'no_items'
  | 'not_better'
  | 'one_code';

export interface QuoteCodeResult {
  code: string;
  status: 'applied' | 'rejected';
  reason?: QuoteRejectReason;
  /** what to show the shopper */
  message: string;
}

export interface QuoteMessage {
  type: 'upsell' | 'eligible' | 'applied' | 'rejected' | 'info';
  promotion_id?: string;
  kind?: OfferKind;
  /** show this text as is */
  text: string;
  /** upsell: remaining_amount / remaining_qty / next / threshold / free_missing / missing[] */
  data?: Record<string, any>;
}

export interface QuoteTotals {
  /** goods at full price, gift lines included */
  gross: number;
  product_discount: number;
  order_discount: number;
  /** product + order discounts (delivery discount is in `delivery.discount`) */
  promo_discount: number;
  /** gross − promo_discount */
  goods: number;
  /** delivery after offers; null until the place is known */
  delivery: number | null;
  /** goods + delivery (customization charges are not in the quote) */
  total: number;
}

export interface Quote {
  lines: QuoteLine[];
  applications: QuoteApplication[];
  code: QuoteCodeResult | null;
  delivery: { before: number | null; discount: number; after: number | null; promotion_id?: string; pending?: boolean };
  totals: QuoteTotals;
  messages: QuoteMessage[];
  server_time?: string;
  /**
   * Cash on delivery with part paid online first (backends from the advance-payment release);
   * null / absent = plain COD. Read it with `toAdvance` / `codOffer`.
   */
  advance?: Advance | null;
  /**
   * What the order will cost, as create-order prices it (newer backends): customization and a
   * member discount included. Show it (`quotePayable`) instead of adding customization yourself.
   */
  payable?: { customization?: number; member_discount?: number; total: number };
}

export interface QuoteResponse {
  enabled: boolean;
  data?: Quote;
}

/** `offers` on the create-order response (stores on Offers). */
export interface OrderOffers {
  applications: QuoteApplication[];
  code: QuoteCodeResult | null;
  totals: QuoteTotals;
}

// ---------------------------------------------------------------- store

/**
 * The `offers` plugin as the store document carries it, or null. A hint only (the store
 * document is cached); `enabled` from `GET /public/promotions` is what counts.
 */
export const offersPlugin = (store?: Partial<Store> | null): { enabled: boolean; display: OffersDisplay } | null => {
  const p = (store?.plugins || []).find((x) => x?.name === 'offers');
  if (!p) return null;
  return { enabled: p.details?.enabled !== false, display: offersDisplay(p.details?.display) };
};

// ---------------------------------------------------------------- quote request

/** Payment for the quote: COD → 'cod', any other method → 'online', none chosen → null. */
export const quotePayment = (method?: string | null): 'cod' | 'online' | null => (!method ? null : method === 'COD' ? 'cod' : 'online');

/** Upper-cased, trimmed code ('' when empty). */
export const normalizeCode = (code?: string | null): string => String(code || '').trim().toUpperCase();

const PHONE = /^\d{10}$/;

/** A line the server added (gift, free item). It is shown, never sent back. */
export const isAddedLine = (line: unknown): boolean => !!(line as any)?.added_by;

export interface QuoteRequestInput {
  /** cart lines (what the shopper picked); lines with `added_by` are dropped */
  lines: Array<Pick<CartItem, 'product' | 'variant' | 'quantity'> & { added_by?: string; customization_charge?: number }>;
  code?: string | null;
  place?: string | null;
  /** checkout payment method name (`COD`, `Esewa`, …) or '' */
  paymentMethod?: string | null;
  phone?: string | null;
  removedOffers?: string[];
  giftChoices?: Record<string, string>;
  /** legacy coupon `_id` (stores not on Offers, advance quote only) */
  coupon?: string | null;
}

/** The quote body for a cart. Only what the shopper picked: product ids, variants, quantities. */
export const buildQuoteRequest = (input: QuoteRequestInput): QuoteRequest => {
  const req: QuoteRequest = {
    products: input.lines
      .filter((l) => !isAddedLine(l) && l.product && Number(l.quantity) > 0)
      .map((l) => ({
        product: String(l.product),
        variant: String(l.variant || ''),
        quantity: Math.floor(Number(l.quantity)),
        // per-unit customization, as create-order takes it: the server counts it in the advance
        ...(Number(l.customization_charge) > 0 ? { customization_charge: Number(l.customization_charge) } : {}),
      })),
  };
  const code = normalizeCode(input.code);
  if (code) req.code = code;
  if (input.place) req.place = String(input.place);
  if (input.paymentMethod !== undefined) req.payment = quotePayment(input.paymentMethod);
  const phone = String(input.phone || '').trim();
  if (PHONE.test(phone)) req.phone = phone;
  if (input.removedOffers?.length) req.removed_offers = [...new Set(input.removedOffers)];
  if (input.giftChoices && Object.keys(input.giftChoices).length) req.gift_choices = { ...input.giftChoices };
  if (input.coupon) req.coupon = String(input.coupon);
  return req;
};

/** Stable key for a quote body (same cart, same answer): dedupe and stale checks. */
export const quoteKey = (req: QuoteRequest): string =>
  JSON.stringify([
    req.products.map((p) => [p.product, p.variant, p.quantity, p.customization_charge || 0]),
    req.code || '',
    req.place || '',
    req.payment ?? null,
    req.phone || '',
    [...(req.removed_offers || [])].sort(),
    Object.entries(req.gift_choices || {}).sort(),
    req.delivery_charge ?? null,
    req.coupon || '',
  ]);

/** The offers fields of a create-order body (`POST /order/:store_id`). */
export const offerOrderFields = (input: { code?: string | null; removedOffers?: string[]; giftChoices?: Record<string, string> }) => {
  const out: { code?: string; removed_offers?: string[]; gift_choices?: Record<string, string> } = {};
  const code = normalizeCode(input.code);
  if (code) out.code = code;
  if (input.removedOffers?.length) out.removed_offers = [...new Set(input.removedOffers)];
  if (input.giftChoices && Object.keys(input.giftChoices).length) out.gift_choices = { ...input.giftChoices };
  return out;
};

/** A rejected code at order time comes back as a field error `{ fields: { code } }`. */
export const codeFieldError = (err: unknown): string => {
  const fields = (err as any)?.fields || (err as any)?.body?.fields;
  return fields && typeof fields === 'object' && fields.code ? String(fields.code) : '';
};

// ---------------------------------------------------------------- stale responses

export type LatestResult<T> = { stale: false; value: T } | { stale: true };

/**
 * Keeps only the newest request: each `run` aborts the one before it, and a response that
 * arrives after a newer `run` started resolves as `{ stale: true }` (never shown).
 */
export const createLatest = <T>() => {
  let seq = 0;
  let controller: AbortController | null = null;
  return {
    run: async (fn: (signal: AbortSignal) => Promise<T>): Promise<LatestResult<T>> => {
      const mine = ++seq;
      controller?.abort();
      const c = typeof AbortController !== 'undefined' ? new AbortController() : (null as any);
      controller = c;
      try {
        const value = await fn(c?.signal);
        return mine === seq ? { stale: false, value } : { stale: true };
      } catch (e) {
        if (mine !== seq) return { stale: true };
        throw e;
      }
    },
    cancel: () => {
      seq++;
      controller?.abort();
      controller = null;
    },
  };
};

// ---------------------------------------------------------------- reading a quote

/** What the shopper saves: product + order offers + the delivery discount. */
export const quoteSavings = (quote?: Quote | null): number =>
  quote ? Math.max(0, (quote.totals?.promo_discount || 0) + (quote.delivery?.discount || 0)) : 0;

/** A server-added line that costs nothing (a free gift). */
export const isFreeLine = (line: QuoteLine): boolean => !!line.added_by && line.free_qty >= line.qty && line.net <= 0;

/** The quote line for a cart line (same product + variant, not server-added). */
export const quoteLineFor = (quote: Quote | null | undefined, item: Pick<CartItem, 'product' | 'variant'>): QuoteLine | undefined =>
  quote?.lines.find((l) => !l.added_by && String(l.product_id) === String(item.product) && String(l.variant_id || '') === String(item.variant || ''));

/** Lines the server added (gifts, free items), to show under the shopper's lines. */
export const addedLines = (quote?: Quote | null): QuoteLine[] => (quote?.lines || []).filter((l) => !!l.added_by);

/** The offers on one line, with the line's share of each (product offers only, for the line's label). */
export const lineOffers = (quote: Quote | null | undefined, line: QuoteLine | undefined) => {
  if (!quote || !line) return [];
  const byId = new Map(quote.applications.map((a) => [a.promotion_id, a]));
  return line.allocations
    .map((al) => ({ ...al, application: byId.get(al.promotion_id) }))
    .filter((x) => x.amount > 0 && x.application && x.application.class === 'product');
};

export interface SummaryRow {
  promotion_id: string;
  /** "Dashain 10% off · DASHAIN10" */
  label: string;
  amount: number;
  kind: OfferKind;
  class: OfferClass;
}

/** One row per product / order offer the quote applied, in the server's order. */
export const summaryRows = (quote?: Quote | null): SummaryRow[] =>
  (quote?.applications || [])
    .filter((a) => a.class !== 'delivery' && a.amount > 0)
    .map((a) => ({ promotion_id: a.promotion_id, label: a.code ? `${a.title} · ${a.code}` : a.title, amount: a.amount, kind: a.kind, class: a.class }));

/** Messages to show in the cart (upsells and "pick your gift"), server text as is. */
export const upsellMessages = (quote?: Quote | null): QuoteMessage[] =>
  (quote?.messages || []).filter((m) => m.type === 'upsell' || m.type === 'eligible');

/** Progress of one upsell message: from its `data` (`remaining_amount` against `threshold`). */
export const upsellProgress = (msg?: QuoteMessage | null, threshold?: number | null) => {
  const remaining = Number(msg?.data?.remaining_amount);
  const max = Number(msg?.data?.threshold ?? threshold);
  if (!Number.isFinite(remaining) || !Number.isFinite(max) || max <= 0) return null;
  const reached = Math.max(0, max - remaining);
  return { remaining, threshold: max, reached, fraction: Math.min(1, Math.max(0, reached / max)) };
};

export interface Milestone {
  promotion_id: string;
  kind: OfferKind;
  title: string;
  threshold: number;
  /** the quote applied it (free delivery may still wait for the place: `pending`) */
  done: boolean;
  pending: boolean;
  /** Rs still to add, from the server's upsell message (0 when done) */
  remaining: number;
  /** server text for what's missing, or '' */
  text: string;
}

const thresholdOf = (o: PublicOffer): number | null => {
  if (o.kind === 'gift' && o.gift?.trigger?.basis === 'amount') return Number(o.gift.trigger.min_amount) || null;
  if (o.kind === 'free_delivery' || (o.kind === 'amount_off' && o.method === 'automatic')) return o.conditions?.min_amount || null;
  return null;
};

/**
 * Spend milestones for the cart progress bar (free delivery, gifts, automatic amount-off
 * over Rs X), all read from the quote: done when the quote applied the offer, otherwise
 * the remaining amount from its upsell message. Offers the quote says nothing about (not
 * for this place, say) are left out.
 */
export const cartMilestones = (quote: Quote | null | undefined, offers: PublicOffer[]): Milestone[] => {
  if (!quote) return [];
  const applied = new Set([
    ...quote.applications.map((a) => a.promotion_id),
    ...quote.lines.map((l) => l.added_by).filter(Boolean),
    ...(quote.delivery?.promotion_id ? [quote.delivery.promotion_id] : []),
  ] as string[]);
  const out: Milestone[] = [];
  for (const o of offers) {
    if (o.method !== 'automatic' || o.state !== 'live') continue;
    const threshold = thresholdOf(o);
    if (!threshold) continue;
    if (applied.has(o.id)) {
      const pending = o.kind === 'free_delivery' && quote.delivery?.promotion_id === o.id && !!quote.delivery?.pending;
      out.push({ promotion_id: o.id, kind: o.kind, title: o.title, threshold, done: true, pending, remaining: 0, text: '' });
      continue;
    }
    const msg = quote.messages.find((m) => m.type === 'upsell' && m.promotion_id === o.id && m.data?.remaining_amount != null);
    const p = upsellProgress(msg, threshold);
    if (!msg || !p) continue;
    out.push({ promotion_id: o.id, kind: o.kind, title: o.title, threshold: p.threshold, done: false, pending: false, remaining: p.remaining, text: msg.text });
  }
  return out.sort((a, b) => a.threshold - b.threshold);
};

/**
 * One bar for all milestones: how far along the cart is towards the biggest one. The
 * position is the server's "counted so far" (threshold − remaining of an open milestone).
 */
export const milestoneBar = (milestones: Milestone[]) => {
  if (!milestones.length) return null;
  const max = milestones[milestones.length - 1]!.threshold;
  const open = milestones.find((m) => !m.done);
  const reached = open ? Math.max(0, open.threshold - open.remaining) : max;
  return { max, reached, fraction: Math.min(1, reached / max), allDone: !open };
};

// ---------------------------------------------------------------- products and offers

/** A product as listings and product pages carry it. */
export interface OfferProductRef {
  _id: string;
  price?: number | null;
  compare_at_price?: number | null;
  /** ids on product pages, names on listings */
  categories?: Array<string | null | undefined>;
  variants?: Array<{ _id?: string }>;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** A product's categories the way offers compare them (ids; names mapped through the store's categories). */
export const productCategoryKeys = (product: OfferProductRef, storeCategories: Array<{ _id: string; name?: string; slug?: string }> = []) => {
  const out = new Set<string>();
  for (const c of product.categories || []) {
    const n = norm(c);
    if (!n) continue;
    out.add(n);
    for (const sc of storeCategories) if (norm(sc._id) === n || norm(sc.name) === n || norm(sc.slug) === n) out.add(norm(sc._id));
  }
  return out;
};

/** Does the scope include any variant of the product (same rule as the server's)? */
export const scopeTouches = (scope: OfferScope | null | undefined, product: OfferProductRef, categories: Set<string>): boolean => {
  if (!scope || !product?._id) return false;
  if (scope.type === 'all') return true;
  if (scope.type === 'categories') return (scope.categories || []).some((c) => categories.has(norm(c)));
  const ids = (product.variants || []).map((v) => String(v?._id || '')).filter(Boolean);
  return (scope.products || []).some(
    (p) => String(p.product_id) === String(product._id) && (!p.variant_ids?.length || !ids.length || p.variant_ids.some((v) => ids.includes(String(v)))),
  );
};

/** How an offer involves this product (null: it doesn't, or it's order-wide). */
export type OfferRole = 'amount_off' | 'tiers' | 'bxgy' | 'bundle' | 'gift_item' | 'gift_trigger';

export const offerRole = (o: PublicOffer, product: OfferProductRef, categories: Set<string>): OfferRole | null => {
  const id = String(product._id);
  if (o.kind === 'amount_off' && o.amount_off && o.amount_off.scope?.type !== 'all') return scopeTouches(o.amount_off.scope, product, categories) ? 'amount_off' : null;
  if (o.kind === 'tiers' && o.tiers) return scopeTouches(o.tiers.scope, product, categories) ? 'tiers' : null;
  if (o.kind === 'bxgy' && o.bxgy) return scopeTouches(o.bxgy.buy.scope, product, categories) || scopeTouches(o.bxgy.get.scope, product, categories) ? 'bxgy' : null;
  if (o.kind === 'bundle' && o.bundle) return o.bundle.items.some((i) => String(i.product_id) === id) ? 'bundle' : null;
  if (o.kind === 'gift' && o.gift) {
    if (o.gift.items.some((i) => String(i.product_id) === id)) return 'gift_item';
    if (o.gift.trigger.basis === 'products' && scopeTouches(o.gift.trigger.scope, product, categories)) return 'gift_trigger';
  }
  return null;
};

/** Offers that touch one product, live first. Order-wide offers (codes, delivery) are left out. */
export const offersForProduct = (
  product: OfferProductRef,
  offers: PublicOffer[],
  storeCategories: Array<{ _id: string; name?: string; slug?: string }> = [],
) => {
  const cats = productCategoryKeys(product, storeCategories);
  return offers
    .map((offer) => ({ offer, role: offerRole(offer, product, cats) }))
    .filter((x): x is { offer: PublicOffer; role: OfferRole } => !!x.role)
    .sort((a, b) => Number(b.offer.state === 'live') - Number(a.offer.state === 'live'));
};

// ---------------------------------------------------------------- display text

const rs = (n: number) => `Rs ${formatCurrency(n)}`;

/** "10% off" / "Rs 200 off". */
export const valueText = (valueType: string, value: number) => (valueType === 'percent' ? `${value}% off` : `${rs(value)} off`);

/**
 * Badge wording for a saving, per `saving_as`. A label for an advertised rule, never a
 * price: the cart always shows the quote. "bigger" shows the percent while the rupee
 * figure on this price is under Rs 100, rupees from there.
 */
export const savingText = (valueType: 'percent' | 'fixed', value: number, price: number | null | undefined, savingAs: OffersDisplay['saving_as']) => {
  if (valueType === 'fixed') return savingAs === 'percent' && price ? `${Math.floor((value / price) * 100)}% off` : `Save ${rs(value)}`;
  if (savingAs === 'percent' || !price) return `${value}% off`;
  const amount = Math.floor((price * value) / 100);
  if (savingAs === 'amount') return `Save ${rs(amount)}`;
  return amount < 100 ? `${value}% off` : `Save ${rs(amount)}`;
};

export type BadgeTone = 'saving' | 'tier' | 'bxgy' | 'bundle' | 'gift';

export interface OfferBadge {
  offer_id: string;
  text: string;
  tone: BadgeTone;
}

/** "Buy 1 get 1 free", "Buy 2 get 1 at 50% off". */
export const bxgyText = (o: PublicOffer) => {
  const b = o.bxgy;
  if (!b) return o.title;
  const buy = b.buy.basis === 'qty' ? `Buy ${b.buy.min}` : `Spend ${rs(b.buy.min)}`;
  const get = b.get.value_type === 'free' ? `get ${b.get.qty} free` : `get ${b.get.qty} at ${valueText(b.get.value_type, b.get.value || 0)}`;
  return `${buy}, ${get}`;
};

/** "3 for Rs 2,600", "15% off the set", "Rs 300 off the set". */
export const bundleText = (o: PublicOffer) => {
  const b = o.bundle;
  if (!b) return o.title;
  const n = b.items.reduce((t, i) => t + (i.qty || 1), 0);
  if (b.price_type === 'price') return `${n} for ${rs(b.value)}`;
  return `${valueText(b.price_type === 'percent' ? 'percent' : 'fixed', b.value)} the set`;
};

/** "Buy 2 · save 10%" for the first tier. */
export const tierBadgeText = (o: PublicOffer) => {
  const first = o.tiers?.levels?.[0];
  if (!first) return o.title;
  const what = o.tiers!.basis === 'qty' ? `Buy ${first.min}` : `Spend ${rs(first.min)}`;
  return `${what} · save ${first.value_type === 'percent' ? `${first.value}%` : rs(first.value)}`;
};

/** Badges for a product card / product page, live offers only, at most `max`. */
export const productBadges = (
  product: OfferProductRef,
  offers: PublicOffer[],
  display: OffersDisplay,
  storeCategories: Array<{ _id: string; name?: string; slug?: string }> = [],
  max = 2,
): OfferBadge[] => {
  if (!display.badges) return [];
  const out: OfferBadge[] = [];
  for (const { offer: o, role } of offersForProduct(product, offers, storeCategories)) {
    if (o.state !== 'live') continue;
    const custom = String(o.display?.badge || '').trim();
    let b: OfferBadge | null = null;
    if (role === 'amount_off' && o.amount_off) b = { offer_id: o.id, tone: 'saving', text: custom || savingText(o.amount_off.value_type, o.amount_off.value, product.price, display.saving_as) };
    else if (role === 'tiers') b = { offer_id: o.id, tone: 'tier', text: custom || tierBadgeText(o) };
    else if (role === 'bxgy') b = { offer_id: o.id, tone: 'bxgy', text: custom || bxgyText(o) };
    else if (role === 'bundle') b = { offer_id: o.id, tone: 'bundle', text: custom || o.title };
    else if (role === 'gift_item') b = { offer_id: o.id, tone: 'gift', text: custom || 'Free gift' };
    else if (role === 'gift_trigger') b = { offer_id: o.id, tone: 'gift', text: custom || '+ Free gift' };
    if (b && !out.some((x) => x.text === b!.text)) out.push(b);
    if (out.length >= max) break;
  }
  return out;
};

/** The one-line hint under a card's price ("Buy 3, save 15%", "Free with orders over Rs 5,000"). */
export const productHint = (
  product: OfferProductRef,
  offers: PublicOffer[],
  storeCategories: Array<{ _id: string; name?: string; slug?: string }> = [],
): { text: string; tone: BadgeTone; upcoming: boolean } | null => {
  const hit = offersForProduct(product, offers, storeCategories)[0];
  if (!hit) return null;
  const { offer: o, role } = hit;
  const upcoming = o.state === 'scheduled';
  const from = upcoming && o.starts_at ? ` from ${shortDate(o.starts_at)}` : '';
  if (upcoming) return { text: `In ${o.title}${from}`, tone: role === 'bundle' ? 'bundle' : 'saving', upcoming };
  if (role === 'tiers' && o.tiers) {
    const top = o.tiers.levels[1] || o.tiers.levels[0];
    if (!top) return null;
    const what = o.tiers.basis === 'qty' ? `Buy ${top.min}` : `Spend ${rs(top.min)}`;
    return { text: `${what}, save ${top.value_type === 'percent' ? `${top.value}%` : rs(top.value)}`, tone: 'tier', upcoming };
  }
  if (role === 'bundle') return { text: `${o.title}: ${bundleText(o)}`, tone: 'bundle', upcoming };
  if (role === 'gift_item' && o.gift) {
    const t = o.gift.trigger;
    return { text: t.basis === 'amount' && t.min_amount ? `Free with orders over ${rs(t.min_amount)}` : `Free with ${o.title}`, tone: 'gift', upcoming };
  }
  if (role === 'bxgy') return { text: bxgyText(o), tone: 'bxgy', upcoming };
  if (role === 'amount_off' && o.amount_off) return { text: valueText(o.amount_off.value_type, o.amount_off.value), tone: 'saving', upcoming };
  return null;
};

export interface TierRow {
  min: number;
  /** "Buy 2", "Buy 5+", "Spend Rs 3,000" */
  label: string;
  /** "10% off" */
  value: string;
  /** the tier the quote applied */
  active: boolean;
}

/** Rows for a tier table. `active` comes from the quote's application detail, never from local maths. */
export const tierRows = (o: PublicOffer, quote?: Quote | null): TierRow[] => {
  const t = o.tiers;
  if (!t) return [];
  const applied = quote?.applications.find((a) => a.promotion_id === o.id)?.detail?.tier;
  return t.levels.map((lv, i) => {
    const last = i === t.levels.length - 1;
    const label = t.basis === 'qty' ? `Buy ${lv.min}${last && t.levels.length > 1 ? '+' : ''}` : `Spend ${rs(lv.min)}`;
    return { min: lv.min, label, value: valueText(lv.value_type, lv.value), active: !!applied && Number(applied.min) === lv.min };
  });
};

/** Big headline for an offer card ("10% OFF", "Free delivery", "2+ 10% · 3+ 15%", "+ Free gift", "3 for Rs 2,600"). */
export const offerHeadline = (o: PublicOffer): string => {
  if (o.kind === 'amount_off' && o.amount_off) return valueText(o.amount_off.value_type, o.amount_off.value).toUpperCase();
  if (o.kind === 'free_delivery' && o.free_delivery) {
    const f = o.free_delivery;
    return f.value_type === 'percent' && f.value >= 100 ? 'Free delivery' : `${valueText(f.value_type, f.value)} delivery`;
  }
  if (o.kind === 'tiers' && o.tiers)
    return o.tiers.levels
      .slice(0, 3)
      .map((l) => `${o.tiers!.basis === 'qty' ? `${l.min}+` : rs(l.min)} ${l.value_type === 'percent' ? `${l.value}%` : rs(l.value)}`)
      .join(' · ');
  if (o.kind === 'gift') return '+ Free gift';
  if (o.kind === 'bundle') return bundleText(o);
  if (o.kind === 'bxgy') return bxgyText(o);
  return o.title;
};

/** Small caps line over an offer card: "CODE · NEW CUSTOMERS", "AUTOMATIC", "BUNDLE". */
export const offerTagline = (o: PublicOffer): string => {
  const parts: string[] = [];
  if (o.kind === 'bundle') parts.push('Bundle');
  else if (o.kind === 'bxgy') parts.push(o.method === 'code' ? 'Code' : 'Buy X get Y');
  else parts.push(o.method === 'code' ? 'Code' : 'Automatic');
  if (o.conditions?.customers === 'new') parts.push('New customers');
  if (o.conditions?.customers === 'members') parts.push('Members');
  if (o.state === 'scheduled' && o.starts_at) parts.push(`From ${shortDate(o.starts_at)}`);
  return parts.join(' · ');
};

/** Plain-English conditions of an offer ("Orders over Rs 2,000. Up to Rs 500 off. Not on items already on sale."). */
export const offerConditionsText = (o: PublicOffer): string => {
  const parts: string[] = [];
  if (o.description) parts.push(o.description);
  if (o.conditions?.min_amount) parts.push(`Orders over ${rs(o.conditions.min_amount)}.`);
  if (o.conditions?.min_qty) parts.push(`${o.conditions.min_qty}+ items.`);
  const cap = o.amount_off?.max_discount;
  if (cap) parts.push(`Up to ${rs(cap)} off.`);
  if (o.conditions?.payment === 'cod') parts.push('Cash on delivery only.');
  if (o.conditions?.payment === 'online') parts.push('Online payment only.');
  if (o.conditions?.places?.length) parts.push(`Delivery to ${o.conditions.places.join(', ')}.`);
  if (o.conditions?.customers === 'new') parts.push('First order only.');
  if (o.skip_on_sale) parts.push('Not on items already on sale.');
  if (o.kind === 'gift' && o.gift?.trigger?.basis === 'amount' && o.gift.trigger.min_amount) parts.push(`Added to your bag at ${rs(o.gift.trigger.min_amount)}.`);
  if (o.kind === 'bundle' && o.bundle) parts.push(`${o.bundle.items.length} items together.`);
  if (o.kind === 'tiers' && o.tiers?.levels?.length) {
    const t = o.tiers;
    const lv = t.levels.map((l, i) => `${t.basis === 'qty' ? `${l.min}${i === t.levels.length - 1 && t.levels.length > 1 ? ' or more' : ''}` : rs(l.min)} for ${valueText(l.value_type, l.value)}`);
    parts.push(`${t.per_product ? 'Each product on its own' : 'Mix and match'}: ${lv.join(', ')}.`);
  }
  return parts.join(' ');
};

export type OfferGroup = 'codes' | 'bundles' | 'gifts' | 'delivery' | 'discounts';

/** Filter chip an offer belongs to on the Offers page. */
export const offerGroup = (o: PublicOffer): OfferGroup =>
  o.method === 'code' ? 'codes' : o.kind === 'bundle' ? 'bundles' : o.kind === 'gift' ? 'gifts' : o.kind === 'free_delivery' ? 'delivery' : 'discounts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Oct 31` (Nepal time). */
export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 345 * 60_000); // UTC+5:45
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** Offers the store shows in its top bar (setting on and the offer asks for it). */
export const topBarOffers = (offers: PublicOffer[], display: OffersDisplay) =>
  display.top_bar ? offers.filter((o) => o.state === 'live' && o.display?.top_bar) : [];

/** Offers for the Offers page: live, and coming soon (scheduled), each only if the offer allows it. */
export const offersPageLists = (offers: PublicOffer[]) => {
  const shown = offers.filter((o) => o.display?.offers_page !== false);
  return { live: shown.filter((o) => o.state === 'live'), soon: shown.filter((o) => o.state === 'scheduled') };
};

/** A badge colour setting as CSS (`success` and `theme` map to the kit's variables). */
export const badgeColor = (value?: string) =>
  value === 'success' ? 'var(--bx-success)' : value === 'theme' || !value ? 'var(--bx-primary)' : value;

// ---------------------------------------------------------------- orders (tracking)

export interface OrderOfferRow {
  promotion_id: string;
  /** "Buy more, save more · Kurtas · 15%", "Dashain 10% off · DASHAIN10" */
  label: string;
  amount: number;
  kind: OfferKind;
}

/**
 * What the offers did on a placed order (public order view), for tracking pages. null for
 * orders without offers (older orders): show their discount as before.
 * `other` is any discount on top of the offers (member tier, staff discount).
 */
export const orderOfferSummary = (order: any) => {
  const promos: any[] = Array.isArray(order?.promotions) ? order.promotions : [];
  if (!promos.length) return null;
  const rows: OrderOfferRow[] = promos
    .filter((p) => p?.class !== 'delivery' && Number(p?.amount) > 0)
    .map((p) => {
      const tier = p.detail?.tier;
      const tierText = tier ? ` · ${tier.value_type === 'percent' ? `${tier.value}%` : `${rs(Number(tier.value) || 0)} off`}` : '';
      return {
        promotion_id: String(p.promotion_id || ''),
        label: `${p.title || 'Offer'}${p.code ? ` · ${p.code}` : ''}${tierText}`,
        amount: Number(p.amount) || 0,
        kind: p.kind,
      };
    });
  const offered = rows.reduce((t, r) => t + r.amount, 0);
  const dValue = Number(order?.discount?.d_value) || 0;
  const before = order?.delivery_charge_before_promo;
  const after = Number(order?.delivery_charge) || 0;
  const waived = before != null && Number(before) > after ? Number(before) - after : 0;
  return {
    rows,
    /** discount beyond the offers (d_value carries both) */
    other: Math.max(0, Math.round((dValue - offered) * 100) / 100),
    delivery: { before: before != null ? Number(before) : null, after, waived },
  };
};

/** Free units on an order line (gifts, free Y units). */
export const orderLineFree = (line: any) => {
  const qty = Number(line?.quantity) || 0;
  const free = Math.min(qty, Number(line?.free_qty) || 0);
  return { free, allFree: qty > 0 && free >= qty };
};

// ---------------------------------------------------------------- unavailable endpoints

/** `GET /public/promotions` answer, or null when it isn't one (an HTML page, an older backend). */
export const offersResponseOf = (raw: unknown): OffersResponse | null => {
  const r = raw as any;
  if (!r || typeof r !== 'object' || typeof r.enabled !== 'boolean') return null;
  return {
    enabled: r.enabled,
    data: r.enabled && Array.isArray(r.data) ? r.data : [],
    settings: r.settings && typeof r.settings === 'object' ? r.settings : {},
    server_time: typeof r.server_time === 'string' ? r.server_time : new Date().toISOString(),
  };
};

/** The quote from a `POST …/quote` answer; null when the store isn't on Offers or it isn't a quote. */
export const quoteOf = (raw: unknown): Quote | null => {
  const r = raw as any;
  const d = r?.data;
  if (!r || typeof r !== 'object' || r.enabled !== true || !d || !Array.isArray(d.lines) || !d.totals) return null;
  return d as Quote;
};

/** Offers off, as for a store not on Offers. */
export const OFFERS_OFF: OffersResponse = { enabled: false, data: [], settings: {}, server_time: '' };
