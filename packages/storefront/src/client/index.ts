/**
 * @blanxer-dev/storefront/client — calls that must run in the shopper's browser:
 * orders, coupons, offers and the cart quote, payment starts and checks, hold
 * release, tracking, cancel, review, back-in-stock, forms, flash-sale notify and
 * Meta events.
 *
 * Importing this from a Server Component, route handler or server action is a
 * build error on purpose (per-IP rate limits and gateway return URLs depend on
 * the shopper's browser making the call).
 */
import 'client-only';
import { STORAGE_KEYS, normalizeApiBase } from '../core/config.js';
import { BlanxerApiError, readBody } from '../core/http.js';
import { paymentFlow } from '../core/payments.js';
import { OFFERS_OFF, offersResponseOf, quoteOf, type OffersResponse, type Quote, type QuoteRequest } from '../core/offers.js';
import type { Coupon, DeliveryTable, FlashSaleForProduct, OrderPurchaseMeta, OrderResponse, Product } from '../core/types.js';

export { BlanxerApiError, errorMessage, fieldError } from '../core/http.js';

let clientApiBase = '';

/** Set the API base used by every browser call (BlanxerProvider does this from its `apiBase` prop). */
export const configureClient = (opts: { apiBase?: string }) => {
  if (opts.apiBase) clientApiBase = normalizeApiBase(opts.apiBase);
};

const envApiBase = (): string | undefined => {
  try {
    // Written literally so Next inlines it at build time.
    return process.env.NEXT_PUBLIC_BLANXER_API || undefined;
  } catch {
    return undefined;
  }
};

const base = (): string => clientApiBase || normalizeApiBase(envApiBase());

async function call<T = any>(method: 'GET' | 'POST', path: string, body?: any, init: RequestInit = {}): Promise<T> {
  const url = `${base()}${path}`;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: isForm ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
    ...init,
  });
  const data = await readBody(res);
  if (!res.ok) throw new BlanxerApiError(res.status, data, url);
  return data as T;
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------- orders

/** `POST /order/:store_id`. Build `payload` with `buildOrderPayload` (from `@blanxer-dev/storefront/core`). */
export const placeOrder = (storeId: string, payload: Record<string, any>): Promise<OrderResponse> =>
  call('POST', `/order/${storeId}`, payload);

/** Public order view for the tracking page. */
export const getOrder = (storeId: string, orderId: string): Promise<any> =>
  call('GET', `/order/public/${storeId}/id/${enc(orderId)}`);

/** Cancel (only Pending/Processing orders, store setting `allow_customer_cancellation`). */
export const cancelOrder = (body: { store_id: string; order_id: string; phone_number: string }): Promise<any> =>
  call('POST', `/order/public/cancel`, body);

/** Review one product of a delivered order. */
export const submitReview = (body: {
  store_id: string;
  product_id: string;
  order_id: string;
  rating: number;
  review: string;
  phone_number: string;
}): Promise<any> => call('POST', `/order/public/submit-review`, body);

/** Give an unpaid order's held units back early (QR closed on purpose, or its timer ran out). */
export const releaseHold = (body: { store_id: string; order_id: string; transaction_id: string }): Promise<any> =>
  call('POST', `/order/public/release-hold`, body);

// ---------------------------------------------------------------- coupons

/** Look up a coupon by code for the given lines. Send the returned `_id` on the order, never the code. */
export const applyCoupon = (body: {
  store: string;
  code: string;
  products: { product: string; variant: string; quantity: number }[];
}): Promise<Coupon> => call('POST', `/public/coupon`, body);

// ---------------------------------------------------------------- offers

let offersNoted = false;
/** One console.debug line per page load when the offers endpoints aren't there (older backend). */
const noteOffersOff = (why: unknown) => {
  if (offersNoted) return;
  offersNoted = true;
  try {
    console.debug('[@blanxer-dev/storefront] offers unavailable, using coupons:', (why as any)?.status || (why as any)?.message || String(why));
  } catch {
    /* no console */
  }
};

const isAbort = (e: unknown) => (e as any)?.name === 'AbortError';

