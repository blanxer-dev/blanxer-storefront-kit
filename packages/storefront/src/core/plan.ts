/**
 * Selling online from several stores ("pooled", backend contract plans/multi-outlet §4). A pooled
 * store's website stock is the sum of the stores it sells from, and one checkout may arrive in
 * several parcels, each sent by its own store with its own delivery charge. The browser can't
 * work that out, so a pooled store prices checkout with the server's checkout plan
 * (`POST /order/public/checkout-plan`) instead of `computeDelivery`, and sends the plan's id on
 * create ("the quoted charge is final"). Every other store keeps today's path untouched: nothing
 * here runs unless `check_domain` says `online_fulfilment.checkout_plan`.
 */
import type { Advance } from './advance.js';
import { toAdvance } from './advance.js';
import { isAddedLine, normalizeCode, quotePayment, type OrderOffers, type Quote } from './offers.js';
import type { CartItem, Store } from './types.js';

type Money = (n: number) => string;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

// ---------------------------------------------------------------- the store setting

/** `check_domain` `online_fulfilment` (backends from the multi-outlet release; absent before = not pooled). */
export interface OnlineFulfilment {
  pooled: boolean;
  /** what the stock number on products means: the stores' total, or the website store only */
  display_stock: 'combined' | 'website_outlet';
  /** the product page lists the stores that have it ("Available at Pokhara, Butwal"), bands only */
  show_stores: boolean;
  /** true: the client MUST price checkout with the checkout plan */
  checkout_plan: boolean;
}

export const NOT_POOLED: OnlineFulfilment = { pooled: false, display_stock: 'website_outlet', show_stores: false, checkout_plan: false };

/** The store's `online_fulfilment`, with today's values when it isn't there. */
export const onlineFulfilmentOf = (store?: Partial<Store> | null): OnlineFulfilment => {
  const o = (store as any)?.online_fulfilment;
  if (!o || typeof o !== 'object') return NOT_POOLED;
  return {
    pooled: o.pooled === true,
    display_stock: o.display_stock === 'combined' ? 'combined' : 'website_outlet',
    show_stores: o.show_stores === true,
    checkout_plan: o.checkout_plan === true,
  };
};

/** Checkout is priced by the server's plan (a pooled store). False = today's `computeDelivery`. */
export const usesCheckoutPlan = (store?: Partial<Store> | null): boolean => onlineFulfilmentOf(store).checkout_plan;

/** The product page may list the stores that have it. */
export const showsStores = (store?: Partial<Store> | null): boolean => onlineFulfilmentOf(store).show_stores;

// ---------------------------------------------------------------- the plan

export interface CheckoutPlanRequest {
  store_id: string;
  products: { product: string; variant: string; quantity: number; customization_charge: number; bundle_picks: any[] }[];
  /** the customer's city (`customer_address_city`), also on a pickup: the server matches it on create */
  place: string;
  payment: 'cod' | 'online';
  fulfilment: 'delivery' | 'pickup';
  pickup_outlet: string | null;
  code: string;
  coupon: string;
  gift_choices: Record<string, string>;
  removed_offers: string[];
  phone: string;
}

export interface CheckoutPlanInput {
  storeId: string;
  /** the lines being checked out; lines the server added (`added_by`) are never sent */
  lines: Array<Pick<CartItem, 'product' | 'variant' | 'quantity'> & { added_by?: string; customization_charge?: number; bundle_picks?: any[] }>;
  place?: string | null;
  /** the picked method (`COD`, `Esewa`, …); nothing picked yet = cod */
  paymentMethod?: string | null;
  /** a store pickup: the outlet's `_id` */
  pickupOutlet?: string | null;
  /** stores on Offers: the code, removed offers and gift picks */
  offers?: { code?: string | null; removedOffers?: string[]; giftChoices?: Record<string, string> } | null;
  /** stores not on Offers: the applied coupon's `_id` */
  coupon?: string | null;
  phone?: string | null;
}

