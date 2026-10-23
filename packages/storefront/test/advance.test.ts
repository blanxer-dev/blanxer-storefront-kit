// Same cases as the Blanxer storefront (src/features/checkout/advance.test.ts), updated for the built backend (2026-10-23 contract changes).
import { describe, expect, it } from 'vitest';
import {
  activeAdvance,
  advanceBlocks,
  advanceInitLine,
  advanceOrderFields,
  advanceSplit,
  advanceWords,
  cartSignature,
  codOffer,
  parsePending,
  paymentDue,
  pendingDue,
  placedAmount,
  holdSecondsOf,
  quotePayable,
  pendingFor,
  pickAdvanceVia,
  retryRefused,
  toAdvance,
  toCollectOnDelivery,
  failedOrderId,
} from '../src/core/index.js';

const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;
const quoted = { amount: 150, on_delivery: 2350, total: 2500, basis: 'delivery', required: true, full: false };
const online = ['QR_Dynamic', 'Esewa', 'Khalti'];

describe('advance from the quote', () => {
  it('takes the server numbers as they are', () => {
    expect(toAdvance(quoted)).toEqual(quoted);
    expect(toAdvance({ ...quoted, basis: 'percent', required: false })).toMatchObject({ basis: 'percent', required: false });
  });
  it('no advance in the quote means plain COD', () => {
    expect(toAdvance(null)).toBeNull();
    expect(toAdvance(undefined)).toBeNull();
    expect(toAdvance({})).toBeNull();
    expect(toAdvance({ ...quoted, amount: 0 })).toBeNull();
    expect(toAdvance({ ...quoted, amount: '150' })).toBeNull();
    expect(toAdvance({ ...quoted, on_delivery: -1 })).toBeNull();
    expect(codOffer(toAdvance(null))).toEqual({ mode: 'plain' });
  });
});

describe('how cash on delivery is offered', () => {
  it('required: COD only with the advance', () => {
    const a = toAdvance(quoted)!;
    expect(codOffer(a)).toEqual({ mode: 'advance', advance: a, optional: false });
  });
  it("shopper's choice keeps plain COD", () => {
    const a = toAdvance({ ...quoted, required: false })!;
    expect(codOffer(a)).toEqual({ mode: 'advance', advance: a, optional: true });
    expect(pickAdvanceVia('', online, { optional: true })).toBe('');
    expect(activeAdvance('COD', codOffer(a), '', online)).toBeNull();
    expect(advanceBlocks('COD', codOffer(a), '', online)).toBe(false);
  });
  it('an advance that is the whole order: no COD when required, plain COD when not', () => {
    const full = toAdvance({ ...quoted, amount: 2500, on_delivery: 0, full: true })!;
    expect(codOffer(full).mode).toBe('hidden');
    expect(codOffer({ ...full, required: false })).toEqual({ mode: 'plain' });
  });
});

describe('the advance method', () => {
  it('required: keeps the pick, else the remembered online method, else the first', () => {
    expect(pickAdvanceVia('Esewa', online, { optional: false })).toBe('Esewa');
    expect(pickAdvanceVia('', online, { optional: false, preferred: 'Khalti' })).toBe('Khalti');
    expect(pickAdvanceVia('', online, { optional: false, preferred: 'COD' })).toBe('QR_Dynamic');
    expect(pickAdvanceVia('FonePay', online, { optional: false })).toBe('QR_Dynamic');
    expect(pickAdvanceVia('', [], { optional: false })).toBe('');
  });
  it('a required advance without a method blocks Place order', () => {
    const offer = codOffer(toAdvance(quoted));
    expect(advanceBlocks('COD', offer, '', online)).toBe(true);
    expect(advanceBlocks('COD', offer, 'Esewa', online)).toBe(false);
    expect(advanceBlocks('Esewa', offer, '', online)).toBe(false);
  });
});

describe('what the order sends', () => {
  it('advance_via only with COD where the advance applies', () => {
    const offer = codOffer(toAdvance(quoted));
    const a = activeAdvance('COD', offer, 'Esewa', online);
    expect(a).toMatchObject({ amount: 150 });
    expect(advanceOrderFields(a, 'Esewa')).toEqual({ advance_via: 'Esewa' });
    expect(activeAdvance('Esewa', offer, 'Esewa', online)).toBeNull();
    expect(advanceOrderFields(null, 'Esewa')).toEqual({});
    expect(activeAdvance('COD', codOffer(null), 'Esewa', online)).toBeNull();
    expect(activeAdvance('COD', offer, 'NPX', online)).toBeNull();
    expect(advanceOrderFields(toAdvance(quoted), 'COD')).toEqual({});
  });
});

