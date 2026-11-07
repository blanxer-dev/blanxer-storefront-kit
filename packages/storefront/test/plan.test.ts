import { describe, expect, it } from 'vitest';
import {
  BlanxerApiError,
  availableAtText,
  buildOrderPayload,
  checkoutGroupOf,
  checkoutOrders,
  checkoutPlanBody,
  checkoutPlanKey,
  deliveryByLocation,
  groupOrderRows,
  initialCheckoutValues,
  onlineFulfilmentOf,
  orderNumbersText,
  parcelRows,
  parcelsTitle,
  placedCheckoutNote,
  planChanges,
  quoteCheckout,
  staleCheckoutPlan,
  storesWith,
  toCheckoutPlan,
  toClientStore,
  toStoreAvailability,
  usesCheckoutPlan,
  withPlan,
  type CartItem,
  type DeliveryTable,
  type Quote,
  type Store,
} from '../src/core/index.js';

const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;

// contract plans/multi-outlet/api-contract.md §4.3, field for field
const PLAN_ANSWER = {
  success: true,
  data: {
    plan_id: 'cp_6730',
    expires_at: '2026-11-07T10:30:00.000Z',
    pooled: true,
    split: true,
    place: 'Pokhara',
    cod_available: true,
    parcels: [
      {
        index: 1,
        outlet: { _id: '65a02', name: 'Pokhara', city: 'Pokhara' },
        lines: [{ product: 'p1', variant: 'v1', name: 'Kurta', variant_name: 'M', quantity: 2, unit_price: 1500, line_total: 3000, gift: false, bundle: null }],
        weight: 0.8,
        goods: 3000,
        customization: 0,
        discount: 300,
        delivery_base: 150,
        delivery: 150,
        total: 2850,
        advance: 150,
        cod_to_collect: 2700,
      },
      {
        index: 2,
        outlet: { _id: '65a03', name: 'Butwal', city: 'Butwal' },
        lines: [{ product: 'p2', variant: '', name: 'Shoes', quantity: 1, unit_price: 2000, line_total: 2000, gift: false, bundle: null }],
        weight: 1.2,
        goods: 2000,
        customization: 0,
        discount: 200,
        delivery_base: 0,
        delivery: 0,
        total: 1800,
        advance: 0,
        cod_to_collect: 1800,
      },
    ],
    totals: { goods: 5000, customization: 0, discount: 500, member_discount: 0, delivery_base: 150, delivery: 150, total: 4650 },
    delivery_label: 'Delivery: Pokhara Rs 150 · Butwal free',
    offers: { applications: [], code: null, totals: {} },
    advance: { amount: 150, on_delivery: 4500, total: 4650, basis: 'delivery', required: true, full: false },
    payable: { total: 4650 },
  },
};

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'l1',
  product: 'p1',
  product_name: 'Kurta',
  price: 1500,
  compare_at_price: 0,
  quantity: 2,
  weight: 0.4,
  variant: 'v1',
  variant_name: 'M',
  image_url: '',
  custom_fields: [],
  ...over,
});

const table: DeliveryTable = { defaults: [100, 120, 140, 160, 180, 200], places: [['Pokhara', 'Y', 90, -1, -1, -1, -1, -1], ['Jumla', 'N', 300, 300, 300, 300, 300, 300]] };

describe('the store setting (check_domain online_fulfilment)', () => {
  it('absent or not pooled: today’s path, no plan', () => {
    expect(onlineFulfilmentOf({} as Store)).toEqual({ pooled: false, display_stock: 'website_outlet', show_stores: false, checkout_plan: false });
    expect(usesCheckoutPlan({ online_fulfilment: { pooled: false, display_stock: 'website_outlet', show_stores: false, checkout_plan: false } } as any)).toBe(false);
    expect(usesCheckoutPlan(null)).toBe(false);
  });

  it('a pooled store prices checkout with the plan', () => {
    const s = { online_fulfilment: { pooled: true, display_stock: 'combined', show_stores: true, checkout_plan: true } } as any;
    expect(usesCheckoutPlan(s)).toBe(true);
    expect(onlineFulfilmentOf(s).show_stores).toBe(true);
  });

  it('toClientStore passes online_fulfilment when the backend sends it, adds nothing when it doesn’t', () => {
    const base = { _id: 's1', name: 'Shop', sub_domain: 'shop' } as Store;
    expect('online_fulfilment' in toClientStore(base)).toBe(false);
    const of = { pooled: true, display_stock: 'combined' as const, show_stores: false, checkout_plan: true };
    expect(toClientStore({ ...base, online_fulfilment: of }).online_fulfilment).toEqual(of);
  });
});