/** The checkout-plan body. Same lines, place, fulfilment and pickup outlet as the order body will carry. */
export const checkoutPlanBody = (input: CheckoutPlanInput): CheckoutPlanRequest => {
  const phone = str(input.phone).trim();
  const offers = input.offers || null;
  return {
    store_id: str(input.storeId),
    products: input.lines
      .filter((l) => !isAddedLine(l) && l.product && Number(l.quantity) > 0)
      .map((l) => ({
        product: str(l.product),
        variant: str(l.variant),
        quantity: Math.floor(Number(l.quantity)),
        customization_charge: num(l.customization_charge) > 0 ? num(l.customization_charge) : 0,
        bundle_picks: Array.isArray(l.bundle_picks) ? l.bundle_picks : [],
      })),
    place: str(input.place),
    payment: quotePayment(input.paymentMethod) || 'cod',
    fulfilment: input.pickupOutlet ? 'pickup' : 'delivery',
    pickup_outlet: input.pickupOutlet ? str(input.pickupOutlet) : null,
    code: offers ? normalizeCode(offers.code) : '',
    coupon: offers ? '' : str(input.coupon),
    gift_choices: offers?.giftChoices ? { ...offers.giftChoices } : {},
    removed_offers: offers?.removedOffers?.length ? [...new Set(offers.removedOffers)] : [],
    phone: /^\d{10}$/.test(phone) ? phone : '',
  };
};

/** Stable key for a plan body (same cart, same answer). */
export const checkoutPlanKey = (b: CheckoutPlanRequest): string =>
  JSON.stringify([
    b.store_id,
    b.products.map((p) => [p.product, p.variant, p.quantity, p.customization_charge, p.bundle_picks]),
    b.place,
    b.payment,
    b.fulfilment,
    b.pickup_outlet,
    b.code,
    b.coupon,
    Object.entries(b.gift_choices).sort(),
    [...b.removed_offers].sort(),
    b.phone,
  ]);

export interface PlanLine {
  product: string;
  variant: string;
  name: string;
  variant_name?: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  gift?: boolean;
  bundle?: any;
}

export interface PlanParcel {
  /** 1-based; parcel 1 carries the checkout's order number */
  index: number;
  outlet: { _id: string; name: string; city?: string };
  lines: PlanLine[];
  weight: number;
  goods: number;
  customization: number;
  /** this parcel's share of the order discount */
  discount: number;
  /** this location's charge before / after delivery offers */
  delivery_base: number;
  delivery: number;
  total: number;
  /** this parcel's share of the advance */
  advance: number;
  cod_to_collect: number;
}

/** `POST /order/public/checkout-plan` `data` (contract §4.3). */
export interface CheckoutPlan {
  /** pass on create as `checkout_plan_id` (valid 30 minutes) */
  plan_id: string;
  expires_at: string;
  pooled: boolean;
  /** more than one parcel */
  split: boolean;
  place: string;
  cod_available: boolean;
  parcels: PlanParcel[];
  totals: { goods: number; customization: number; discount: number; member_discount: number; delivery_base: number; delivery: number; total: number };
  /** "Delivery: Pokhara Rs 150 · Butwal free" */
  delivery_label: string;
  /** what the offers did (stores on Offers), else null */
  offers: OrderOffers | null;
  /** the checkout's advance (null = plain COD); `parcels[].advance` is each order's share */
  advance: Advance | null;
  payable: { total: number };
}

const toParcel = (raw: any, i: number): PlanParcel => ({
  index: num(raw?.index) || i + 1,
  outlet: { _id: str(raw?.outlet?._id), name: str(raw?.outlet?.name), ...(raw?.outlet?.city ? { city: str(raw.outlet.city) } : {}) },
  lines: (Array.isArray(raw?.lines) ? raw.lines : []).map((l: any) => ({
    product: str(l?.product),
    variant: str(l?.variant),
    name: str(l?.name),
    ...(l?.variant_name ? { variant_name: str(l.variant_name) } : {}),
    quantity: num(l?.quantity),
    unit_price: num(l?.unit_price),
    line_total: num(l?.line_total),
    gift: l?.gift === true,
    bundle: l?.bundle ?? null,
  })),
  weight: num(raw?.weight),
  goods: num(raw?.goods),
  customization: num(raw?.customization),
  discount: num(raw?.discount),
  delivery_base: num(raw?.delivery_base),
  delivery: num(raw?.delivery),
  total: num(raw?.total),
  advance: num(raw?.advance),
  cod_to_collect: num(raw?.cod_to_collect),
});

