import { describe, expect, it } from 'vitest';
import {
  buildOrderPayload,
  buildQuoteRequest,
  cartMilestones,
  codeFieldError,
  createLatest,
  BlanxerApiError,
  initialCheckoutValues,
  milestoneBar,
  offerOrderFields,
  offersDisplay,
  offersPlugin,
  productBadges,
  productHint,
  quoteKey,
  quotePayment,
  quoteSavings,
  savingText,
  summaryRows,
  tierRows,
  toClientStore,
  upsellProgress,
  type CartItem,
  type PublicOffer,
  type Quote,
  type Store,
} from '../src/core/index.js';

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'p1_',
  product: 'p1',
  product_name: 'Cotton Kurta',
  price: 1200,
  compare_at_price: 0,
  quantity: 2,
  weight: 0.5,
  variant: '',
  variant_name: '',
  image_url: '',
  custom_fields: [],
  ...over,
});

const base = { description: '', channels: ['web'], display: { public: true, offers_page: true }, skip_on_sale: false, starts_at: null, ends_at: null, code: null, state: 'live' as const };
const cond = { min_amount: null, min_qty: null, payment: 'any' as const, places: [], customers: 'everyone' as const };

const FREE_DELIVERY: PublicOffer = { ...base, id: 'fd', title: 'Free delivery over Rs 3,000', kind: 'free_delivery', method: 'automatic', conditions: { ...cond, min_amount: 3000, places: ['Kathmandu Inside Ring Road'] }, free_delivery: { value_type: 'percent', value: 100 } };
const GIFT: PublicOffer = { ...base, id: 'gift', title: 'Free Lokta notebook over Rs 5,000', kind: 'gift', method: 'automatic', conditions: cond, gift: { trigger: { basis: 'amount', min_amount: 5000 }, items: [{ product_id: 'nb', variant_id: null, qty: 1 }], auto_add: true } };
const TIERS: PublicOffer = {
  ...base,
  id: 'tiers',
  title: 'Buy more, save more · Kurtas',
  kind: 'tiers',
  method: 'automatic',
  conditions: cond,
  tiers: { basis: 'qty', scope: { type: 'categories', categories: ['cat-kurta'] }, levels: [{ min: 2, value_type: 'percent', value: 10 }, { min: 3, value_type: 'percent', value: 15 }, { min: 5, value_type: 'percent', value: 20 }] },
};
const BUNDLE: PublicOffer = { ...base, id: 'bundle', title: 'Dashain look', kind: 'bundle', method: 'automatic', conditions: cond, bundle: { items: [{ product_id: 'p1', qty: 1 }, { product_id: 'topi', qty: 1 }, { product_id: 'slip', qty: 1 }], price_type: 'price', value: 2600 } };

/** A quote shaped like the backend's for 2 Cotton Kurta, with the code applied. */
const quote = (over: Partial<Quote> = {}): Quote => ({
  lines: [
    { key: 'l0', product_id: 'p1', variant_id: null, name: 'Cotton Kurta', unit_price: 1200, qty: 2, gross: 2400, allocations: [{ promotion_id: 'tiers', amount: 240 }], promo_discount: 240, net: 2160, free_qty: 0 },
  ],
  applications: [{ promotion_id: 'tiers', title: 'Buy more, save more · Kurtas', kind: 'tiers', class: 'product', method: 'automatic', amount: 240, detail: { tier: { min: 2, value_type: 'percent', value: 10 } } }],
  code: null,
  delivery: { before: 150, discount: 0, after: 150 },
  totals: { gross: 2400, product_discount: 240, order_discount: 0, promo_discount: 240, goods: 2160, delivery: 150, total: 2310 },
  messages: [
    { type: 'upsell', promotion_id: 'fd', kind: 'free_delivery', text: 'Add Rs 600 more for free delivery', data: { remaining_amount: 600, threshold: 3000 } },
    { type: 'upsell', promotion_id: 'gift', kind: 'gift', text: "You're Rs 2,600 away from Free Lokta notebook over Rs 5,000", data: { remaining_amount: 2600, threshold: 5000 } },
    { type: 'upsell', promotion_id: 'tiers', kind: 'tiers', text: 'Add 1 more to get 15% off — Buy more, save more · Kurtas', data: { remaining_qty: 1, next: { min: 3, value_type: 'percent', value: 15 } } },
  ],
  ...over,
});

