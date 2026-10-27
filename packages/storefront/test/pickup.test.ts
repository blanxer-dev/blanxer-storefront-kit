// Same cases as the Blanxer storefront (src/features/checkout/pickup.test.ts): the helpers are a port.
// Contract: the backend's docs/fulfilment-rules.md FU-1…FU-14 (TSK-154).
import { describe, expect, it } from 'vitest';
import {
  advanceWords,
  buildOrderPayload,
  buildQuoteRequest,
  initialCheckoutValues,
  pickedOutlet,
  pickupBlocks,
  pickupLabel,
  pickupMethods,
  pickupOrderFields,
  pickupOutletsOf,
  pickupPaymentOf,
  pickupStockBody,
  pickupStockLine,
  quoteCheckout,
  quoteKey,
  recommendLine,
  type PickupStockRow,
} from '../src/core/index.js';

const rows: PickupStockRow[] = [
  { _id: 'a', name: 'Thamel', in_stock: false, short: [{ product_id: 'p', variant_id: null, name: 'Pashmina', wanted: 2, available: 1 }] },
  { _id: 'b', name: 'Lalitpur', in_stock: true, short: [] },
];

describe('store pickup', () => {
  it('is offered only when check_domain lists outlets; older stores pay at the store, no advance', () => {
    expect(pickupOutletsOf({})).toEqual([]);
    expect(pickupOutletsOf({ store_pickup: { outlets: [{ _id: 'a', name: 'Thamel' }] } }).length).toBe(1);
    expect(pickupPaymentOf({ store_pickup: { outlets: [] } })).toEqual({ pay_at_store: true, advance: false });
    expect(pickupPaymentOf({ store_pickup: { outlets: [], pay_at_store: false, advance: true } })).toEqual({ pay_at_store: false, advance: false });
  });
  it('keeps the shopper pick while it has the cart, else the recommended store', () => {
    expect(pickedOutlet('b', rows, 'b')).toBe('b');
    expect(pickedOutlet('a', rows, 'b')).toBe('b');
    expect(pickedOutlet('a', [rows[0]!], null)).toBe('a');
  });
  it('says what each store has', () => {
    expect(pickupStockLine(rows[1])).toBe('In stock');
    expect(pickupStockLine(rows[0])).toBe('Only 1 of Pashmina left here');
    expect(recommendLine('a', rows, 'b')).toBe('Lalitpur has everything in your cart.');
    expect(pickupBlocks('pickup', 'a', rows)).toMatch(/another store/);
    expect(pickupBlocks('delivery', '', rows)).toBe('');
  });
  it('shows cash on delivery as Pay at store, or drops it for online-only pickups', () => {
    const methods = [{ name: 'COD', display_name: 'Cash on delivery' }, { name: 'Esewa', display_name: 'eSewa' }];
    expect(pickupMethods(methods, true)[0]).toEqual({ name: 'COD', display_name: 'Pay at store' });
    expect(pickupMethods(methods, false).map((m) => m.name)).toEqual(['Esewa']);
  });
  it('sends fulfilment + pickup_outlet only for a pickup; the quote and the stock body follow', () => {
    expect(pickupOrderFields('delivery', 'a')).toEqual({});
    const body = buildOrderPayload({
      store: {},
      lines: [{ id: 'x', product: 'p', variant: '', quantity: 1 } as any],
      values: initialCheckoutValues({}),
      paymentMethod: 'COD',
      url: 'https://shop.test',
      pickupOutlet: 'b',
    });
    expect(body.fulfilment).toBe('pickup');
    expect(body.pickup_outlet).toBe('b');
    expect(buildOrderPayload({ store: {}, lines: [], values: initialCheckoutValues({}), paymentMethod: 'COD', url: '' }).fulfilment).toBeUndefined();
    const q = buildQuoteRequest({ lines: [{ product: 'p', variant: '', quantity: 1 }], pickup: true });
    expect(q.fulfilment).toBe('pickup');
    expect(quoteKey(q)).not.toBe(quoteKey(buildQuoteRequest({ lines: [{ product: 'p', variant: '', quantity: 1 }] })));
    expect(pickupStockBody('s', [{ product: 'p', quantity: 2 }, { product: 'g', quantity: 1, added_by: 'o' }])).toEqual({
      store_id: 's',
      lines: [{ product: 'p', variant: '', quantity: 2 }],
    });
  });
  it('prices a pickup with no delivery charge and allows paying at the store anywhere', () => {
    const delivery = { defaults: [100, 100, 100, 100, 100, 100], places: [['Kathmandu', false, 100, 100, 100, 100, 100, 100]] } as any;
    const lines = [{ id: 'x', product: 'p', variant: '', quantity: 1, price: 1000, weight: 0 } as any];
    const q = quoteCheckout({ store: {}, lines, delivery, place: 'Kathmandu', paymentMethod: 'COD', pickup: true });
    expect(q.deliveryCharge).toBe(0);
    expect(q.codAllowed).toBe(true);
  });
  it('says the rest is paid at the store, and labels the order read', () => {
    const w = advanceWords({ amount: 500, on_delivery: 1500, total: 2000, required: true } as any, (n: number) => `Rs ${n}`, 'store');
    expect(w.codLine).toBe('Rs 500 online now · rest at the store');
    expect(w.onDeliveryLabel).toBe('Pay at the store');
    expect(pickupLabel({ fulfilment: { type: 'pickup', outlet_name: 'Thamel' } })).toBe('Store pickup · Thamel');
    expect(pickupLabel({})).toBe('');
  });
});
