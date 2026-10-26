import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeAdvance,
  advanceFromAnswer,
  advancePaymentOn,
  buildOrderPayload,
  buildQuoteRequest,
  codOffer,
  initialCheckoutValues,
  orderAdvance,
  PENDING_KEY,
  quoteKey,
  quoteOf,
  STORAGE_KEYS,
  toAdvance,
  type CartItem,
} from '../src/core/index.js';

// Kit-only parts of the advance payment: reading the quote / order answers, what the quote and
// the order send, and the browser call (fetch replaced). Shared rules: advance.test.ts.

const adv = { amount: 150, on_delivery: 2350, total: 2500, basis: 'delivery', required: true, full: false };

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'p1_v1',
  product: 'p1',
  product_name: 'Tee',
  price: 1000,
  compare_at_price: 0,
  quantity: 1,
  weight: 0.5,
  variant: 'v1',
  variant_name: 'Red/M',
  image_url: '',
  custom_fields: [],
  ...over,
});

describe('the store setting', () => {
  it('only an explicit enabled: true asks for the advance', () => {
    expect(advancePaymentOn({ checkout: { advance_payment: { enabled: true } } })).toBe(true);
    expect(advancePaymentOn({ checkout: { advance_payment: { enabled: false } } })).toBe(false);
    expect(advancePaymentOn({ checkout: {} })).toBe(false);
    expect(advancePaymentOn(null)).toBe(false);
  });
  it('the pending order key is the storefront one', () => {
    expect(STORAGE_KEYS.pendingOrder).toBe(PENDING_KEY);
  });
});

describe('reading the quote answer', () => {
  it('stores on Offers: the quote keeps its advance', () => {
    const raw = { success: true, enabled: true, data: { lines: [], totals: { total: 2500 }, advance: adv } };
    expect(quoteOf(raw)?.advance).toEqual(adv);
    expect(advanceFromAnswer(raw)).toEqual(adv);
  });
  it('stores not on Offers: { enabled: false, data: { advance, totals } }', () => {
    expect(advanceFromAnswer({ success: true, enabled: false, data: { advance: adv, totals: { goods: 2300, delivery: 200, total: 2500 } } })).toEqual(adv);
    expect(quoteOf({ success: true, enabled: false, data: { advance: adv } })).toBeNull();
  });
  it('an older backend, an HTML page or junk is plain COD', () => {
    expect(advanceFromAnswer({ success: true, enabled: false })).toBeNull();
    expect(advanceFromAnswer({ success: true, enabled: true, data: { lines: [], totals: {} } })).toBeNull();
    expect(advanceFromAnswer('<!doctype html>')).toBeNull();
    expect(advanceFromAnswer(null)).toBeNull();
    expect(advanceFromAnswer({ data: { advance: { amount: 0, on_delivery: 2500 } } })).toBeNull();
  });
});

describe('the create-order answer', () => {
  it('advance → pay it online first; null / absent → plain COD', () => {
    expect(orderAdvance({ _id: 'o1', advance: { amount: 150, on_delivery: 2350, basis: 'delivery', required: false } })).toEqual({
      amount: 150,
      on_delivery: 2350,
      required: false,
    });
    expect(orderAdvance({ _id: 'o1', advance: null })).toBeNull();
    expect(orderAdvance({ _id: 'o1' })).toBeNull();
    expect(orderAdvance({ _id: 'o1', advance: { amount: 0 } })).toBeNull();
  });
});

describe('what the quote sends', () => {
  it('customization per unit and the legacy coupon id; the key changes with them', () => {
    const plain = buildQuoteRequest({ lines: [line()], place: 'Kathmandu', paymentMethod: 'COD' });
    expect(plain.products[0]).toEqual({ product: 'p1', variant: 'v1', quantity: 1 });
    expect(plain).not.toHaveProperty('coupon');
    const custom = buildQuoteRequest({ lines: [line({ customization_charge: 50 })], place: 'Kathmandu', paymentMethod: 'COD', coupon: 'c1' });
    expect(custom.products[0]).toEqual({ product: 'p1', variant: 'v1', quantity: 1, customization_charge: 50 });
    expect(custom.coupon).toBe('c1');
    expect(custom.payment).toBe('cod');
    expect(quoteKey(custom)).not.toBe(quoteKey(plain));
  });
});

describe('what the order sends', () => {
  const base = {
    store: { _id: 's1' },
    lines: [line()],
    values: { ...initialCheckoutValues(null), customer_address_city: 'Kathmandu' },
    url: 'https://shop.test',
  };
  const offer = codOffer(toAdvance(adv));

  it('advance_via only with COD and an advance that applies', () => {
    const a = activeAdvance('COD', offer);
    expect(buildOrderPayload({ ...base, paymentMethod: 'COD', advance: a, advanceVia: 'Esewa' })).toMatchObject({ paymentMethod: 'COD', advance_via: 'Esewa' });
  });
  it('plain COD, online methods and older callers send no advance_via', () => {
    expect(buildOrderPayload({ ...base, paymentMethod: 'COD' })).not.toHaveProperty('advance_via');
    expect(buildOrderPayload({ ...base, paymentMethod: 'COD', advance: null, advanceVia: 'Esewa' })).not.toHaveProperty('advance_via');
    expect(buildOrderPayload({ ...base, paymentMethod: 'Esewa', advance: toAdvance(adv), advanceVia: 'Esewa' })).not.toHaveProperty('advance_via');
    expect(buildOrderPayload({ ...base, paymentMethod: 'COD', advance: toAdvance(adv), advanceVia: '' })).not.toHaveProperty('advance_via');
  });
});

describe('quoteAdvance (browser)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const loadClient = async () => {
    vi.resetModules();
    const c = await import('../src/client/index.js');
    c.configureClient({ apiBase: 'https://api.test' });
    return c;
  };
  const body = buildQuoteRequest({ lines: [line()], place: 'Kathmandu', paymentMethod: 'COD' });

  it('posts to the quote endpoint and reads the advance', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, enabled: false, data: { advance: adv, totals: {} } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const c = await loadClient();
    expect(await c.quoteAdvance('s1', body)).toEqual(adv);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/public/promotions/s1/quote');
    expect(JSON.parse(String(init.body))).toMatchObject({ payment: 'cod', place: 'Kathmandu' });
  });
  it('release-hold names the attempt, or the order phone when there is none', async () => {
    const fetch = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const c = await loadClient();
    await c.releaseHold({ store_id: 's1', order_id: 'o1', phone_number: '9800000000' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/order/public/release-hold');
    expect(JSON.parse(String(init.body))).toEqual({ store_id: 's1', order_id: 'o1', phone_number: '9800000000' });
  });
  it('never throws: 404, 5xx, network error and HTML are plain COD', async () => {
    for (const f of [
      async () => new Response('<!doctype html>', { status: 404 }),
      async () => new Response('{"message":"x"}', { status: 500 }),
      async () => Promise.reject(new TypeError('Failed to fetch')),
      async () => new Response('<html></html>', { status: 200 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(f));
      const c = await loadClient();
      expect(await c.quoteAdvance('s1', body)).toBeNull();
    }
  });
});