/**
 * Live (and starting within 30 days) public offers, the store's display settings and the
 * server time. `enabled: false` → the store isn't on Offers: use the coupon calls above.
 * Never throws: a 404 (older backend), a network error or a non-JSON answer is "offers off".
 */
export const getOffers = (storeId: string, init?: RequestInit): Promise<OffersResponse> =>
  offersCall(`/public/promotions/${storeId}`, init);

/** Same, only the offers that touch one product (badges, product-page blocks). Never throws. */
export const getProductOffers = (storeId: string, productId: string, init?: RequestInit): Promise<OffersResponse> =>
  offersCall(`/public/promotions/${storeId}/product/${enc(productId)}`, init);

const offersCall = async (path: string, init?: RequestInit): Promise<OffersResponse> => {
  try {
    const res = offersResponseOf(await call<any>('GET', path, undefined, init));
    if (!res) noteOffersOff('not an offers answer');
    return res || OFFERS_OFF;
  } catch (e) {
    if (!isAbort(e)) noteOffersOff(e);
    return OFFERS_OFF;
  }
};

/** Thrown by `quoteCart` when the server is busy (rate limit, 5xx): keep the offers, try again later. */
export class QuoteUnavailableError extends Error {
  status: number;
  constructor(status: number) {
    super(`Quote unavailable (${status})`);
    this.name = 'QuoteUnavailableError';
    this.status = status;
  }
}

/**
 * The cart priced by the server: per-line offers, gift lines, the code result, delivery,
 * totals and upsell messages. Build `body` with `buildQuoteRequest` (from
 * `@blanxer-dev/storefront/core`). Resolves to null when the store isn't on Offers, and
 * also for a 404, a network error or a non-JSON answer (offers off). Throws
 * `QuoteUnavailableError` for a rate limit or a server error.
 * Rate-limited per IP: debounce it (the react `useCartQuote` hook does).
 */
export const quoteCart = async (storeId: string, body: QuoteRequest, init?: RequestInit): Promise<Quote | null> => {
  try {
    const q = quoteOf(await call<any>('POST', `/public/promotions/${storeId}/quote`, body, init));
    return q;
  } catch (e) {
    if (isAbort(e)) throw e;
    const status = (e as any)?.status;
    if (status === 429 || status >= 500) throw new QuoteUnavailableError(status);
    noteOffersOff(e);
    return null;
  }
};

// ---------------------------------------------------------------- payments

export type PaymentStart =
  | { type: 'none' }
  | { type: 'redirect'; url: string }
  | { type: 'form'; action: string; fields: Record<string, string> }
  | { type: 'qr'; transaction: string; qr_message: string; amount: number; [k: string]: any }
  | {
      type: 'fonepay_checkout';
      transaction: string;
      prn: string;
      qr_message: string;
      socket_url: string;
      amount: number;
      banks: Array<{ bankName: string; bankCode: string; bankIcon: string; packageName: string; intentScheme: string }>;
      [k: string]: any;
    };

const INIT_PATH: Record<string, string> = {
  Esewa: '/payment/esewa/init',
  NPX: '/payment/npx/init',
  Khalti: '/payment/khalti/init',
  FonePay: '/payment/fonepay/init',
  nbank_card: '/payment/nabil_card/init',
  QR: '/payment/dynamic_qr/init',
  QR_Dynamic: '/payment/dynamic_qr/init',
  QR_Static: '/payment/static_qr/init',
  FonepayCheckout: '/payment/fonepay_checkout/init',
};

/**
 * Start the gateway for a created order. `url` must be the site's own origin
 * (`window.location.origin`); the gateway comes back to `<url>/payment/success`
 * or `<url>/payment/failed`. Returns what to do next — see `followPayment`.
 */
