import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceFromAnswer,
  advanceInitLine,
  advancePaymentOn,
  advanceSplit,
  advanceWords,
  buildOrderPayload,
  codOffer,
  holdSecondsOf,
  initialCheckoutValues,
  orderAdvance,
  paymentDue,
  payOrderView,
  pendingDue,
  placedAmount,
  quoteOf,
  quotePayable,
  retryRefused,
  toAdvance,
  toCollectOnDelivery,
  type CartItem,
  type PaymentMethod,
} from '../src/core/index.js';
import { AdvanceSummaryRows } from '../src/react/advance-ui.js';
import { PaymentDueBox } from '../src/react/pay-order.js';
import {
  CREATED_ADVANCE_ORDER,
  CREATED_COD_ORDER,
  CREATED_ONLINE_ORDER,
  ORDER_ID,
  PUBLIC_ADVANCE_DUE,
  PUBLIC_ADVANCE_PAID,
  PUBLIC_ADVANCE_PART_REFUNDED,
  PUBLIC_COD,
  PUBLIC_ONLINE_UNPAID,
  QR_INIT_ADVANCE,
  QR_INIT_AFTER_HOLD,
  QR_START_ADVANCE,
  QUOTE_ADVANCE,
  QUOTE_OFFERS_OFF,
  QUOTE_ON_OFFERS,
  REFUSED,
  STORE_ID,
  STORE_WITH_ADVANCE,
} from './contract.fixtures.js';

// The advance payment read end to end from backend answers shaped exactly like the backend's
// (contract.fixtures.ts), what goes on the wire, and the words the shopper sees. Shared helper
// cases: advance.test.ts; kit-only helpers: advance-kit.test.ts.

const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;
const AMOUNT_KEYS = ['amount', 'amount_to_pay', 'advance', 'advance_amount', 'partial_payment_amount', 'total', 'total_price', 'price', 'payable', 'on_delivery'];

describe('backend contract: the quote (§B)', () => {
  it("the quote's advance as the backend sends it: same six fields, same numbers", () => {
    const a = advanceFromAnswer(QUOTE_OFFERS_OFF);
    expect(a).toEqual(QUOTE_ADVANCE);
    expect(Object.keys(a!).sort()).toEqual(['amount', 'basis', 'full', 'on_delivery', 'required', 'total']);
    expect(toAdvance(quoteOf(QUOTE_ON_OFFERS)?.advance)).toEqual(QUOTE_ON_OFFERS.data.advance);
    expect(advanceFromAnswer(QUOTE_ON_OFFERS)).toEqual(QUOTE_ON_OFFERS.data.advance);
  });
  it('the total shown is payable.total, never totals.total plus our own customization', () => {
    const q = quoteOf(QUOTE_ON_OFFERS)!;
    expect(quotePayable(q)).toBe(2340);
    expect(quotePayable(q)).not.toBe(q.totals.total);
  });
  it('the words carry the quote amounts unchanged', () => {
    const w = advanceWords(advanceFromAnswer(QUOTE_ON_OFFERS)!, money);
    expect(w.button).toBe('Pay Rs 150 & place order');
    expect(w.modalNote).toBe('Rs 2,190 cash on delivery');
    expect(w.noAdvance).toBe('Pay all Rs 2,340 on delivery instead');
  });
  it('full: the advance is the whole order', () => {
    const full = { ...QUOTE_ADVANCE, amount: 2500, on_delivery: 0, full: true };
    expect(codOffer(advanceFromAnswer({ ...QUOTE_OFFERS_OFF, data: { ...QUOTE_OFFERS_OFF.data, advance: full } }))).toEqual({ mode: 'hidden', advance: full });
  });
  it('check_domain says only whether to ask, never how much', () => {
    expect(advancePaymentOn(STORE_WITH_ADVANCE)).toBe(true);
    // the setting is not an advance: its percent / basis are never turned into an amount
    expect(toAdvance(STORE_WITH_ADVANCE.checkout.advance_payment)).toBeNull();
  });
});

describe('backend contract: create-order (§C)', () => {
  it('Pay Rs X after placing is amount_to_pay, never total_price', () => {
    expect(placedAmount(CREATED_ADVANCE_ORDER)).toBe(150);
    expect(placedAmount({ ...CREATED_ADVANCE_ORDER, amount_to_pay: 149 })).toBe(149);
    expect(placedAmount(CREATED_ONLINE_ORDER)).toBe(2500);
    expect(placedAmount(CREATED_COD_ORDER)).toBe(0);
    expect(orderAdvance(CREATED_ADVANCE_ORDER)).toEqual({ amount: 150, on_delivery: 2350, required: true });
    expect(orderAdvance(CREATED_ONLINE_ORDER)).toBeNull();
    expect(holdSecondsOf(CREATED_ADVANCE_ORDER)).toBe(300);
    expect(holdSecondsOf(CREATED_COD_ORDER)).toBeNull();
  });
});