describe('advance words', () => {
  it('tile, picker, summary and button read the server amounts', () => {
    const w = advanceWords(toAdvance(quoted)!, money);
    expect(w.codLine).toBe('Rs 150 now · rest on delivery');
    expect(w.pickerLabel).toBe('Pay the Rs 150 advance with');
    expect(w.payNowLabel).toBe('Pay now (advance)');
    expect(w.onDeliveryLabel).toBe('Pay on delivery');
    expect(w.button).toBe('Pay Rs 150 & place order');
    expect(w.underButton).toBe('Rs 2,350 cash on delivery');
    expect(w.noAdvance).toBe('No advance: pay Rs 2,500 on delivery');
    expect(w.live).toBe('Pay Rs 150 now and Rs 2,350 on delivery.');
    expect(advanceWords(toAdvance({ ...quoted, required: false })!, money).codLine).toBe('or Rs 150 now · rest on delivery');
  });
});

const order = (o: any) => ({
  _id: 'o1',
  order_number: 1234,
  status: 'Inactive',
  payment_status: 'Processing',
  payment_method: 'COD',
  product_total_price: 2300,
  customization_total: 0,
  delivery_charge: 200,
  discount: { d_value: 0 },
  advance: null,
  amount_to_pay: 0,
  ...o,
});

describe('paying an order again', () => {
  it('an advance not paid yet is due on the same order', () => {
    const adv = { status: 'due', amount: 150, on_delivery: 2350, via: 'QR_Dynamic', gateway: null, paid_at: null };
    const due = paymentDue(order({ advance: adv, amount_to_pay: 150 }));
    expect(due).toEqual({ order_id: 'o1', order_number: '1234', amount: 150, on_delivery: 2350, advance: true, via: 'QR_Dynamic' });
    // the server's amount_to_pay wins; without it, the advance's amount
    expect(paymentDue(order({ advance: adv, amount_to_pay: 160 }))?.amount).toBe(160);
    expect(paymentDue(order({ advance: adv, amount_to_pay: undefined }))?.amount).toBe(150);
  });
  it('an online order not paid yet is due in full', () => {
    // amount_to_pay is the whole order with delivery; nothing is worked out from the lines
    expect(paymentDue(order({ payment_method: 'Esewa', payment_status: 'Failed', amount_to_pay: 2500 }))).toEqual({
      order_id: 'o1',
      order_number: '1234',
      amount: 2500,
      on_delivery: null,
      advance: false,
      via: 'Esewa',
    });
    expect(paymentDue(order({ payment_method: 'Esewa', payment_status: 'Failed', amount_to_pay: 0 }))).toBeNull();
    expect(paymentDue(order({ payment_method: 'Esewa', payment_status: 'Failed', amount_to_pay: undefined }))).toBeNull();
  });
  it('nothing is due once paid, cancelled, or on plain COD', () => {
    expect(paymentDue(order({ advance: { status: 'paid', amount: 150, on_delivery: 2350 }, status: 'Pending', payment_status: 'Partial' }))).toBeNull();
    for (const ps of ['Paid', 'Partial', 'Waiting Reconcile', 'Refunded'])
      expect(paymentDue(order({ payment_method: 'Esewa', payment_status: ps }))).toBeNull();
    expect(paymentDue(order({ payment_method: 'Esewa', status: 'Cancelled' }))).toBeNull();
    expect(paymentDue(order({ status: 'Pending' }))).toBeNull();
    expect(paymentDue(order({}))).toBeNull();
    expect(paymentDue(null)).toBeNull();
  });
  it('a refused retry says why', () => {
    expect(retryRefused('This order is already paid.')).toBe('paid');
    expect(retryRefused('The advance for this order is already paid.')).toBe('paid');
    expect(retryRefused('This order was cancelled. Place a new order.')).toBe('cancelled');
    expect(retryRefused('Fonepay is down')).toBeNull();
  });
});

describe('after the advance is paid', () => {
  it('splits paid online and on delivery', () => {
    expect(advanceSplit({ advance: { status: 'paid', amount: 150, on_delivery: 2350 } })).toEqual({ paid: 150, on_delivery: 2350 });
    expect(advanceSplit({ advance: { status: 'due', amount: 150, on_delivery: 2350 } })).toBeNull();
    expect(advanceSplit({})).toBeNull();
    // the courier's figure (net of refunds) when the read has it
    expect(advanceSplit({ advance: { status: 'paid', amount: 150, on_delivery: 2350 }, cod_to_collect: 2400 })).toEqual({ paid: 150, on_delivery: 2400 });
    expect(advanceSplit({ advance: { status: 'paid', amount: 150, on_delivery: 2350 }, cod_to_collect: 0 })).toEqual({ paid: 150, on_delivery: 0 });
    expect(advanceSplit({ advance: { status: 'paid', amount: 150, on_delivery: 2350 }, cod_to_collect: '2400' })).toEqual({ paid: 150, on_delivery: 2350 });
  });
  it('payment screens name the order and the cash part', () => {
    expect(advanceInitLine({ order_number: 1234, amount: 150, advance: { amount: 150, on_delivery: 2350 } }, money)).toBe(
      'Advance for order #1234 · Rs 2,350 on delivery',
    );
    expect(advanceInitLine({ advance: { amount: 150, on_delivery: 2350 } }, money)).toBe('Advance · Rs 2,350 on delivery');
    expect(advanceInitLine({ amount: 2500, advance: null }, money)).toBeNull();
  });
});