/** A checkout plan from the API (`{ success, data }` or the data itself), or null when it isn't one. */
export const toCheckoutPlan = (raw: any): CheckoutPlan | null => {
  const d = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' && !raw.plan_id ? raw.data : raw;
  if (!d || typeof d !== 'object' || !d.plan_id || !Array.isArray(d.parcels) || !d.parcels.length) return null;
  const parcels = (d.parcels as any[]).map(toParcel).sort((a, b) => a.index - b.index);
  const t = d.totals || {};
  const totals = {
    goods: num(t.goods),
    customization: num(t.customization),
    discount: num(t.discount),
    member_discount: num(t.member_discount),
    delivery_base: num(t.delivery_base),
    delivery: num(t.delivery),
    total: num(t.total),
  };
  const payable = typeof d.payable?.total === 'number' ? num(d.payable.total) : totals.total;
  return {
    plan_id: str(d.plan_id),
    expires_at: str(d.expires_at),
    pooled: d.pooled === true,
    split: parcels.length > 1,
    place: str(d.place),
    cod_available: d.cod_available !== false,
    parcels,
    totals,
    delivery_label: str(d.delivery_label),
    offers: d.offers && typeof d.offers === 'object' ? d.offers : null,
    advance: toAdvance(d.advance),
    payable: { total: payable },
  };
};

/** The checkout's delivery from the plan (the sum of each location's charge). */
export const planDelivery = (plan: CheckoutPlan): { charge: number; before: number; cod: boolean } => ({
  charge: plan.totals.delivery,
  before: plan.totals.delivery_base,
  cod: plan.cod_available,
});

/**
 * A store on Offers: the cart quote with the plan's delivery, advance and total. The goods,
 * offers and code stay the quote's; only what depends on where the parcels come from is the
 * plan's. No plan (not pooled, or no answer yet) = the quote as it is.
 */
export const withPlan = (quote: Quote | null, plan: CheckoutPlan | null | undefined): Quote | null => {
  if (!quote || !plan) return quote;
  const before = plan.totals.delivery_base;
  const after = plan.totals.delivery;
  return {
    ...quote,
    delivery: { ...quote.delivery, before, after, discount: Math.max(0, before - after), pending: false },
    totals: { ...quote.totals, delivery: after, total: quote.totals.goods + after },
    advance: plan.advance,
    payable: { ...(quote.payable || {}), total: plan.payable.total },
  };
};

/** "Kurta (M) ×2" */
export const planLineName = (l: Pick<PlanLine, 'name' | 'variant_name' | 'quantity'>): string =>
  `${l.name}${l.variant_name ? ` (${l.variant_name})` : ''}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`;

export interface ParcelRow {
  index: number;
  /** the store it ships from */
  from: string;
  /** "Kurta (M) ×2, Shirt" */
  items: string;
  delivery: number;
}

/** One row per parcel for the summary: where it ships from, what is in it, its delivery. */
export const parcelRows = (plan: CheckoutPlan | null | undefined): ParcelRow[] =>
  (plan?.parcels || []).map((p) => ({
    index: p.index,
    from: p.outlet.name || `Parcel ${p.index}`,
    items: p.lines.map(planLineName).join(', '),
    delivery: p.delivery,
  }));

/** "Arrives in 2 parcels", or '' for one parcel (shown as today). */
export const parcelsTitle = (plan: CheckoutPlan | null | undefined): string =>
  plan && plan.parcels.length > 1 ? `Arrives in ${plan.parcels.length} parcels` : '';

/**
 * The delivery per location: "Pokhara Rs 150 · Butwal free". The server's `delivery_label`
 * ("Delivery: …") when it sends one, else built from the parcels. '' for one parcel.
 */
