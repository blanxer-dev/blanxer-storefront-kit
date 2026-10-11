/**
 * @blanxer-dev/storefront/client — calls that must run in the shopper's browser:
 * orders, coupons, payment starts and checks, hold release, tracking, cancel,
 * review, back-in-stock, forms, flash-sale notify and Meta events.
 *
 * Importing this from a Server Component, route handler or server action is a
 * build error on purpose (per-IP rate limits and gateway return URLs depend on
 * the shopper's browser making the call).
 */
import 'client-only';
import { STORAGE_KEYS, normalizeApiBase } from '../core/config.js';
import { BlanxerApiError, readBody } from '../core/http.js';
import { paymentFlow } from '../core/payments.js';
import type { Coupon, DeliveryTable, FlashSaleForProduct, OrderResponse } from '../core/types.js';

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

export const getFlashSaleForProduct = (storeId: string, productId: string): Promise<FlashSaleForProduct> =>
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

export type MetaEventName = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase' | 'Search' | 'PageView';

type MetaConfig = { enabled: boolean; store_id: string };

declare global {
  interface Window {
    __META_CAPI__?: MetaConfig;
    fbq?: (...args: any[]) => void;
  }
}

/** Turn the CAPI relay on/off for this page (BlanxerProvider calls it from the store's `meta_capi` plugin). */
export const initMetaCapi = (cfg: MetaConfig) => {
  if (typeof window !== 'undefined') window.__META_CAPI__ = cfg;
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

/** The `meta` block of the order body: lets the backend fire the COD Purchase deduped with the browser pixel. */
export const buildOrderMeta = (eventId: string) => ({
  event_id: eventId,
  fbp: readCookie('_fbp'),
  fbc: readCookie('_fbc'),
  event_source_url: typeof window !== 'undefined' ? window.location.href : '',
});

/** Browser pixel only (no-op when the pixel is not loaded). */
export const pixelTrack = (event: MetaEventName, data?: Record<string, any>, options?: { eventID?: string }) => {
  if (typeof window === 'undefined' || !window.fbq) return;
  if (!data) window.fbq('track', event);
  else if (!options) window.fbq('track', event, data);
  else window.fbq('track', event, data, options);
};

/**
 * Track a Meta event on the pixel and, when the store has the `meta_capi`
 * plugin, relay it to Blanxer's CAPI endpoint with the same event id.
 * Returns the event id.
 */
export function trackEvent(
  event: MetaEventName,
  customData: Record<string, any> = {},
  options: { eventId?: string; email?: string; phone?: string } = {},
): string {
  const eventId = options.eventId || getEventId();
  pixelTrack(event, customData, { eventID: eventId });
  const cfg = typeof window !== 'undefined' ? window.__META_CAPI__ : undefined;
  if (cfg?.enabled && cfg.store_id) {
    try {
      fetch(`${base()}/public/meta-event/${cfg.store_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          event_name: event,
          event_id: eventId,
          event_source_url: window.location.href,
          fbp: readCookie('_fbp'),
          fbc: readCookie('_fbc'),
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