export async function startPayment(
  method: string,
  args: { store: string; order: string; url?: string },
): Promise<PaymentStart> {
  const flow = paymentFlow(method);
  if (flow === 'none') return { type: 'none' };
  const path = INIT_PATH[method];
  if (!path) throw new Error(`Unsupported payment method: ${method}`);
  const url = args.url || window.location.origin;
  const body: Record<string, any> = { store: args.store, order: args.order, url };
  if (method === 'QR_Dynamic') body.self = true;
  const res: any = await call('POST', path, body);

  if (flow === 'form') {
    const { action_url, ...fields } = res || {};
    return { type: 'form', action: action_url || '', fields };
  }
  if (flow === 'redirect') {
    const to = method === 'Khalti' ? res?.payment_url : res?.url;
    if (!to) throw new Error(`${method} did not return a payment link.`);
    return { type: 'redirect', url: to };
  }
  if (flow === 'fonepay_checkout') return { type: 'fonepay_checkout', ...res };
  return { type: 'qr', ...res };
}

/** Do the browser side of a `PaymentStart`: navigate, or auto-submit the hidden POST form (eSewa, NPX). */
export function followPayment(start: PaymentStart): void {
  if (start.type === 'redirect') {
    window.location.href = start.url;
    return;
  }
  if (start.type === 'form') {
    const form = document.createElement('form');
    form.action = start.action;
    form.method = 'post';
    form.style.display = 'none';
    for (const [name, value] of Object.entries(start.fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value ?? '');
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }
}

/** Has the in-page payment landed? `kind` is `'qr'` (QR / QR_Dynamic / QR_Static) or `'fonepay_checkout'`. */
export async function checkPayment(kind: 'qr' | 'fonepay_checkout', transaction: string): Promise<boolean> {
  try {
    if (kind === 'fonepay_checkout') await call('GET', `/payment/fonepay_checkout/check/${enc(transaction)}`);
    else await call('GET', `/payment/dynamic_qr/check/${enc(transaction)}`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- catalog helpers (browser)

export const getDeliveryCharges = (storeId: string): Promise<DeliveryTable> =>
  call('GET', `/public/delivery_charge/${storeId}`);

/** One active product by id or slug (bundle blocks, gift pickers). */
export const getProductPublic = (storeId: string, idOrSlug: string): Promise<Product> =>
  call('GET', `/product/public/${storeId}/${enc(idOrSlug)}`);

export const getFlashSaleForProduct =(storeId: string, productId: string): Promise<FlashSaleForProduct> =>
  call('GET', `/public/flash-sale/${storeId}/product/${productId}`);

export const notifyFlashSale = (
  storeId: string,
  body: { campaign_id: string; product_id?: string; product_name?: string; url?: string; phone?: string; email?: string },
): Promise<any> => call('POST', `/public/flash-sale/${storeId}/notify`, body);

/** Back-in-stock alert (no login). Give a phone, an email, or both. */
export const requestStockAlert = (body: {
  store: string;
  product: string;
  variant_id?: string;
  phone?: string;
  email?: string;
  product_name?: string;
  product_url?: string;
}): Promise<any> => call('POST', `/customer/stock-alert`, body);

/** Submit a Blanxer form. */
export const submitForm = (storeId: string, slug: string, data: Record<string, any>): Promise<any> =>
  call('POST', `/public/form/${storeId}/${enc(slug)}/submit`, { data });

/** Upload a shopper image for an `image` custom field. Resolves to the file URL. */
export async function uploadCustomFieldImage(
  storeId: string,
  productId: string,
  file: File,
  csrfToken = '',
): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('csrf_token', csrfToken);
  const res: any = await call('POST', `/product/${storeId}/${productId}/file`, fd);
  return res?.file?.file_url || '';
}

/** Session ping used for store analytics (once per browser session, as the storefront does). */
export function pingAnalytics(storeId: string): void {
  try {
    if (sessionStorage.getItem(STORAGE_KEYS.ping)) return;
    sessionStorage.setItem(STORAGE_KEYS.ping, 'yes');
    call('POST', `/analytics/ping/${storeId}`).catch(() => {});
  } catch {
    /* storage blocked */
  }
}

// ---------------------------------------------------------------- Meta pixel + Conversions API

export type MetaEventName =
  | 'PageView'
  | 'ViewContent'
  | 'Search'
  | 'AddToCart'
  | 'AddToWishlist'
  | 'InitiateCheckout'
  | 'AddPaymentInfo'
  | 'Purchase'
  | 'Lead'
  | 'Contact'
  | 'CompleteRegistration';

type MetaConfig = {
  /** the store has the Conversions API (`meta_capi` plugin) */
  enabled: boolean;
  store_id: string;
};

export type MetaUser = {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  external_id?: string;
};

declare global {
  interface Window {
    __META_CAPI__?: MetaConfig;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export const PIXEL_ID_RE = /^\d{10,20}$/;

const inBrowser = () => typeof window !== 'undefined';

/** Store config for Meta events (BlanxerProvider calls it from the store's plugins). */
export const initMetaCapi = (cfg: MetaConfig) => {
  if (inBrowser()) window.__META_CAPI__ = cfg;
};

export const getEventId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const readCookie = (name: string): string => {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : '';
};

// ad click id ---------------------------------------------------------

const FBCLID_KEY = 'bx_fbclid';

/** Keep the Meta ad click id from the landing URL (the pixel's `_fbc` cookie may be blocked). */
export const captureFbclid = () => {
  try {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid) localStorage.setItem(FBCLID_KEY, JSON.stringify({ fbclid, ts: Date.now() }));
  } catch {
    /* ignore */
  }
};

const fbIds = () => {
  let click: { fbclid: string; ts: number } | null = null;
  try {
    const v = JSON.parse(localStorage.getItem(FBCLID_KEY) || 'null');
    if (v?.fbclid && Date.now() - v.ts < 90 * 24 * 60 * 60 * 1000) click = v;
  } catch {
    /* ignore */
  }
  return {
    fbp: readCookie('_fbp'),
    fbc: readCookie('_fbc') || (click ? `fb.1.${click.ts}.${click.fbclid}` : ''),
    fbclid: click?.fbclid || '',
  };
};

// shopper (matching) ---------------------------------------------------

const USER_KEY = 'bx_meta_user';

/** Checkout details, kept for this browser session so server events can match the shopper. */
export const rememberCheckoutUser = (u: MetaUser) => {
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(u));
  } catch {
    /* ignore */
  }
};

const metaUser = (): MetaUser => {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

export const splitName = (full?: string) => {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || undefined, last_name: parts.length > 1 ? parts[parts.length - 1] : undefined };
};

// GTM dataLayer ---------------------------------------------------------

const GA4_EVENT: Record<string, string> = {
  ViewContent: 'view_item',
  Search: 'search',
  AddToCart: 'add_to_cart',
  AddToWishlist: 'add_to_wishlist',
  InitiateCheckout: 'begin_checkout',
  AddPaymentInfo: 'add_payment_info',
  Purchase: 'purchase',
  Lead: 'generate_lead',
  Contact: 'contact',
  CompleteRegistration: 'sign_up',
};

export const dlPush = (data: Record<string, any>) => {
  if (!inBrowser()) return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(data);
  } catch {
    /* ignore */
  }
};

/**
 * Mirror a Meta event into GTM's dataLayer (GA4 ecommerce shape, plus
 * `meta_event_id` so a Meta tag in GTM can dedupe with ours).
 */
export const pushMetaEvent = (eventName: string, cd: Record<string, any> = {}, eventId?: string) => {
  const event = GA4_EVENT[eventName];
  if (!event) return;
  const list: any[] = cd.contents?.length ? cd.contents : (cd.content_ids || []).map((id: string) => ({ id }));
  const items = list.map((c: any) => ({
    item_id: c.id,
    ...(list.length === 1 && cd.content_name ? { item_name: cd.content_name } : {}),
    ...(c.item_price !== undefined ? { price: c.item_price } : {}),
    quantity: c.quantity ?? 1,
  }));
  const head = {
    event,
    meta_event_name: eventName,
    ...(eventId ? { meta_event_id: eventId } : {}),
    ...(cd.search_string ? { search_term: cd.search_string } : {}),
  };
  if (!items.length && cd.value === undefined) return dlPush(head);
  dlPush({ ecommerce: null });
  dlPush({
    ...head,
    ecommerce: {
      currency: cd.currency || 'NPR',
      ...(cd.value !== undefined ? { value: cd.value } : {}),
      ...(cd.order_id ? { transaction_id: cd.order_id } : {}),
      items,
    },
  });
};

// tracking ---------------------------------------------------------------

/** The `meta` block of the order body: lets the backend send the Purchase
 * matched to this browser. The argument is ignored (older versions shared an
 * event id; the backend now returns it). */
export const buildOrderMeta = (_legacyEventId?: string) => ({
  ...fbIds(),
  event_source_url: inBrowser() ? window.location.href : '',
});

/** Browser pixel only (no-op when the pixel is not loaded). */
export const pixelTrack = (event: MetaEventName, data?: Record<string, any>, options?: { eventID?: string }) => {
  if (!inBrowser() || !window.fbq) return;
  if (!data) window.fbq('track', event);
  else if (!options) window.fbq('track', event, data);
  else window.fbq('track', event, data, options);
};

/**
 * Track a Meta event on the pixel and GTM's dataLayer and, when the store has
 * the `meta_capi` plugin, relay it
 * to Blanxer's CAPI endpoint with the same event id. Purchase is never
 * relayed: the backend sends it from the real order (use `firePurchase`).
 * Returns the event id.
 */
export function trackEvent(
  event: MetaEventName,
  customData: Record<string, any> = {},
  options: { eventId?: string; email?: string; phone?: string } = {},
): string {
  const eventId = options.eventId || getEventId();
  pixelTrack(event, customData, { eventID: eventId });
  pushMetaEvent(event, customData, eventId);
  const cfg = inBrowser() ? window.__META_CAPI__ : undefined;
  if (cfg?.enabled && cfg.store_id && event !== 'Purchase' && event !== 'PageView') {
    try {
      fetch(`${base()}/public/meta-event/${cfg.store_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          event_name: event,
          event_id: eventId,
          event_source_url: window.location.href,
          ...fbIds(),
          ...metaUser(),
          ...(options.email ? { email: options.email } : {}),
          ...(options.phone ? { phone: options.phone } : {}),
          custom_data: customData,
        }),
      }).catch(() => {});
    } catch {
      /* analytics never breaks the page */
    }
  }
  return eventId;
}

/** Browser Purchase for an order, with the backend's `meta` (same id + value as its server event). */
export const firePurchase = (meta: OrderPurchaseMeta) => {
  const custom = {
    value: meta.value,
    currency: meta.currency || 'NPR',
    content_type: 'product',
    content_ids: meta.content_ids,
    contents: meta.contents,
    num_items: meta.num_items,
    order_id: meta.order_id,
  };
  pixelTrack('Purchase', custom, { eventID: meta.purchase_event_id });
  pushMetaEvent('Purchase', custom, meta.purchase_event_id);
};

/** Purchase payload built locally, only when an older backend didn't return `meta`. */
export const localOrderMeta = (
  lines: { product: string; variant?: string; quantity: number; price?: number }[],
  value: number,
  orderId = '',
): OrderPurchaseMeta => {
  const contents = lines.map((l) => ({
    id: l.variant ? `${l.product}_${l.variant}` : l.product,
    quantity: l.quantity || 1,
    item_price: Number(l.price || 0),
  }));
  return {
    purchase_event_id: getEventId(),
    value,
    currency: 'NPR',
    content_ids: Array.from(new Set(contents.map((c) => c.id))),
    contents,
    num_items: contents.reduce((s, c) => s + c.quantity, 0),
    order_id: orderId,
  };
};

/** Paid methods: keep the Purchase for `/payment/success`. */
export const savePendingPurchase = (meta: OrderPurchaseMeta) => {
  try {
    sessionStorage.setItem(STORAGE_KEYS.pixelPurchasePending, JSON.stringify(meta));
  } catch {
    /* storage blocked */
  }
};

/** Read (and remove) the pending Purchase; null for payloads saved by older versions. */
export const takePendingPurchase = (): OrderPurchaseMeta | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.pixelPurchasePending);
    sessionStorage.removeItem(STORAGE_KEYS.pixelPurchasePending);
    const meta = raw ? JSON.parse(raw) : null;
    return meta?.purchase_event_id ? meta : null;
  } catch {
    return null;
  }
};