describe('the checkout-plan body', () => {
  it('carries the same lines, place, fulfilment and pickup outlet as the order; server-added lines never go', () => {
    const b = checkoutPlanBody({
      storeId: 's1',
      lines: [line(), { ...line({ id: 'g', product: 'gift' }), added_by: 'promo1' } as any, line({ id: 'l2', product: 'p2', variant: '', quantity: 1, customization_charge: 50 })],
      place: 'Pokhara',
      paymentMethod: 'COD',
      offers: { code: ' save10 ', removedOffers: ['a', 'a'], giftChoices: { o1: 'p|v' } },
      phone: '9800000000',
    });
    expect(b).toEqual({
      store_id: 's1',
      products: [
        { product: 'p1', variant: 'v1', quantity: 2, customization_charge: 0, bundle_picks: [] },
        { product: 'p2', variant: '', quantity: 1, customization_charge: 50, bundle_picks: [] },
      ],
      place: 'Pokhara',
      payment: 'cod',
      fulfilment: 'delivery',
      pickup_outlet: null,
      code: 'SAVE10',
      coupon: '',
      gift_choices: { o1: 'p|v' },
      removed_offers: ['a'],
      phone: '9800000000',
    });
  });

  it('an online method is payment online; a pickup names its store; a coupon store sends the coupon id', () => {
    const b = checkoutPlanBody({ storeId: 's1', lines: [line()], place: 'Pokhara', paymentMethod: 'Esewa', pickupOutlet: 'o9', coupon: 'c1', phone: '98' });
    expect(b.payment).toBe('online');
    expect(b.fulfilment).toBe('pickup');
    expect(b.pickup_outlet).toBe('o9');
    expect(b.coupon).toBe('c1');
    expect(b.code).toBe('');
    expect(b.phone).toBe('');
    expect(checkoutPlanBody({ storeId: 's1', lines: [line()], paymentMethod: '' }).payment).toBe('cod');
  });

  it('the key changes with what changes the answer', () => {
    const a = checkoutPlanBody({ storeId: 's1', lines: [line()], place: 'Pokhara', paymentMethod: 'COD' });
    const b = checkoutPlanBody({ storeId: 's1', lines: [line()], place: 'Butwal', paymentMethod: 'COD' });
    expect(checkoutPlanKey(a)).toBe(checkoutPlanKey({ ...a }));
    expect(checkoutPlanKey(a)).not.toBe(checkoutPlanKey(b));
  });
});

describe('the plan as the server sends it', () => {
  const plan = toCheckoutPlan(PLAN_ANSWER)!;

  it('reads §4.3 field for field', () => {
    expect(plan.plan_id).toBe('cp_6730');
    expect(plan.split).toBe(true);
    expect(plan.parcels.map((p) => p.outlet.name)).toEqual(['Pokhara', 'Butwal']);
    expect(plan.totals.delivery).toBe(150);
    expect(plan.payable.total).toBe(4650);
    expect(plan.advance).toEqual({ amount: 150, on_delivery: 4500, total: 4650, basis: 'delivery', required: true, full: false });
    expect(toCheckoutPlan(PLAN_ANSWER.data)?.plan_id).toBe('cp_6730');
  });

  it('anything else is no plan', () => {
    expect(toCheckoutPlan(null)).toBeNull();
    expect(toCheckoutPlan({ success: true })).toBeNull();
    expect(toCheckoutPlan({ data: { plan_id: 'x', parcels: [] } })).toBeNull();
  });

  it('a plan without an advance is plain COD', () => {
    expect(toCheckoutPlan({ data: { ...PLAN_ANSWER.data, advance: null } })?.advance).toBeNull();
  });

  it('says which items ship from which store, and the delivery per location', () => {
    expect(parcelsTitle(plan)).toBe('Arrives in 2 parcels');
    expect(parcelRows(plan)).toEqual([
      { index: 1, from: 'Pokhara', items: 'Kurta (M) ×2', delivery: 150 },
      { index: 2, from: 'Butwal', items: 'Shoes', delivery: 0 },
    ]);
    expect(deliveryByLocation(plan, money)).toBe('Pokhara Rs 150 · Butwal free');
    expect(deliveryByLocation({ ...plan, delivery_label: '' }, money)).toBe('Pokhara Rs 150 · Butwal free');
  });

  it('one parcel: nothing new is shown', () => {
    const one = toCheckoutPlan({ data: { ...PLAN_ANSWER.data, split: false, parcels: [PLAN_ANSWER.data.parcels[0]] } })!;
    expect(parcelsTitle(one)).toBe('');
    expect(deliveryByLocation(one, money)).toBe('');
  });
});