export const deliveryByLocation = (plan: CheckoutPlan | null | undefined, money: Money): string => {
  if (!plan || plan.parcels.length < 2) return '';
  const server = plan.delivery_label.replace(/^\s*delivery\s*:\s*/i, '').trim();
  if (server) return server;
  return plan.parcels.map((p) => `${p.outlet.name || `Parcel ${p.index}`} ${p.delivery > 0 ? money(p.delivery) : 'free'}`).join(' · ');
};

/** The create-order field for a plan (none without one: the server works a plan out itself). */
export const planOrderFields = (planId?: string | null): { checkout_plan_id?: string } =>
  planId ? { checkout_plan_id: String(planId) } : {};

/**
 * Create refused because the plan is gone or no longer matches the cart (409
 * `CHECKOUT_PLAN_STALE`): the server's words and its fresh plan. Show the new total and let the
 * shopper place again with the fresh `plan_id`; never place on their behalf at a new price.
 */
export const staleCheckoutPlan = (err: unknown): { message: string; plan: CheckoutPlan | null } | null => {
  const e = err as any;
  const body = e?.body ?? e?.response?.data ?? null;
  const status = e?.status ?? e?.response?.status;
  if (!body || typeof body !== 'object' || body.error_code !== 'CHECKOUT_PLAN_STALE') return null;
  if (status != null && Number(status) !== 409) return null;
  return {
    message: str(body.message) || 'Your delivery details changed. Please check the new total.',
    plan: toCheckoutPlan(body.plan),
  };
};

/** What changed between the plan the shopper saw and the fresh one, in words. */
export const planChanges = (before: CheckoutPlan | null | undefined, after: CheckoutPlan | null | undefined, money: Money): string[] => {
  if (!after) return [];
  const out: string[] = [];
  if (before && before.parcels.length !== after.parcels.length) {
    out.push(after.parcels.length > 1 ? `Now arrives in ${after.parcels.length} parcels (was ${before.parcels.length}).` : `Now arrives in one parcel (was ${before.parcels.length}).`);
  }
  if (before && before.totals.delivery !== after.totals.delivery) {
    out.push(`Delivery: ${money(after.totals.delivery)} (was ${money(before.totals.delivery)}).`);
  }
  if (!before || before.payable.total !== after.payable.total) {
    out.push(before ? `Total: ${money(after.payable.total)} (was ${money(before.payable.total)}).` : `Total: ${money(after.payable.total)}.`);
  }
  return out;
};

// ---------------------------------------------------------------- after create

/** `checkout_group` on a create answer or an order read. null when the checkout wasn't split. */
export interface CheckoutGroup {
  id: string;
  count: number;
  reason: string;
  /** on order reads: this order's place in the checkout */
  index?: number;
}

/** One order of a split checkout, as create-order lists it (`orders[]`). */
export interface CheckoutOrderRow {
  _id: string;
  order_number: string | number;
  index: number;
  outlet: { _id: string; name: string };
  total: number;
  delivery_charge: number;
  advance_due: number;
  amount_to_pay: number;
  status: string;
}

/** Another order of the same checkout on a public order read (`linked_orders[]`). */
export interface LinkedOrder {
  _id: string;
  order_number: string | number;
  index: number;
  outlet_name: string;
  status: string;
  payment_status: string;
  total: number;
  delivery_charge: number;
}

export const checkoutGroupOf = (res: unknown): CheckoutGroup | null => {
  const g = (res as any)?.checkout_group;
  if (!g || typeof g !== 'object' || !g.id || !(num(g.count) > 1)) return null;
  return { id: str(g.id), count: num(g.count), reason: str(g.reason) || 'outlet', ...(g.index ? { index: num(g.index) } : {}) };
};