describe('offers: quote request', () => {
  it('sends ids and quantities only, never lines the server added', () => {
    const req = buildQuoteRequest({
      lines: [line(), line({ id: 'p2_v2', product: 'p2', variant: 'v2', quantity: 1 }), { product: 'nb', variant: '', quantity: 1, added_by: 'gift' } as any],
    });
    expect(req.products).toEqual([
      { product: 'p1', variant: '', quantity: 2 },
      { product: 'p2', variant: 'v2', quantity: 1 },
    ]);
    expect(JSON.stringify(req)).not.toContain('price');
    expect(req).not.toHaveProperty('code');
    expect(req).not.toHaveProperty('payment');
  });

  it('carries the code (upper case), place, payment, a 10-digit phone, removed offers and gift picks', () => {
    const req = buildQuoteRequest({
      lines: [line()],
      code: '  dashain10 ',
      place: 'Kathmandu Inside Ring Road',
      paymentMethod: 'COD',
      phone: '9841000000',
      removedOffers: ['gift', 'gift'],
      giftChoices: { gift: 'nb|' },
    });
    expect(req).toMatchObject({ code: 'DASHAIN10', place: 'Kathmandu Inside Ring Road', payment: 'cod', phone: '9841000000', removed_offers: ['gift'], gift_choices: { gift: 'nb|' } });
  });

  it('maps payment methods and leaves out a phone that is not 10 digits yet', () => {
    expect([quotePayment('COD'), quotePayment('Esewa'), quotePayment('QR_Dynamic'), quotePayment(''), quotePayment(undefined)]).toEqual(['cod', 'online', 'online', null, null]);
    expect(buildQuoteRequest({ lines: [line()], phone: '98410' })).not.toHaveProperty('phone');
    expect(buildQuoteRequest({ lines: [line()], paymentMethod: '' }).payment).toBeNull();
  });

  it('gives the same key for the same cart and a new key when anything priced changes', () => {
    const a = buildQuoteRequest({ lines: [line()], code: 'X', removedOffers: ['b', 'a'] });
    const b = buildQuoteRequest({ lines: [line()], code: 'x', removedOffers: ['a', 'b'] });
    expect(quoteKey(a)).toBe(quoteKey(b));
    expect(quoteKey(buildQuoteRequest({ lines: [line({ quantity: 3 })], code: 'X' }))).not.toBe(quoteKey(a));
    expect(quoteKey(buildQuoteRequest({ lines: [line()], code: 'X', removedOffers: ['b', 'a'], place: 'Pokhara' }))).not.toBe(quoteKey(a));
  });
});

describe('offers: order payload', () => {
  const store: Partial<Store> = { checkout: {} };
  const values = { ...initialCheckoutValues(store), customer_full_name: 'Test Shopper', customer_phone_number: '9841000000' };

  it('stores on Offers send code, removed_offers and gift_choices, an empty coupon, and no server-added lines', () => {
    const p = buildOrderPayload({
      store,
      lines: [line(), { ...line({ id: 'nb_', product: 'nb' }), added_by: 'gift' } as any],
      values,
      paymentMethod: 'COD',
      url: 'https://shop.test',
      couponId: 'should-not-be-sent',
      offers: { code: 'dashain10', removedOffers: ['fd'], giftChoices: { gift: 'nb|' } },
    });
    expect(p.products).toEqual([{ product: 'p1', variant: '', quantity: 2 }]);
    expect(p.coupon).toBe('');
    expect(p.code).toBe('DASHAIN10');
    expect(p.removed_offers).toEqual(['fd']);
    expect(p.gift_choices).toEqual({ gift: 'nb|' });
  });

  it('leaves empty offer fields out', () => {
    expect(offerOrderFields({ code: '', removedOffers: [], giftChoices: {} })).toEqual({});
    const p = buildOrderPayload({ store, lines: [line()], values, paymentMethod: 'COD', url: 'u', offers: {} });
    expect(p).not.toHaveProperty('code');
    expect(p).not.toHaveProperty('removed_offers');
    expect(p).not.toHaveProperty('gift_choices');
  });

  it('stores not on Offers keep the coupon payload exactly as before', () => {
    const p = buildOrderPayload({ store, lines: [line()], values, paymentMethod: 'COD', url: 'u', couponId: 'c1' });
    expect(p.coupon).toBe('c1');
    expect(p).not.toHaveProperty('code');
    expect(p).not.toHaveProperty('removed_offers');
    expect(p).not.toHaveProperty('gift_choices');
  });

  it("maps a rejected code's field error from the order call", () => {
    const err = new BlanxerApiError(401, { fields: { code: 'DASHAIN10 has been used up.' } }, '/order/s');
    expect(codeFieldError(err)).toBe('DASHAIN10 has been used up.');
    expect(err.message).toBe('Blanxer API 401 for /order/s');
    expect(codeFieldError(new BlanxerApiError(400, { fields: { customer_phone_number: 'bad' } }, '/order/s'))).toBe('');
    expect(codeFieldError(new Error('network'))).toBe('');
  });
});