describe('quoteCheckout: a pooled store uses the plan, every other store is unchanged', () => {
  const store = { _id: 's1', name: 'S', sub_domain: 's', setting: { esewa_secret: 'yes' } } as any;
  const input = { store, lines: [line()], delivery: table, place: 'Pokhara', paymentMethod: 'COD', coupon: null };

  it('pooled off = identical output (no plan, plan null)', () => {
    const today = quoteCheckout(input);
    expect(quoteCheckout({ ...input, plan: null })).toEqual(today);
    expect(quoteCheckout({ ...input, plan: undefined })).toEqual(today);
    expect(today.deliveryCharge).toBe(90);
    expect(today.payable).toBe(3090);
    expect(quoteCheckout({ ...input, place: 'Jumla' }).codAllowed).toBe(false);
  });

  it('pooled: the delivery is the sum of the locations, the total and COD are the plan’s', () => {
    const plan = toCheckoutPlan(PLAN_ANSWER)!;
    const q = quoteCheckout({ ...input, plan });
    expect(q.deliveryCharge).toBe(150);
    expect(q.payable).toBe(4650);
    expect(q.codAllowed).toBe(true);
    expect(quoteCheckout({ ...input, place: 'Jumla', plan: { ...plan, cod_available: false } }).codAllowed).toBe(false);
  });
});

describe('the order body', () => {
  const store = { _id: 's1', name: 'S', sub_domain: 's', checkout: {} } as any;
  const base = { store, lines: [line()], values: { ...initialCheckoutValues(store), customer_address_city: 'Pokhara' }, paymentMethod: 'COD', url: 'https://shop.test' };

  it('no plan: the body is exactly as before (no checkout_plan_id)', () => {
    const today = buildOrderPayload(base);
    expect('checkout_plan_id' in today).toBe(false);
    expect(buildOrderPayload({ ...base, checkoutPlanId: null })).toEqual(today);
    expect(buildOrderPayload({ ...base, checkoutPlanId: '' })).toEqual(today);
  });

  it('a pooled checkout sends the plan it showed', () => {
    expect(buildOrderPayload({ ...base, checkoutPlanId: 'cp_6730' })).toEqual({ ...buildOrderPayload(base), checkout_plan_id: 'cp_6730' });
  });
});

describe('withPlan: a store on Offers keeps the quote’s goods and takes the plan’s delivery, advance and total', () => {
  const quote: Quote = {
    lines: [],
    applications: [],
    code: null,
    delivery: { before: 90, discount: 0, after: 90 },
    totals: { gross: 5000, product_discount: 0, order_discount: 500, promo_discount: 500, goods: 4500, delivery: 90, total: 4590 },
    messages: [],
    advance: null,
    payable: { customization: 0, member_discount: 0, total: 4590 },
  };

  it('no plan: the same quote', () => {
    expect(withPlan(quote, null)).toBe(quote);
    expect(withPlan(null, toCheckoutPlan(PLAN_ANSWER))).toBeNull();
  });

  it('with a plan', () => {
    const q = withPlan(quote, toCheckoutPlan(PLAN_ANSWER))!;
    expect(q.delivery).toEqual({ before: 150, discount: 0, after: 150, pending: false });
    expect(q.totals.goods).toBe(4500);
    expect(q.totals.delivery).toBe(150);
    expect(q.payable?.total).toBe(4650);
    expect(q.advance?.amount).toBe(150);
  });

  it('a free-delivery offer shows the locations’ charge struck through', () => {
    const plan = toCheckoutPlan({ data: { ...PLAN_ANSWER.data, totals: { ...PLAN_ANSWER.data.totals, delivery: 0, total: 4500 }, payable: { total: 4500 } } })!;
    expect(withPlan(quote, plan)!.delivery).toMatchObject({ before: 150, after: 0, discount: 150 });
  });
});

describe('a plan that went stale on create (409 CHECKOUT_PLAN_STALE)', () => {
  const err = new BlanxerApiError(409, { message: 'Your delivery details changed. Please check the new total.', error_code: 'CHECKOUT_PLAN_STALE', plan: PLAN_ANSWER.data }, '/order/s1');

  it('gives the server’s words and the fresh plan', () => {
    const s = staleCheckoutPlan(err)!;
    expect(s.message).toBe('Your delivery details changed. Please check the new total.');
    expect(s.plan?.plan_id).toBe('cp_6730');
  });

  it('anything else is not a stale plan', () => {
    expect(staleCheckoutPlan(new BlanxerApiError(400, { message: 'x', stock_error: { code: 'OUT_OF_STOCK', lines: [] } }, '/'))).toBeNull();
    expect(staleCheckoutPlan(new Error('network'))).toBeNull();
  });

  it('says what changed', () => {
    const before = toCheckoutPlan({ data: { ...PLAN_ANSWER.data, parcels: [PLAN_ANSWER.data.parcels[0]], totals: { ...PLAN_ANSWER.data.totals, delivery: 100 }, payable: { total: 4600 } } });
    expect(planChanges(before, toCheckoutPlan(PLAN_ANSWER), money)).toEqual([
      'Now arrives in 2 parcels (was 1).',
      'Delivery: Rs 150 (was Rs 100).',
      'Total: Rs 4,650 (was Rs 4,600).',
    ]);
    expect(planChanges(null, toCheckoutPlan(PLAN_ANSWER), money)).toEqual(['Total: Rs 4,650.']);
  });
});