/** Every order a create answer made, by parcel (one entry for an unsplit checkout with `orders[]`; [] on older backends). */
export const checkoutOrders = (res: unknown): CheckoutOrderRow[] => {
  const list = (res as any)?.orders;
  if (!Array.isArray(list)) return [];
  return list
    .filter((o: any) => o && o._id)
    .map((o: any, i: number) => ({
      _id: str(o._id),
      order_number: o.order_number ?? '',
      index: num(o.index) || i + 1,
      outlet: { _id: str(o.outlet?._id), name: str(o.outlet?.name) },
      total: num(o.total),
      delivery_charge: num(o.delivery_charge),
      advance_due: num(o.advance_due),
      amount_to_pay: num(o.amount_to_pay),
      status: str(o.status),
    }))
    .sort((a, b) => a.index - b.index);
};

/** "Orders #1043 and #1044" / "Orders #1043, #1044 and #1045"; '' for fewer than two. */
export const orderNumbersText = (orders: Array<{ order_number: string | number }>): string => {
  const n = orders.map((o) => `#${o.order_number}`).filter((s) => s !== '#');
  if (n.length < 2) return '';
  return `Orders ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

export interface GroupOrderRow {
  _id: string;
  order_number: string | number;
  index: number;
  /** where this parcel ships from ('' when the read doesn't say) */
  from: string;
  status: string;
  payment_status: string;
  total: number;
  delivery_charge: number;
  /** the order being read */
  current: boolean;
}

/**
 * Every order of the checkout an order read belongs to, by parcel: the order itself (from its
 * `checkout_group.index` and `fulfilment.outlet_name`) and its `linked_orders`. [] when the
 * checkout wasn't split.
 */
export const groupOrderRows = (order: any): GroupOrderRow[] => {
  const g = checkoutGroupOf(order);
  if (!g || !order?._id) return [];
  const linked = Array.isArray(order.linked_orders) ? order.linked_orders : [];
  const self: GroupOrderRow = {
    _id: str(order._id),
    order_number: order.order_number ?? '',
    index: g.index || 1,
    from: str(order.fulfilment?.outlet_name),
    status: str(order.status),
    payment_status: str(order.payment_status),
    total: num(order.product_total_price) + num(order.delivery_charge) + num(order.customization_total) - num(order.discount?.d_value),
    delivery_charge: num(order.delivery_charge),
    current: true,
  };
  const others: GroupOrderRow[] = linked
    .filter((o: any) => o && o._id && str(o._id) !== self._id)
    .map((o: any, i: number) => ({
      _id: str(o._id),
      order_number: o.order_number ?? '',
      index: num(o.index) || i + 2,
      from: str(o.outlet_name),
      status: str(o.status),
      payment_status: str(o.payment_status),
      total: num(o.total),
      delivery_charge: num(o.delivery_charge),
      current: false,
    }));
  return [self, ...others].sort((a, b) => a.index - b.index);
};

/** The note kept for the order page after a split checkout or a plan that changed on create. */
export interface PlacedCheckoutNote {
  order_id: string;
  plan_changed: boolean;
  orders: CheckoutOrderRow[];
}

/** What to keep from a create answer for the order page, or null when there is nothing to say. */
export const placedCheckoutNote = (res: unknown): PlacedCheckoutNote | null => {
  const r = res as any;
  if (!r?._id) return null;
  const orders = checkoutOrders(r);
  const changed = r.plan_changed === true;
  if (!changed && orders.length < 2) return null;
  return { order_id: str(r._id), plan_changed: changed, orders };
};

/** The words for an order placed with a plan that changed on create (a race took the last unit at one store). */
export const PLAN_CHANGED_NOTE =
  'An item sold out at one of our stores while you were checking out, so your order ships from a different store. You pay the delivery you were quoted.';

// ---------------------------------------------------------------- paying and cancelling a group

/** Keys a payment init adds for a split checkout; never part of a gateway's form. */
export const GATEWAY_GROUP_KEYS = ['checkout_group', 'orders'] as const;

/**
 * The fields of a form gateway (eSewa, NPX) from its init answer: everything but `action_url` and
 * the split-checkout keys (`checkout_group`, `orders[]`), which the gateway must never get.
 */
export const gatewayFormFields = (res: any): { action: string; fields: Record<string, any> } => {
  const { action_url, ...rest } = res || {};
  for (const k of GATEWAY_GROUP_KEYS) delete (rest as any)[k];
  return { action: str(action_url), fields: rest };
};

/**
 * A pooled checkout placed with an online method but nothing left to pay online (the server
 * answers `amount_to_pay: 0` and refuses a payment init): start no payment, it is placed.
 */
export const nothingDueOnline = (res: unknown): boolean => {
  const n = (res as any)?.amount_to_pay;
  return typeof n === 'number' && Number.isFinite(n) && n <= 0;
};

export interface GroupCancelRow {
  order_id: string;
  order_number: string | number;
  ok: boolean;
  skipped_reason?: string;
  message?: string;
}

/**
 * The answer of a public "cancel all parcels" (`group_results[]`): the orders cancelled and, in
 * words, those that weren't ("Order #1044 wasn't cancelled: already sent"). A plain answer (one
 * order, an older backend) has none.
 */
export const groupCancelResult = (res: any): { cancelled: string[]; skipped: string[] } => {
  const rows: GroupCancelRow[] = Array.isArray(res?.group_results) ? res.group_results : [];
  const label = (r: GroupCancelRow) => `Order #${r.order_number ?? r.order_id}`;
  return {
    cancelled: rows.filter((r) => r?.ok).map(label),
    skipped: rows
      .filter((r) => r && !r.ok)
      .map((r) => {
        const why = str(r.message || r.skipped_reason).trim();
        return `${label(r)} wasn't cancelled${why ? `: ${why}` : ''}.`;
      }),
  };
};