describe('backend contract: payment init (§D)', () => {
  it('a QR init: the line names the order and the cash part, the timer is its hold_seconds', () => {
    expect(advanceInitLine(QR_START_ADVANCE, money)).toBe('Advance for order #1234 · Rs 2,350 on delivery');
    expect(holdSecondsOf(QR_START_ADVANCE)).toBe(240);
    expect(holdSecondsOf(QR_INIT_AFTER_HOLD)).toBeNull();
  });
  it("a refused retry: the backend's words, word for word", () => {
    expect(retryRefused(REFUSED.paid)).toBe('paid');
    expect(retryRefused(REFUSED.advancePaid)).toBe('paid');
    expect(retryRefused(REFUSED.cancelled)).toBe('cancelled');
  });
});

describe('backend contract: the public order read (§F)', () => {
  it('advance due: Pay amount_to_pay on the same order, on delivery is the advance part', () => {
    expect(paymentDue(PUBLIC_ADVANCE_DUE)).toEqual({ order_id: ORDER_ID, order_number: '1234', amount: 150, on_delivery: 2350, advance: true, via: 'QR_Dynamic' });
    expect(paymentDue({ ...PUBLIC_ADVANCE_DUE, amount_to_pay: 149 })?.amount).toBe(149);
    expect(toCollectOnDelivery(PUBLIC_ADVANCE_DUE)).toBe(2350);
    expect(advanceSplit(PUBLIC_ADVANCE_DUE)).toBeNull();
  });
  it('advance paid: nothing due, the split reads the server cod_to_collect', () => {
    expect(paymentDue(PUBLIC_ADVANCE_PAID)).toBeNull();
    expect(advanceSplit(PUBLIC_ADVANCE_PAID)).toEqual({ paid: 150, on_delivery: 2350 });
    expect(advanceSplit(PUBLIC_ADVANCE_PART_REFUNDED)).toEqual({ paid: 150, on_delivery: 2400 });
    expect(toCollectOnDelivery(PUBLIC_ADVANCE_PART_REFUNDED)).toBe(2400);
  });
  it('an online order not paid: due in full (amount_to_pay); plain COD: nothing due', () => {
    expect(paymentDue(PUBLIC_ONLINE_UNPAID)).toMatchObject({ amount: 2500, advance: false, on_delivery: null, via: 'Esewa' });
    expect(paymentDue(PUBLIC_COD)).toBeNull();
    expect(toCollectOnDelivery(PUBLIC_COD)).toBe(2500);
  });
  it('every field the kit reads is in the backend answers', () => {
    const has = (o: any, keys: string[], what: string) => {
      for (const k of keys) expect(o, `${what}.${k}`).toHaveProperty(k);
    };
    has(QUOTE_ON_OFFERS.data, ['advance', 'payable', 'lines', 'totals'], 'quote');
    has(QUOTE_OFFERS_OFF.data, ['advance', 'totals'], 'quote (offers off)');
    has(QUOTE_ADVANCE, ['amount', 'on_delivery', 'total', 'basis', 'required', 'full'], 'quote.advance');
    has(CREATED_ADVANCE_ORDER, ['_id', 'order_number', 'amount_to_pay', 'advance', 'hold_seconds', 'meta'], 'create-order');
    has(CREATED_ADVANCE_ORDER.advance, ['amount', 'on_delivery', 'basis', 'required'], 'create-order.advance');
    has(QR_INIT_ADVANCE, ['transaction', 'amount', 'amount_to_pay', 'order_number', 'advance', 'hold_seconds'], 'QR init');
    for (const o of [PUBLIC_ADVANCE_DUE, PUBLIC_ADVANCE_PAID])
      has(o, ['_id', 'order_number', 'status', 'payment_status', 'payment_method', 'advance', 'amount_to_pay', 'cod_to_collect'], 'order read');
    has(PUBLIC_ADVANCE_DUE.advance, ['status', 'amount', 'on_delivery', 'gateway', 'paid_at', 'via'], 'order read.advance');
  });
});

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'p1_v1',
  product: 'p1',
  product_name: 'Tee',
  price: 1000,
  compare_at_price: 1200,
  quantity: 2,
  weight: 0.5,
  variant: 'v1',
  variant_name: 'Red/M',
  image_url: '',
  custom_fields: [],
  ...over,
});