describe('offers: on or off', () => {
  it('reads the plugin as a hint; no plugin or enabled:false means the coupon flow', () => {
    expect(offersPlugin({ plugins: [] })).toBeNull();
    expect(offersPlugin({ plugins: [{ name: 'offers', details: { enabled: false } }] })?.enabled).toBe(false);
    const on = offersPlugin({ plugins: [{ name: 'offers', details: { display: { badges: false, colors: { gift: '#000000' } } } }] });
    expect(on?.enabled).toBe(true);
    expect(on?.display.badges).toBe(false);
    expect(on?.display.colors).toMatchObject({ gift: '#000000', tier: '#0e7490' });
    expect(on?.display.cart_progress).toBe(true);
  });

  it('lets only { enabled, display } of the offers plugin reach the browser', () => {
    const store = {
      _id: 's',
      name: 'S',
      sub_domain: 's',
      plugins: [
        { name: 'offers', details: { enabled: true, display: { badges: true }, secret_rule: 'x' } },
        { name: 'tigg', details: { token: 'secret' } },
      ],
    } as Store;
    const client = toClientStore(store);
    expect(client.plugins).toEqual([{ name: 'offers', details: { enabled: true, display: { badges: true } } }]);
  });

  it('badges and hints are empty without offers or with badges turned off', () => {
    const product = { _id: 'p1', price: 1200, categories: ['Kurta'] };
    const cats = [{ _id: 'cat-kurta', name: 'Kurta', slug: 'kurta' }];
    expect(productBadges(product, [], offersDisplay(null), cats)).toEqual([]);
    expect(productBadges(product, [TIERS], offersDisplay({ badges: false }), cats)).toEqual([]);
    expect(productBadges(product, [TIERS, BUNDLE], offersDisplay(null), cats).map((b) => b.text)).toEqual(['Buy 2 · save 10%', 'Dashain look']);
    // listings carry category names, product pages ids: both match
    expect(productHint({ _id: 'p1', categories: ['cat-kurta'] }, [TIERS], cats)?.text).toBe('Buy 3, save 15%');
    expect(productHint({ _id: 'other', categories: ['Tea'] }, [TIERS], cats)).toBeNull();
  });
});