describe('the order waiting for payment', () => {
  it('asks for what create-order said: the advance, else the order total', () => {
    expect(placedAmount({ amount_to_pay: 150, total_price: 2300, delivery_charge: 200, advance: { amount: 150, on_delivery: 2350 } })).toBe(150);
    expect(placedAmount({ amount_to_pay: 2500, total_price: 2300, delivery_charge: 200, advance: null })).toBe(2500);
    expect(placedAmount({ advance: { amount: 150, on_delivery: 2350 } })).toBe(150);
    // total_price excludes delivery: never summed here
    expect(placedAmount({ total_price: 2300, delivery_charge: 200, advance: null })).toBe(0);
    expect(placedAmount({})).toBe(0);
  });
  it('belongs to the cart it was placed with', () => {
    const sig = cartSignature([
      { id: 'a_1', quantity: 2 },
      { id: 'b_2', quantity: 1 },
    ]);
    expect(sig).toBe(cartSignature([{ id: 'b_2', quantity: 1 }, { id: 'a_1', quantity: 2 }]));
    expect(sig).not.toBe(cartSignature([{ id: 'a_1', quantity: 3 }, { id: 'b_2', quantity: 1 }]));
    const p = parsePending(JSON.stringify({ order_id: 'o1', order_number: 7, lines: ['a_1', 'b_2'], signature: sig, method: 'Esewa', advance: null }));
    expect(p).toMatchObject({ order_id: 'o1', order_number: '7', lines: ['a_1', 'b_2'] });
    expect(pendingFor(p, sig)).toBe(p);
    expect(pendingFor(p, 'other')).toBeNull();
    expect(pendingDue(p!)).toEqual({ order_id: 'o1', order_number: '7', amount: 0, on_delivery: null, advance: false, via: 'Esewa' });
    const adv = parsePending(JSON.stringify({ order_id: 'o2', lines: [], signature: sig, method: 'QR_Dynamic', amount: 150, advance: { amount: 150, on_delivery: 2350, required: false } }));
    expect(pendingDue(adv!)).toEqual({ order_id: 'o2', order_number: '', amount: 150, on_delivery: 2350, advance: true, via: 'QR_Dynamic' });
    expect(adv!.advance!.required).toBe(false);
    expect(parsePending('not json')).toBeNull();
    expect(parsePending(JSON.stringify({ order_id: '' }))).toBeNull();
  });
});

describe('server totals and the hold', () => {
  it('the quote payable is shown as it is (customization and member discount included)', () => {
    expect(quotePayable({ totals: { total: 2500 }, payable: { customization: 80, member_discount: 240, total: 2340 } })).toBe(2340);
    expect(quotePayable({ payable: { total: 0 } })).toBe(0);
    expect(quotePayable({ totals: { total: 2500 } })).toBeNull();
    expect(quotePayable({ payable: { total: '2340' } })).toBeNull();
    expect(quotePayable({ payable: { total: -1 } })).toBeNull();
    expect(quotePayable(null)).toBeNull();
  });
  it('the hold left from an init answer; none = no countdown', () => {
    expect(holdSecondsOf({ hold_seconds: 280, hold_expires_at: '…' })).toBe(280);
    expect(holdSecondsOf({ hold_seconds: '120' })).toBe(120);
    expect(holdSecondsOf({ hold_seconds: 0 })).toBeNull();
    expect(holdSecondsOf({})).toBeNull();
    expect(holdSecondsOf(null)).toBeNull();
  });
});

describe('to pay on delivery', () => {
  it('the advance part while it is unpaid, the server cod_to_collect once paid or without an advance', () => {
    // before the advance is paid cod_to_collect is still the whole total
    expect(toCollectOnDelivery({ cod_to_collect: 2500, advance: { status: 'due', amount: 150, on_delivery: 2350 } })).toBe(2350);
    expect(toCollectOnDelivery({ cod_to_collect: 2500, advance: { due: 150, on_delivery: 2350 } })).toBe(2350);
    expect(toCollectOnDelivery({ cod_to_collect: 2400, advance: { status: 'paid', amount: 150, on_delivery: 2350, paid_at: 'x' } })).toBe(2400);
    expect(toCollectOnDelivery({ cod_to_collect: 2000, advance: null })).toBe(2000);
    expect(toCollectOnDelivery({ advance: { status: 'paid', amount: 150, on_delivery: 2350 } })).toBe(2350);
    expect(toCollectOnDelivery({})).toBeNull();
  });
});

describe('the failed payment page', () => {
  it('pays again the waiting order, else the order the gateway sent back', () => {
    const a = '64b7f0c2a1b2c3d4e5f60718';
    const b = '64b7f0c2a1b2c3d4e5f60719';
    expect(failedOrderId([a, b], b)).toBe(a);
    expect(failedOrderId([null, b], undefined)).toBe(b);
    expect(failedOrderId([null, null], b)).toBe(b);
    expect(failedOrderId([undefined], [b])).toBe(b);
    expect(failedOrderId([], 'not-an-id')).toBeNull();
    expect(failedOrderId([], '<script>')).toBeNull();
    expect(failedOrderId([], undefined)).toBeNull();
  });
});