describe('the create-order body', () => {
  const base = {
    store: { _id: STORE_ID },
    lines: [line(), line({ id: 'p2_', product: 'p2', variant: '', price: 500 })],
    values: { ...initialCheckoutValues(null), customer_address_city: 'Kathmandu' },
    url: 'https://shop.test',
  };
  it('the order body never carries an amount', () => {
    for (const p of [
      buildOrderPayload({ ...base, paymentMethod: 'COD', advance: toAdvance(QUOTE_ADVANCE), advanceVia: 'QR_Dynamic' }),
      buildOrderPayload({ ...base, paymentMethod: 'Esewa', advance: toAdvance(QUOTE_ADVANCE), advanceVia: 'Esewa' }),
      buildOrderPayload({ ...base, paymentMethod: 'COD' }),
    ]) {
      for (const k of AMOUNT_KEYS) expect(p, `sends ${k}`).not.toHaveProperty(k);
      // lines: ids and quantities only (the server prices them)
      for (const l of p.products) expect(Object.keys(l).sort()).toEqual(['product', 'quantity', 'variant']);
      // the advance numbers appear nowhere in the body
      expect(JSON.stringify(p)).not.toMatch(/\b(150|2350|2500)\b/);
    }
  });
});

describe('the checkout sends only that body', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
  it('placeOrder gets buildOrderPayload, advance_via only from advanceOrderFields', () => {
    const checkout = read('react/checkout.tsx');
    expect(checkout).toMatch(/const payload = buildOrderPayload\(\{[\s\S]*?advance: adv,\s*advanceVia: via,\s*\}\);\s*const res = await placeOrder\(storeId, payload\);/);
    expect(checkout.match(/placeOrder\(/g)).toHaveLength(1);
    // the waiting order asks what create-order said (amount_to_pay / its advance), never a sum
    expect(checkout).toMatch(/amount: placedAmount\(res\),/);
    expect(checkout).toMatch(/const resAdvance = method === 'COD' \? orderAdvance\(res\) : null;/);
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const code = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
          const rel = path.relative(SRC, p);
          if (/advance_via/.test(code) && rel !== path.join('core', 'advance.ts')) named.push(`${rel}: advance_via`);
          if (/partial_payment_amount\s*:/.test(code) && rel !== path.join('core', 'types.ts')) named.push(`${rel}: partial_payment_amount:`);
        }
      }
    };
    walk(SRC);
    expect(named).toEqual([]);
  });
});

describe('starting a payment on an order (browser)', () => {
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
  const args = { store: STORE_ID, order: ORDER_ID, url: 'https://shop.test' };
  const bodies = (fetch: any) => fetch.mock.calls.map(([url, init]: [string, RequestInit]) => ({ url, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) }));

  it('a retry starts the same order and sends no amount', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ url: 'https://gw.test', payment_url: 'https://khalti.test', action_url: 'https://esewa.test', ...QR_INIT_ADVANCE }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const c = await loadClient();
    const cases: [string, string, Record<string, any>][] = [
      ['FonePay', '/payment/fonepay/init', {}],
      ['Esewa', '/payment/esewa/init', {}],
      ['NPX', '/payment/npx/init', {}],
      ['Khalti', '/payment/khalti/init', {}],
      ['nbank_card', '/payment/nabil_card/init', {}],
      ['QR', '/payment/dynamic_qr/init', {}],
      ['QR_Dynamic', '/payment/dynamic_qr/init', { self: true }],
      ['QR_Static', '/payment/static_qr/init', {}],
      ['FonepayCheckout', '/payment/fonepay_checkout/init', {}],
    ];
    for (const [method, path, extra] of cases) {
      fetch.mockClear();
      await c.startPayment(method, args);
      await c.startPayment(method, args); // again, after a failed / closed try
      for (const call of bodies(fetch)) {
        expect(call.url, method).toBe(`https://api.test${path}`);
        expect(call.body, method).toEqual({ ...args, ...extra });
        for (const k of AMOUNT_KEYS) expect(call.body, `${method} sends ${k}`).not.toHaveProperty(k);
      }
      expect(fetch, method).toHaveBeenCalledTimes(2);
    }
    // cash on delivery starts nothing
    fetch.mockClear();
    expect(await c.startPayment('COD', args)).toEqual({ type: 'none' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('a QR init answer reaches the QR screen as the backend sent it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(QR_INIT_ADVANCE), { status: 200 })));
    const c = await loadClient();
    const s = await c.startPayment('QR_Dynamic', args);
    expect(s).toEqual(QR_START_ADVANCE);
    expect(holdSecondsOf(s)).toBe(240);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(QR_INIT_AFTER_HOLD), { status: 200 })));
    expect(holdSecondsOf(await c.startPayment('FonepayCheckout', args))).toBeNull();
  });
  it('a refused retry reaches usePayOrder as body.message', async () => {
    for (const [msg, why] of [
      [REFUSED.paid, 'paid'],
      [REFUSED.advancePaid, 'paid'],
      [REFUSED.cancelled, 'cancelled'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: msg }), { status: 400 })));
      const c = await loadClient();
      const err: any = await c.startPayment('Esewa', args).catch((e) => e);
      expect(err).toBeInstanceOf(c.BlanxerApiError);
      // usePayOrder reads exactly this
      expect(retryRefused(String(err?.body?.message || ''))).toBe(why);
    }
  });
  it('the order read and create-order go to the contract paths', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(PUBLIC_ADVANCE_DUE), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const c = await loadClient();
    expect(paymentDue(await c.getOrder(STORE_ID, ORDER_ID))).toMatchObject({ amount: 150, advance: true });
    expect((fetch.mock.calls[0] as any)[0]).toBe(`https://api.test/order/public/${STORE_ID}/id/${ORDER_ID}`);
    const body = { paymentMethod: 'COD', advance_via: 'Esewa' };
    await c.placeOrder(STORE_ID, body);
    expect(bodies(fetch)[1]).toEqual({ url: `https://api.test/order/${STORE_ID}`, body });
  });
});