describe('offers: reading the quote', () => {
  it('progress comes from an upsell message (remaining against threshold)', () => {
    expect(upsellProgress({ type: 'upsell', text: '', data: { remaining_amount: 600, threshold: 3000 } })).toEqual({ remaining: 600, threshold: 3000, reached: 2400, fraction: 0.8 });
    expect(upsellProgress({ type: 'upsell', text: '', data: { remaining_amount: 3800 } }, 5000)?.fraction).toBeCloseTo(0.24);
    expect(upsellProgress({ type: 'upsell', text: '', data: { remaining_qty: 1 } })).toBeNull();
    expect(upsellProgress(null)).toBeNull();
  });

  it('milestones: open ones from upsell messages, done ones from applications and gift lines', () => {
    const open = cartMilestones(quote(), [GIFT, FREE_DELIVERY, TIERS]);
    expect(open.map((m) => [m.promotion_id, m.done, m.remaining])).toEqual([
      ['fd', false, 600],
      ['gift', false, 2600],
    ]);
    expect(milestoneBar(open)).toEqual({ max: 5000, reached: 2400, fraction: 0.48, allDone: false });

    const done = cartMilestones(
      quote({
        lines: [
          ...quote().lines,
          { key: 'offer:gift:nb:', product_id: 'nb', variant_id: null, name: 'Lokta paper notebook', unit_price: 350, qty: 1, gross: 350, allocations: [{ promotion_id: 'gift', amount: 350 }], promo_discount: 350, net: 0, free_qty: 1, added_by: 'gift' },
        ],
        applications: [...quote().applications, { promotion_id: 'fd', title: 'Free delivery over Rs 3,000', kind: 'free_delivery', class: 'delivery', method: 'automatic', amount: 0, detail: { pending: true } }],
        delivery: { before: null, discount: 0, after: null, promotion_id: 'fd', pending: true },
        messages: [],
      }),
      [FREE_DELIVERY, GIFT],
    );
    expect(done.map((m) => [m.promotion_id, m.done, m.pending])).toEqual([
      ['fd', true, true],
      ['gift', true, false],
    ]);
    expect(milestoneBar(done)?.allDone).toBe(true);
  });

  it('an offer the quote says nothing about (not for this place) is left out', () => {
    expect(cartMilestones(quote({ messages: [] }), [FREE_DELIVERY])).toEqual([]);
    expect(cartMilestones(null, [FREE_DELIVERY])).toEqual([]);
  });

  it('summary rows and savings are the server amounts', () => {
    const q = quote({
      applications: [
        ...quote().applications,
        { promotion_id: 'd10', title: 'Dashain 10% off', kind: 'amount_off', class: 'order', method: 'code', code: 'DASHAIN10', amount: 216 },
        { promotion_id: 'fd', title: 'Free delivery', kind: 'free_delivery', class: 'delivery', method: 'automatic', amount: 150 },
      ],
      delivery: { before: 150, discount: 150, after: 0, promotion_id: 'fd' },
      totals: { gross: 2400, product_discount: 240, order_discount: 216, promo_discount: 456, goods: 1944, delivery: 0, total: 1944 },
    });
    expect(summaryRows(q).map((r) => [r.label, r.amount])).toEqual([
      ['Buy more, save more · Kurtas', 240],
      ['Dashain 10% off · DASHAIN10', 216],
    ]);
    expect(quoteSavings(q)).toBe(606);
    expect(quoteSavings(null)).toBe(0);
  });

  it('the active tier is the one the quote applied', () => {
    expect(tierRows(TIERS, quote()).map((r) => [r.label, r.value, r.active])).toEqual([
      ['Buy 2', '10% off', true],
      ['Buy 3', '15% off', false],
      ['Buy 5+', '20% off', false],
    ]);
    expect(tierRows(TIERS, null).some((r) => r.active)).toBe(false);
  });

  it('badge saving text follows saving_as ("bigger": % under Rs 100, rupees above)', () => {
    expect(savingText('percent', 15, 500, 'bigger')).toBe('15% off');
    expect(savingText('percent', 15, 1200, 'bigger')).toBe('Save Rs 180');
    expect(savingText('percent', 15, 1200, 'percent')).toBe('15% off');
    expect(savingText('fixed', 200, 1000, 'amount')).toBe('Save Rs 200');
  });
});

describe('offers: stale responses', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('drops an older answer that arrives after a newer request, and aborts it', async () => {
    const latest = createLatest<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    let firstSignal: AbortSignal | undefined;
    const a = latest.run((signal) => {
      firstSignal = signal;
      return first.promise;
    });
    const b = latest.run(() => second.promise);
    expect(firstSignal?.aborted).toBe(true);
    second.resolve('new');
    first.resolve('old');
    expect(await b).toEqual({ stale: false, value: 'new' });
    expect(await a).toEqual({ stale: true });
  });

  it('a failure of a replaced request is stale too; the newest one still throws', async () => {
    const latest = createLatest<string>();
    const a = latest.run(() => Promise.reject(new Error('aborted')));
    const b = latest.run(() => Promise.reject(new Error('rate limited')));
    expect(await a).toEqual({ stale: true });
    await expect(b).rejects.toThrow('rate limited');
  });

  it('cancel makes every pending answer stale', async () => {
    const latest = createLatest<number>();
    const d = deferred<number>();
    const a = latest.run(() => d.promise);
    latest.cancel();
    d.resolve(1);
    expect(await a).toEqual({ stale: true });
  });
});
