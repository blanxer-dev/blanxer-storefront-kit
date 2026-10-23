export const DEFAULT_API_BASE = 'https://api.blanxer.com';
export const DEV_API_BASE = 'https://api-dev.blanxer.com';

/** A normal browser User-Agent. Server-side catalog reads send it so they look
 * like ordinary traffic to Cloudflare's browser-integrity check. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 BlanxerStorefront/0.1';

export const normalizeApiBase = (value?: string | null): string =>
  String(value || DEFAULT_API_BASE)
    .trim()
    .replace(/\/+$/, '');

/** localStorage / sessionStorage keys, identical to the Blanxer storefront so
 * behaviour (and any shopper state) matches. */
export const STORAGE_KEYS = {
  cart: 'cart_items',
  cartSelection: 'cart_selection',
  promoCode: 'promo_code',
  /** Offers: automatic offers the shopper removed and gift picks (`{ removed, gifts }`). */
  offerChoices: 'bx_offer_choices',
  stockAlerts: 'stock_alerts',
  ping: 'ping',
  checkoutOrderId: 'checkout_order_id',
  pixelPurchasePending: 'pixel_purchase_pending',
  /** The order placed from this tab whose online payment (or advance) isn't confirmed yet (`PendingOrder`). */
  pendingOrder: 'checkout_pending_order',
} as const;
