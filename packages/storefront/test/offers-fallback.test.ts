import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQuoteRequest, offersResponseOf, orderLineFree, orderOfferSummary, quoteOf } from '../src/core/index.js';

// The browser calls, with fetch replaced. A fresh module per test so the "one debug line" note resets.
const loadClient = async () => {
  vi.resetModules();
  const c = await import('../src/client/index.js');
  c.configureClient({ apiBase: 'https://api.test' });
  return c;
};

const answer = (status: number, body: string, type = 'application/json') =>
  vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': type } }));

const QUOTE_BODY = buildQuoteRequest({ lines: [{ product: 'p1', variant: '', quantity: 1 }] });
const A_QUOTE = {
  success: true,
  enabled: true,
  data: {
    lines: [{ key: 'l0', product_id: 'p1', variant_id: null, name: 'Kurta', unit_price: 1200, qty: 1, gross: 1200, allocations: [], promo_discount: 0, net: 1200, free_qty: 0 }],
    applications: [],
    code: null,
    delivery: { before: null, discount: 0, after: null },
    totals: { gross: 1200, product_discount: 0, order_discount: 0, promo_discount: 0, goods: 1200, delivery: null, total: 1200 },
    messages: [],
  },
};

let debug: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('offers off when the endpoints are missing or broken (backends before Offers)', () => {
  it('a 404 from /public/promotions is offers off, with one debug line and nothing louder', async () => {
    vi.stubGlobal('fetch', answer(404, '<!doctype html><title>Not Found</title>', 'text/html'));
    const c = await loadClient();
    expect(await c.getOffers('s1')).toMatchObject({ enabled: false, data: [] });
    expect(await c.getProductOffers('s1', 'p1')).toMatchObject({ enabled: false, data: [] });
    expect(debug).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a network error is offers off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const c = await loadClient();
    expect((await c.getOffers('s1')).enabled).toBe(false);
    expect(await c.quoteCart('s1', QUOTE_BODY)).toBeNull();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('a 200 that is not JSON (an HTML page, a proxy) is offers off', async () => {
    vi.stubGlobal('fetch', answer(200, '<html>maintenance</html>', 'text/html'));
    const c = await loadClient();
    expect((await c.getOffers('s1')).enabled).toBe(false);
    expect(await c.quoteCart('s1', QUOTE_BODY)).toBeNull();
  });

  it('JSON without the offers shape is offers off', async () => {
    vi.stubGlobal('fetch', answer(200, JSON.stringify({ message: 'ok' })));
    const c = await loadClient();
    expect((await c.getOffers('s1')).enabled).toBe(false);
    expect(await c.quoteCart('s1', QUOTE_BODY)).toBeNull();
  });

  it('a 404 from the quote is offers off (null), never an exception', async () => {
    vi.stubGlobal('fetch', answer(404, JSON.stringify({ message: 'Not found' })));
    const c = await loadClient();
    await expect(c.quoteCart('s1', QUOTE_BODY)).resolves.toBeNull();
  });

  it('a busy server (429, 5xx) keeps offers on and reports it', async () => {
    vi.stubGlobal('fetch', answer(429, JSON.stringify({ message: 'Too many requests' })));
    let c = await loadClient();
    await expect(c.quoteCart('s1', QUOTE_BODY)).rejects.toBeInstanceOf(c.QuoteUnavailableError);
    vi.stubGlobal('fetch', answer(502, 'Bad gateway', 'text/plain'));
    c = await loadClient();
    await expect(c.quoteCart('s1', QUOTE_BODY)).rejects.toMatchObject({ status: 502 });
  });

  it('the store not on Offers answers enabled:false; a store on Offers gets its list and quote', async () => {
    vi.stubGlobal('fetch', answer(200, JSON.stringify({ success: true, enabled: false })));
    let c = await loadClient();
    expect((await c.getOffers('s1')).enabled).toBe(false);
    expect(await c.quoteCart('s1', QUOTE_BODY)).toBeNull();
    expect(debug).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', answer(200, JSON.stringify({ success: true, enabled: true, data: [{ id: 'o1' }], settings: { badges: false }, server_time: '2026-10-18T00:00:00Z' })));
    c = await loadClient();
    expect(await c.getOffers('s1')).toEqual({ enabled: true, data: [{ id: 'o1' }], settings: { badges: false }, server_time: '2026-10-18T00:00:00Z' });
    vi.stubGlobal('fetch', answer(200, JSON.stringify(A_QUOTE)));
    expect((await c.quoteCart('s1', QUOTE_BODY))?.totals.total).toBe(1200);
  });

  it('shape checks', () => {
    expect(offersResponseOf(null)).toBeNull();
    expect(offersResponseOf('<html>')).toBeNull();
    expect(offersResponseOf({ enabled: 'yes' })).toBeNull();
    expect(offersResponseOf({ enabled: false, data: [{ id: 'x' }] })?.data).toEqual([]);
    expect(quoteOf({ enabled: true, data: { lines: [] } })).toBeNull();
    expect(quoteOf(A_QUOTE)?.totals.goods).toBe(1200);
  });
});

describe('tracking: offers on a placed order', () => {
  // Free Test order #1002 as the public order view returns it
  const order = {
    discount: { code: 'DASHAIN10', d_value: 1090 },
    delivery_charge: 0,
    delivery_charge_before_promo: 150,
    product_total_price: 5650,
    promo_total: 1090,
    ordered_products: [
      { product_name: 'Cotton Kurta', price: 1200, quantity: 2, promo_discount: 454, free_qty: 0 },
      { product_name: 'Lokta paper notebook', price: 350, quantity: 1, promo_discount: 350, free_qty: 1 },
    ],
    promotions: [
      { promotion_id: 'g', title: 'Free Lokta notebook over Rs 5,000', kind: 'gift', class: 'product', method: 'automatic', amount: 350 },
      { promotion_id: 't', title: 'Buy more, save more · Kurtas', kind: 'tiers', class: 'product', method: 'automatic', amount: 240, detail: { tier: { min: 2, value_type: 'percent', value: 10 } } },
      { promotion_id: 'd', code: 'DASHAIN10', title: 'Dashain 10% off', kind: 'amount_off', class: 'order', method: 'code', amount: 500 },
      { promotion_id: 'f', title: 'Free delivery over Rs 3,000', kind: 'free_delivery', class: 'delivery', method: 'automatic', amount: 150 },
    ],
  };

  it('one row per product / order offer (tiers with their %), delivery waived, nothing left over', () => {
    const s = orderOfferSummary(order)!;
    expect(s.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Free Lokta notebook over Rs 5,000', 350],
      ['Buy more, save more · Kurtas · 10%', 240],
      ['Dashain 10% off · DASHAIN10', 500],
    ]);
    expect(s.other).toBe(0);
    expect(s.delivery).toEqual({ before: 150, after: 0, waived: 150 });
  });

  it('a discount on top of the offers (member tier, staff) gets its own row', () => {
    expect(orderOfferSummary({ ...order, discount: { d_value: 1190 } })!.other).toBe(100);
  });

  it('older orders (no promotions) keep the old discount row', () => {
    expect(orderOfferSummary({ discount: { d_value: 200, code: 'OLD' }, delivery_charge: 100 })).toBeNull();
    expect(orderOfferSummary({ promotions: [] })).toBeNull();
  });

  it('free units on a line', () => {
    expect(orderLineFree(order.ordered_products[1])).toEqual({ free: 1, allFree: true });
    expect(orderLineFree({ quantity: 3, free_qty: 1 })).toEqual({ free: 1, allFree: false });
    expect(orderLineFree({ quantity: 2 })).toEqual({ free: 0, allFree: false });
  });
});

describe('gift choice', () => {
  it('goes to the quote as { offerId: "productId|variantId" }', () => {
    const req = buildQuoteRequest({ lines: [{ product: 'p1', variant: '', quantity: 1 }], giftChoices: { gift1: 'card|' } });
    expect(req.gift_choices).toEqual({ gift1: 'card|' });
  });
});