const html = (el: any) => renderToString(el).replace(/<!-- -->/g, '');
const methods: PaymentMethod[] = [
  { name: 'QR_Dynamic', display_name: 'Pay by QR' },
  { name: 'Esewa', display_name: 'eSewa' },
];

describe('what the shopper reads', () => {
  it('summary rows: Pay now (advance) and Pay on delivery from the server amounts', () => {
    const out = html(createElement(AdvanceSummaryRows, { advance: toAdvance(QUOTE_ADVANCE) }));
    expect(out).toContain('aria-live="polite"');
    expect(out).toMatch(/Pay now \(advance\)<\/dt><dd>Rs\.? 150<\/dd>/);
    expect(out).toMatch(/Pay on delivery<\/dt><dd>Rs\.? 2,350<\/dd>/);
    expect(out).toMatch(/Pay Rs\.? 150 now and Rs\.? 2,350 on delivery\./);
    // no advance: the polite region stays, empty
    expect(html(createElement(AdvanceSummaryRows, { advance: null }))).toMatch(/aria-live="polite"[^>]*><\/div>$/);
  });
  it('retry: Advance due — Pay Rs X on the same order, Pay another way', () => {
    const due = paymentDue(PUBLIC_ADVANCE_DUE)!;
    const out = html(createElement(PaymentDueBox, { due, methods, onPay: () => {} }));
    expect(out).toMatch(/Advance due — Pay Rs\.? 150/);
    expect(out).toMatch(/Rs\.? 2,350 cash on delivery · order #1234/);
    expect(out).toMatch(/>Pay Rs\.? 150</);
    expect(out).toContain('Pay another way');
    const online = html(createElement(PaymentDueBox, { due: paymentDue(PUBLIC_ONLINE_UNPAID)!, methods, onPay: () => {} }));
    expect(online).toMatch(/Payment not received — Pay Rs\.? 2,500/);
    expect(online).not.toContain('cash on delivery');
    expect(html(createElement(PaymentDueBox, { due, methods, onPay: () => {}, lastMethod: 'Esewa', primaryLabel: 'Try again' }))).toContain('>Try again<');
  });
  it('a pay panel without the server amount: no pay button, a link to the track page', () => {
    // an order placed on an older backend (no amount_to_pay): the waiting order keeps amount 0
    expect(placedAmount({ _id: ORDER_ID, total_price: 2300, delivery_charge: 200 })).toBe(0);
    const due = pendingDue({ order_id: ORDER_ID, order_number: '1234', lines: [], signature: 's', method: 'Esewa', amount: 0, advance: null });
    expect(payOrderView(due, money)).toEqual({ title: 'Payment not received', payLabel: null, modalTitle: null, trackHref: `/track/${ORDER_ID}` });
    const out = html(createElement(PaymentDueBox, { due, methods, onPay: () => {}, lastMethod: 'Esewa', primaryLabel: 'Try again' }));
    expect(out).toContain(`href="/track/${ORDER_ID}"`);
    expect(out).toContain('See your order to pay');
    expect(out).not.toMatch(/Try again|Pay now|Pay another way|<button/);
    // with the server amount: Pay Rs amount_to_pay
    expect(payOrderView({ ...due, amount: 2500 }, money)).toEqual({
      title: 'Payment not received — Pay Rs 2,500',
      payLabel: 'Pay Rs 2,500',
      modalTitle: 'Pay Rs 2,500 online',
      trackHref: null,
    });
    expect(html(createElement(PaymentDueBox, { due: { ...due, amount: 2500 }, methods, onPay: () => {} }))).toMatch(/>Pay Rs\.? 2,500</);
  });
});
