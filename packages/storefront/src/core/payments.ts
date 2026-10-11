import type { PaymentMethod, PaymentMethodName, Store } from './types.js';

/** Plans that may take online payments. Free stores are COD-only. */
export const PAID_PLANS = ['basic', 'premium', 'plus', 'platinum'];
export const isPaidPlan = (plan?: string): boolean => PAID_PLANS.includes(String(plan || ''));

export const PAYMENT_METHODS: Record<string, PaymentMethod> = {
  cash_on_delivery: { name: 'COD', display_name: 'Cash on delivery' },
  qr_dynamic: { name: 'QR_Dynamic', display_name: 'Fonepay QR Payment' },
  fonepay_checkout: { name: 'FonepayCheckout', display_name: 'Checkout by Fonepay' },
  qr_blanxer: { name: 'QR', display_name: 'QR Payment' },
  esewa: { name: 'Esewa', display_name: 'Esewa' },
  fonepay: { name: 'FonePay', display_name: 'FonePay' },
  khalti: { name: 'Khalti', display_name: 'Khalti' },
  npx: { name: 'NPX', display_name: 'Nepal Payment Solution' },
  nbank_card: { name: 'nbank_card', display_name: 'Visa/Mastercard' },
  qr_static: { name: 'QR_Static', display_name: 'Fonepay QR Payment' },
};

const truthy = (v: unknown) => !!v && v !== 'false';

export interface StorePaymentConfig {
  fonepay_dynamic: boolean;
  fonepay_checkout: boolean;
  qr: boolean;
  esewa: boolean;
  fonepay: boolean;
  khalti: boolean;
  npx: boolean;
  nbank_card: boolean;
  /** Card (cybersource) is never offered on custom sites. */
  card: false;
}

/** Which online methods the store has turned on (same rules as the storefront). */
export const storePaymentConfig = (store?: Partial<Store> | null): StorePaymentConfig => {
  const off: StorePaymentConfig = {
    fonepay_dynamic: false,
    fonepay_checkout: false,
    qr: false,
    esewa: false,
    fonepay: false,
    khalti: false,
    npx: false,
    nbank_card: false,
    card: false,
  };
  if (!store || !isPaidPlan(store.plan)) return off;
  const a = store.addons || {};
  const s = store.setting || {};
  return {
    fonepay_dynamic: truthy(a.fonepay_dynamic) && truthy(s.fonepay_dynamic_key),
    fonepay_checkout: truthy(a.fonepay_checkout) && truthy(s.fonepay_checkout_key),
    qr: truthy(a.qr_request_enabled),
    esewa: truthy(a.esewa) && truthy(s.esewa_secret),
    fonepay: truthy(a.fonepay),
    khalti: truthy(a.khalti),
    npx: truthy(a.npx),
    nbank_card: truthy(a.nbank_card),
    card: false,
  };
};

/**
 * The selectable methods, in checkout order: COD first (only when the chosen
 * delivery place allows it), then QR_Dynamic, FonepayCheckout, QR, Esewa,
 * FonePay, Khalti, NPX, nbank_card.
 */
export const paymentMethodsFor = (
  store: Partial<Store> | null | undefined,
  opts: { codAllowed: boolean },
): PaymentMethod[] => {
  const cfg = storePaymentConfig(store);
  const list: PaymentMethod[] = [];
  if (opts.codAllowed) list.push(PAYMENT_METHODS.cash_on_delivery!);
  if (cfg.fonepay_dynamic) list.push(PAYMENT_METHODS.qr_dynamic!);
  if (cfg.fonepay_checkout) list.push(PAYMENT_METHODS.fonepay_checkout!);
  if (cfg.qr) list.push(PAYMENT_METHODS.qr_blanxer!);
  if (cfg.esewa) list.push(PAYMENT_METHODS.esewa!);
  if (cfg.fonepay) list.push(PAYMENT_METHODS.fonepay!);
  if (cfg.khalti) list.push(PAYMENT_METHODS.khalti!);
  if (cfg.npx) list.push(PAYMENT_METHODS.npx!);
  if (cfg.nbank_card) list.push(PAYMENT_METHODS.nbank_card!);
  return list;
};

/** Methods paid inside the page (QR modal). The cart is kept until the payment is confirmed. */
export const IN_PAGE_METHODS: PaymentMethodName[] = ['QR', 'QR_Dynamic', 'QR_Static', 'FonepayCheckout'];
export const isInPageMethod = (m: string): boolean => (IN_PAGE_METHODS as string[]).includes(m);

/** How each method starts. */
export type PaymentFlow = 'none' | 'redirect' | 'form' | 'qr' | 'fonepay_checkout';
export const paymentFlow = (m: string): PaymentFlow => {
  switch (m) {
    case 'COD':
      return 'none';
    case 'Esewa':
    case 'NPX':
      return 'form';
    case 'Khalti':
    case 'FonePay':
    case 'nbank_card':
      return 'redirect';
    case 'QR':
    case 'QR_Dynamic':
    case 'QR_Static':
      return 'qr';
    case 'FonepayCheckout':
      return 'fonepay_checkout';
    default:
      return 'none';
  }
};