describe('after create: every order of the checkout', () => {
  // contract §4.4 additive fields
  const res = {
    _id: 'o1',
    order_number: '1043',
    checkout_group: { id: 'g1', count: 2, reason: 'outlet' },
    plan_changed: false,
    orders: [
      { _id: 'o2', order_number: '1044', index: 2, outlet: { _id: '65a03', name: 'Butwal' }, total: 1800, delivery_charge: 0, advance_due: 0, amount_to_pay: 0, status: 'Inactive' },
      { _id: 'o1', order_number: '1043', index: 1, outlet: { _id: '65a02', name: 'Pokhara' }, total: 2850, delivery_charge: 150, advance_due: 150, amount_to_pay: 150, status: 'Inactive' },
    ],
  };

  it('lists the orders by parcel and names their numbers', () => {
    expect(checkoutOrders(res).map((o) => o.order_number)).toEqual(['1043', '1044']);
    expect(orderNumbersText(checkoutOrders(res))).toBe('Orders #1043 and #1044');
    expect(checkoutGroupOf(res)).toEqual({ id: 'g1', count: 2, reason: 'outlet' });
  });

  it('an older backend or an unsplit checkout: nothing new', () => {
    expect(checkoutOrders({ _id: 'o1' })).toEqual([]);
    expect(checkoutGroupOf({ _id: 'o1', checkout_group: null })).toBeNull();
    expect(placedCheckoutNote({ _id: 'o1' })).toBeNull();
    expect(placedCheckoutNote({ _id: 'o1', orders: [res.orders[1]] })).toBeNull();
  });

  it('keeps a note for the order page when split or when the parcels changed', () => {
    expect(placedCheckoutNote(res)?.orders.length).toBe(2);
    expect(placedCheckoutNote({ _id: 'o1', plan_changed: true, orders: [res.orders[1]] })?.plan_changed).toBe(true);
  });

  it('the order page lists this order and its linked orders (contract §4.5)', () => {
    const order = {
      _id: 'o2',
      order_number: '1044',
      status: 'Pending',
      payment_status: 'Unpaid',
      product_total_price: 2000,
      delivery_charge: 0,
      discount: { d_value: 200 },
      fulfilment: { type: 'delivery', outlet_name: 'Butwal' },
      checkout_group: { id: 'g1', index: 2, count: 2, reason: 'outlet' },
      linked_orders: [{ _id: 'o1', order_number: '1043', index: 1, outlet_name: 'Pokhara', status: 'Pending', payment_status: 'Partial', total: 2850, delivery_charge: 150 }],
    };
    expect(groupOrderRows(order).map((r) => [r.order_number, r.from, r.current, r.total])).toEqual([
      ['1043', 'Pokhara', false, 2850],
      ['1044', 'Butwal', true, 1800],
    ]);
    expect(groupOrderRows({ ...order, checkout_group: null })).toEqual([]);
  });
});

describe('stores that have it (bands only)', () => {
  // contract §4.2 store availability
  const raw = {
    success: true,
    enabled: true,
    stores: [
      { _id: 's2', name: 'Butwal', city: 'Butwal', pickup: true, variants: [{ variant: 'v9', band: 'few' }] },
      { _id: 's3', name: 'Pokhara', city: 'Pokhara', pickup: false, variants: [{ variant: 'v9', band: 'in_stock' }, { variant: 'v8', band: 'few' }] },
    ],
  };

  it('names the stores for the picked variant, never a count', () => {
    const a = toStoreAvailability(raw);
    expect(availableAtText(storesWith(a, 'v9'))).toBe('Available at Butwal (few left), Pokhara');
    expect(availableAtText(storesWith(a, 'v8'))).toBe('Available at Pokhara (few left)');
    expect(availableAtText(storesWith(a, 'v7'))).toBe('');
    expect(storesWith(a, '').map((s) => [s.name, s.band])).toEqual([
      ['Butwal', 'few'],
      ['Pokhara', 'in_stock'],
    ]);
    expect(JSON.stringify(a)).not.toMatch(/"(quantity|stock|count)"/);
  });

  it('off, older backends and bad answers show nothing', () => {
    expect(toStoreAvailability({ enabled: false, stores: [] })).toEqual({ enabled: false, stores: [] });
    expect(toStoreAvailability(null).enabled).toBe(false);
    expect(storesWith(null, 'v9')).toEqual([]);
  });
});