// ---------------------------------------------------------------- stores that have it

export type AvailabilityBand = 'in_stock' | 'few';

/** `GET /order/public/store-availability/:store_id/:product_id` (only when `show_stores`). */
export interface StoreAvailability {
  enabled: boolean;
  stores: Array<{
    _id: string;
    name: string;
    city?: string;
    /** the store is a pickup point */
    pickup: boolean;
    /** `variant` is '' for a product without variants; never a raw count */
    variants: Array<{ variant: string; band: AvailabilityBand }>;
  }>;
}

export const NO_STORE_AVAILABILITY: StoreAvailability = { enabled: false, stores: [] };

export const toStoreAvailability = (raw: any): StoreAvailability => {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true || !Array.isArray(raw.stores)) return NO_STORE_AVAILABILITY;
  return {
    enabled: true,
    stores: raw.stores
      .filter((s: any) => s && s._id && s.name)
      .map((s: any) => ({
        _id: str(s._id),
        name: str(s.name),
        ...(s.city ? { city: str(s.city) } : {}),
        pickup: s.pickup === true,
        variants: (Array.isArray(s.variants) ? s.variants : [])
          .filter((v: any) => v && (v.band === 'in_stock' || v.band === 'few'))
          .map((v: any) => ({ variant: str(v.variant), band: v.band as AvailabilityBand })),
      })),
  };
};

export interface StoreHas {
  _id: string;
  name: string;
  band: AvailabilityBand;
  pickup: boolean;
}

/**
 * The stores that have this variant ('' = the product without variants, or any variant when no
 * variant is picked yet). A store with several variants in stock reads its best band.
 */
export const storesWith = (avail: StoreAvailability | null | undefined, variantId?: string | null): StoreHas[] => {
  if (!avail?.enabled) return [];
  const v = str(variantId);
  const out: StoreHas[] = [];
  for (const s of avail.stores) {
    const hits = s.variants.filter((x) => (v ? x.variant === v : true));
    if (!hits.length) continue;
    out.push({ _id: s._id, name: s.name, pickup: s.pickup, band: hits.some((x) => x.band === 'in_stock') ? 'in_stock' : 'few' });
  }
  return out;
};

/** "Available at Pokhara, Butwal (few left)", or '' when no store has it. */
export const availableAtText = (stores: StoreHas[]): string => {
  if (!stores.length) return '';
  return `Available at ${stores.map((s) => `${s.name}${s.band === 'few' ? ' (few left)' : ''}`).join(', ')}`;
};
