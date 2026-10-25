import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BlanxerApiError,
  canAddOne,
  capCart,
  capsFromCheck,
  capsFromRefusal,
  holdSecondsOf,
  lineCap,
  refusalEndsOrder,
  refusalFromChanges,
  retryLabel,
  stockCheckBody,
  stockKey,
  stockLineLeft,
  stockNoticeTitle,
  stockShortNote,
  stockWaitLeft,
  stockWords,
  STORAGE_KEYS,
  toStockRefusal,
  waitingProof,
  type CartItem,
} from '../src/core/index.js';
import { StockNotice } from '../src/react/stock-ui.js';
import {
  BAG,
  BAG_RED,
  MUG,
  NO_STOCK_TO_CONFIRM,
  ORDER_ID,
  OUT_OF_STOCK_AT_CREATE,
  PUBLIC_ONLINE_UNPAID,
  PUBLIC_PAID_AFTER_CANCEL,
  PUBLIC_PAID_NO_STOCK,
  QR_INIT_FRESH_HOLD,
  SOLD_OUT_AT_PAY,
  STOCK_CHECK,
  STOCK_HELD_AT_PAY,
  STORE_ID,
} from './contract.fixtures.js';

// Stock the server refused (core/stock.ts, ported from the Blanxer storefront's
// src/features/checkout/stock.ts with its tests; stock-oversell contract §2, §4, §9), plus the
// kit's browser calls and the notice the shopper reads.

const line = (id: string, product: string, variant: string, quantity: number, extra: Partial<CartItem> = {}): CartItem => ({
  id,
  product,
  variant,
  quantity,
  product_name: product === BAG ? 'Hot-water bag' : 'Mug',
  variant_name: product === BAG ? 'Red' : '',
  price: 1150,
  compare_at_price: 0,
  weight: 0.5,
  image_url: '',
  custom_fields: [],
  ...extra,
});

describe('a stock refusal', () => {
  it("shows the server's words as they came, with its lines", () => {
    const r = toStockRefusal(SOLD_OUT_AT_PAY)!;
    expect(r.code).toBe('SOLD_OUT');
    expect(r.message).toBe('Sorry, Hot-water bag just sold out. You were not charged.');
    expect(r.lines).toEqual([{ product_id: BAG, variant_id: BAG_RED, name: 'Hot-water bag', variant_name: 'Red', wanted: 2, available: 0 }]);
    expect(r.order_id).toBe(ORDER_ID);
    expect(r.order_number).toBe('2133');
    expect(toStockRefusal(OUT_OF_STOCK_AT_CREATE)!.message).toBe('Only 1 of Hot-water bag left.');
    // an axios-style error carries the body under response.data
    expect(toStockRefusal({ response: { data: STOCK_HELD_AT_PAY } })!.code).toBe('STOCK_HELD');
  });

  it("the kit's BlanxerApiError: the body it carries", () => {
    const err = new BlanxerApiError(400, SOLD_OUT_AT_PAY, 'https://api.test/payment/esewa/init');
    expect(err.message).toBe(SOLD_OUT_AT_PAY.message);
    expect(toStockRefusal(err)).toEqual(toStockRefusal(SOLD_OUT_AT_PAY));
    expect(toStockRefusal(new BlanxerApiError(400, OUT_OF_STOCK_AT_CREATE, 'u'))!.code).toBe('OUT_OF_STOCK');
    expect(toStockRefusal(new BlanxerApiError(400, { message: 'This order is already paid.' }, 'u'))).toBeNull();
    expect(toStockRefusal(new BlanxerApiError(502, '<html>Bad gateway</html>', 'u'))).toBeNull();
  });

  it('anything else is not a stock refusal (a field error, a staff-only code)', () => {
    expect(toStockRefusal({ message: 'Either of the selected product is out of stock' })).toBeNull();
    expect(toStockRefusal({ fields: { customer_phone_number: 'Invalid' } })).toBeNull();
    expect(toStockRefusal(NO_STOCK_TO_CONFIRM)).toBeNull();
    expect(toStockRefusal(new BlanxerApiError(400, NO_STOCK_TO_CONFIRM, 'u'))).toBeNull();
    expect(toStockRefusal(null)).toBeNull();
  });

  it('STOCK_HELD offers Try again after the wait the server says; the order is kept', () => {
    const held = toStockRefusal(STOCK_HELD_AT_PAY)!;
    expect(held.retry_after_seconds).toBe(120);
    expect(refusalEndsOrder(held)).toBe(false);
    expect(refusalEndsOrder(toStockRefusal(SOLD_OUT_AT_PAY)!)).toBe(true);
    expect(refusalEndsOrder(toStockRefusal(OUT_OF_STOCK_AT_CREATE)!)).toBe(true);
    // no wait sent: the contract's 2 minutes
    const noWait = { ...STOCK_HELD_AT_PAY, stock_error: { ...STOCK_HELD_AT_PAY.stock_error, retry_after_seconds: undefined } };
    expect(toStockRefusal(noWait)!.retry_after_seconds).toBe(120);
  });

  it("no words from the server: the contract's sentences from its lines", () => {
    const lines = toStockRefusal(SOLD_OUT_AT_PAY)!.lines;
    expect(toStockRefusal({ stock_error: SOLD_OUT_AT_PAY.stock_error })!.message).toBe('Sorry, Hot-water bag (Red) just sold out. You were not charged.');
    expect(stockWords('STOCK_HELD', lines, 120)).toBe(
      "The last units of Hot-water bag (Red) are in other shoppers' checkouts right now. Please try again in about 2 minutes. You were not charged.",
    );
    expect(stockWords('OUT_OF_STOCK', [{ ...lines[0]!, available: 1 }])).toBe('Only 1 of Hot-water bag (Red) left.');
    expect(stockLineLeft({ available: 0 })).toBe('Sold out');
    expect(stockLineLeft({ available: 2 })).toBe('Only 2 left');
    // held by other shoppers, not sold: said so
    expect(stockLineLeft({ available: 0 }, 'STOCK_HELD')).toBe('In other checkouts');
  });
});

describe('capping the cart', () => {
  it('Change my order: each refused line held to available, removed at 0', () => {
    const cart = [line('a', BAG, BAG_RED, 2), line('m', MUG, '', 1)];
    const sold = capCart(cart, capsFromRefusal(toStockRefusal(SOLD_OUT_AT_PAY)));
    expect(sold.lines.map((l) => [l.id, l.quantity])).toEqual([['m', 1]]);
    expect(sold.changes).toEqual([{ id: 'a', name: 'Hot-water bag (Red)', from: 2, to: 0, available: 0 }]);

    const short = capCart([line('a', BAG, BAG_RED, 3)], capsFromRefusal(toStockRefusal(OUT_OF_STOCK_AT_CREATE)));
    expect(short.lines.map((l) => l.quantity)).toEqual([1]);
    expect(short.changes[0]).toMatchObject({ from: 3, to: 1, available: 1 });
  });

  it('lines of the same product and variant share its units in cart order', () => {
    const cart = [line('a', BAG, BAG_RED, 1, { custom_fields: ['Name|||text|||Ram'] }), line('b', BAG, BAG_RED, 2)];
    const out = capCart(cart, capsFromCheck(STOCK_CHECK));
    expect(out.lines.map((l) => [l.id, l.quantity])).toEqual([['a', 1]]);
    expect(out.changes.map((c) => [c.id, c.to])).toEqual([['b', 0]]);
  });

  it('a bundle line keeps only whole sets of a capped item (sites with bundle lines)', () => {
    const bundle = { id: 'set', product: 'set1', variant: '', quantity: 2, product_name: 'Tea set', bundle_parts: [{ name: 'Hot-water bag', variant_name: 'Red', qty: 1 }] };
    const out = capCart([bundle], capsFromRefusal(toStockRefusal(OUT_OF_STOCK_AT_CREATE)));
    expect(out.lines.map((l) => l.quantity)).toEqual([1]);
    expect(out.changes[0]).toMatchObject({ id: 'set', from: 2, to: 1 });
  });

  it('nothing capped: the cart as it was', () => {
    const cart = [line('m', MUG, '', 5)];
    const out = capCart(cart, capsFromCheck(STOCK_CHECK));
    expect(out.lines[0]).toBe(cart[0]);
    expect(out.changes).toEqual([]);
    expect(refusalFromChanges(out.changes)).toBeNull();
  });

  it('a cart the check had to change is told in the contract words, no order made', () => {
    const { changes } = capCart([line('a', BAG, BAG_RED, 3)], capsFromCheck(STOCK_CHECK));
    const r = refusalFromChanges(changes)!;
    expect(r.code).toBe('OUT_OF_STOCK');
    expect(r.message).toBe('Only 1 of Hot-water bag (Red) left.');
    expect(r.order_id).toBeNull();
  });
});

describe('the stock check', () => {
  it('sends one line per product and variant with the quantities summed', () => {
    const body = stockCheckBody('store1', [line('a', BAG, BAG_RED, 1), line('b', BAG, BAG_RED, 2), line('m', MUG, '', 1)]);
    expect(body).toEqual({
      store_id: 'store1',
      lines: [
        { product: BAG, variant: BAG_RED, quantity: 3 },
        { product: MUG, quantity: 1 },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/price|amount|total/);
  });

  it('caps only stop-selling lines at the server available; continue-selling and odd answers cap nothing', () => {
    const caps = capsFromCheck(STOCK_CHECK);
    expect(caps.units.get(stockKey(BAG, BAG_RED))).toBe(1);
    expect(caps.units.has(stockKey(MUG, null))).toBe(false);
    expect(capsFromCheck(null).units.size).toBe(0);
    expect(capsFromCheck({ message: 'Not found' }).units.size).toBe(0);
    expect(capsFromCheck({ success: true, data: STOCK_CHECK }).units.get(stockKey(BAG, BAG_RED))).toBe(1);
  });

  it('plus stops at the server cap; no cap, no limit', () => {
    const caps = capsFromCheck(STOCK_CHECK);
    const bag = line('a', BAG, BAG_RED, 1);
    expect(canAddOne(bag, [bag], caps)).toBe(false);
    expect(canAddOne(bag, [{ ...bag, quantity: 0 }], caps)).toBe(true);
    const mug = line('m', MUG, '', 40);
    expect(canAddOne(mug, [mug], caps)).toBe(true);
    expect(lineCap(bag, caps)).toBe(1);
    expect(lineCap(mug, caps)).toBeNull();
  });
});

describe('the track page', () => {
  it('a payment on a cancelled order: received, the store will refund', () => {
    expect(stockShortNote(PUBLIC_PAID_AFTER_CANCEL)).toBe('We received your payment, but this order was cancelled. The store will refund you.');
    expect(stockShortNote({ stock_short: { state: 'open', reason: 'received_only' } })).toBe(
      'We received your payment, but this order was cancelled. The store will refund you.',
    );
    expect(stockShortNote(PUBLIC_PAID_NO_STOCK)).toBe(
      'We received your payment, but an item in this order sold out. The store will contact you to refund you or change the order.',
    );
    expect(stockShortNote({ stock_short: { state: 'resolved', reason: 'paid_no_stock' } })).toBeNull();
    expect(stockShortNote(PUBLIC_ONLINE_UNPAID)).toBeNull();
    // an older backend sends no stock_short
    expect(stockShortNote({ _id: ORDER_ID, status: 'Pending' })).toBeNull();
  });
});

describe('the browser calls', () => {
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
  const cart = [line('a', BAG, BAG_RED, 1), line('b', BAG, BAG_RED, 2), line('m', MUG, '', 1)];

  it('stockCheck asks the contract path with the summed lines and reads the caps', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(STOCK_CHECK), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const c = await loadClient();
    const caps = await c.stockCheck(STORE_ID, cart);
    expect(caps.units.get(stockKey(BAG, BAG_RED))).toBe(1);
    expect(caps.units.size).toBe(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/order/public/stock-check');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(stockCheckBody(STORE_ID, cart));
  });

  it('a stock check that fails gives no caps (an older backend, a network error, junk): checkout is never blocked', async () => {
    for (const answer of [
      () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }),
      () => new Response('<!doctype html><title>Not found</title>', { status: 404 }),
      () => new Response('<!doctype html>', { status: 200 }),
      () => new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 }),
      () => new Response('', { status: 500 }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => answer()));
      const c = await loadClient();
      const caps = await c.stockCheck(STORE_ID, cart);
      expect(caps.units.size).toBe(0);
      expect(capCart(cart, caps).changes).toEqual([]);
    }
    // nothing to ask: no call at all
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const c = await loadClient();
    expect((await c.stockCheck(STORE_ID, [])).units.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a payment start refused for stock: the refusal reaches the page, no amount was sent', async () => {
    const args = { store: STORE_ID, order: ORDER_ID, url: 'https://shop.test' };
    for (const [body, code] of [
      [SOLD_OUT_AT_PAY, 'SOLD_OUT'],
      [STOCK_HELD_AT_PAY, 'STOCK_HELD'],
    ] as const) {
      const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 400 }));
      vi.stubGlobal('fetch', fetch);
      const c = await loadClient();
      for (const method of ['QR_Dynamic', 'Esewa', 'Khalti', 'FonepayCheckout']) {
        const err: any = await c.startPayment(method, args).catch((e) => e);
        expect(err, method).toBeInstanceOf(c.BlanxerApiError);
        // usePayOrder reads exactly this: the notice, not a generic error
        const r = toStockRefusal(err)!;
        expect(r.code, method).toBe(code);
        expect(r.message, method).toBe(body.message);
        expect(r.order_id, method).toBe(ORDER_ID);
      }
      for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) {
        const sent = JSON.parse(String(init.body));
        for (const k of ['amount', 'amount_to_pay', 'total', 'price', 'advance']) expect(sent).not.toHaveProperty(k);
        expect(sent.order).toBe(ORDER_ID);
      }
    }
  });

  it('create-order refused for stock: placeOrder throws the body, read as a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(OUT_OF_STOCK_AT_CREATE), { status: 400 })));
    const c = await loadClient();
    const err = await c.placeOrder(STORE_ID, { paymentMethod: 'COD' }).catch((e) => e);
    expect(toStockRefusal(err)).toMatchObject({ code: 'OUT_OF_STOCK', message: 'Only 1 of Hot-water bag left.' });
  });

  it('a successful init carries the fresh hold: the QR timer follows it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(QR_INIT_FRESH_HOLD), { status: 200 })));
    const c = await loadClient();
    expect(holdSecondsOf(await c.startPayment('QR_Dynamic', { store: STORE_ID, order: ORDER_ID, url: 'https://shop.test' }))).toBe(300);
  });
});

const html = (el: any) => renderToString(el).replace(/<!-- -->/g, '');

describe('what the shopper reads', () => {
  it("sold out: the server's words, each line with what is left, Change my order, no pay button", () => {
    const out = html(createElement(StockNotice, { refusal: toStockRefusal(SOLD_OUT_AT_PAY)!, onChangeOrder: () => {}, onRetry: () => {} }));
    expect(out).toContain('Sorry, Hot-water bag just sold out. You were not charged.');
    expect(out).toContain('Hot-water bag (Red)');
    expect(out).toContain('>Just sold out<');
    expect(out).toContain('>Sold out<');
    expect(out).toContain('>Change my order<');
    expect(out).not.toMatch(/Try again|Pay /);
  });
  it('held in other checkouts: Try again only after the server wait', () => {
    const out = html(createElement(StockNotice, { refusal: toStockRefusal(STOCK_HELD_AT_PAY)!, onChangeOrder: () => {}, onRetry: () => {} }));
    expect(out).toContain('>In other shoppers&#x27; checkouts<');
    expect(out).toContain('other shoppers&#x27; checkouts right now');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Try again in 2:00<\/button>/);
    expect(out).toContain('>Change my order<');
  });
  it('the notice heads each code and counts down the wait before Try again', () => {
    expect(stockNoticeTitle('SOLD_OUT')).toBe('Just sold out');
    expect(stockNoticeTitle('STOCK_HELD')).toBe("In other shoppers' checkouts");
    expect(stockNoticeTitle('OUT_OF_STOCK')).toBe('Not enough in stock');
    expect(retryLabel(120)).toBe('Try again in 2:00');
    expect(retryLabel(61)).toBe('Try again in 1:01');
    expect(retryLabel(0)).toBe('Try again');
  });
  it('a cart the check changed: the contract words, what was wanted, Continue with the rest', () => {
    const { changes } = capCart([line('a', BAG, BAG_RED, 3)], capsFromCheck(STOCK_CHECK));
    const out = html(createElement(StockNotice, { refusal: refusalFromChanges(changes)!, onDismiss: () => {} }));
    expect(out).toContain('>Not enough in stock<');
    expect(out).toContain('Only 1 of Hot-water bag (Red) left.');
    expect(out).toContain(' · you wanted 3');
    expect(out).toContain('>Only 1 left<');
    expect(out).toContain('>Continue with the rest<');
    expect(out).not.toContain('Change my order');
  });
});

describe('the pages use the server answers only', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
  it('checkout re-checks the stock before placing, and a stock refusal is not a generic error', () => {
    const checkout = read('react/checkout.tsx');
    // the check comes before the order body is built
    expect(checkout.indexOf('await stock.check()')).toBeGreaterThan(0);
    expect(checkout.indexOf('await stock.check()')).toBeLessThan(checkout.indexOf('buildOrderPayload({'));
    // the stock refusal is read before the generic "Error creating order"
    expect(checkout.indexOf('toStockRefusal(err)')).toBeLessThan(checkout.indexOf("title: 'Error creating order'"));
  });
  it('a payment start refused for stock closes the QR and is never a generic error', () => {
    const pay = read('react/pay-order.tsx');
    expect(pay).toMatch(/const refusal = toStockRefusal\(e\);\s*if \(refusal\) \{\s*setQr\(null\);\s*setFonepay\(null\);/);
    expect(pay.indexOf('toStockRefusal(e)')).toBeLessThan(pay.indexOf("notify({ type: 'error'"));
  });
});

describe('an order waiting for payment (contract v1.2)', () => {
  it('the stock check carries the waiting order and one proof, as release-hold does', () => {
    expect(waitingProof(ORDER_ID, 'txn1', '9800000000')).toEqual({ order_id: ORDER_ID, transaction_id: 'txn1' });
    expect(waitingProof(ORDER_ID, undefined, ' 9800000000 ')).toEqual({ order_id: ORDER_ID, phone_number: '9800000000' });
    // no proof: the check is not made while it waits (its own hold would count)
    expect(waitingProof(ORDER_ID, undefined, '98000')).toBeNull();
    expect(waitingProof(null, 'txn1')).toBeNull();
    expect(stockCheckBody('store1', [line('a', BAG, BAG_RED, 1)], { order_id: ORDER_ID, transaction_id: 'txn1' })).toEqual({
      store_id: 'store1',
      lines: [{ product: BAG, variant: BAG_RED, quantity: 1 }],
      order_id: ORDER_ID,
      transaction_id: 'txn1',
    });
  });

  it("a STOCK_HELD wait is kept per order: every pay button waits until it's over", () => {
    const now = 1_000_000;
    const waits = { [ORDER_ID]: now + 90_500 };
    expect(stockWaitLeft(waits, ORDER_ID, now)).toBe(91);
    expect(stockWaitLeft(waits, ORDER_ID, now + 91_000)).toBe(0);
    expect(stockWaitLeft(waits, 'other', now)).toBe(0);
    expect(stockWaitLeft(null, ORDER_ID, now)).toBe(0);
  });
});

describe('this tab: the STOCK_HELD wait and the code kept with a waiting order', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    };
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const loadClient = async () => {
    vi.resetModules();
    vi.stubGlobal('sessionStorage', memory());
    const c = await import('../src/client/index.js');
    c.configureClient({ apiBase: 'https://api.test' });
    return c;
  };
  const args = { store: STORE_ID, order: ORDER_ID, url: 'https://shop.test' };

  it('a STOCK_HELD refusal makes this order wait as the server said; SOLD_OUT does not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(STOCK_HELD_AT_PAY), { status: 400 })));
    let c = await loadClient();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(STOCK_HELD_AT_PAY), { status: 400 })));
    await c.startPayment('QR_Dynamic', args).catch(() => {});
    expect(c.stockWaitFor(ORDER_ID)).toBeGreaterThan(115);
    expect(c.stockWaitFor(ORDER_ID)).toBeLessThanOrEqual(120);
    expect(c.stockWaitFor('another-order')).toBe(0);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEYS.stockWait)!)).toHaveProperty(ORDER_ID);

    c = await loadClient();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(SOLD_OUT_AT_PAY), { status: 400 })));
    await c.startPayment('QR_Dynamic', args).catch(() => {});
    expect(c.stockWaitFor(ORDER_ID)).toBe(0);
  });

  it('while an order waits, the stock check sends it with its proof', async () => {
    const c = await loadClient();
    const fetch = vi.fn(async () => new Response(JSON.stringify(STOCK_CHECK), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await c.stockCheck(STORE_ID, [line('a', BAG, BAG_RED, 3)], { order_id: ORDER_ID, transaction_id: 'txn9' });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ store_id: STORE_ID, lines: [{ product: BAG, variant: BAG_RED, quantity: 3 }], order_id: ORDER_ID, transaction_id: 'txn9' });
  });

  it("the shopper's code: kept with the order, given back once when it is given up, gone once it is paid or forgotten", async () => {
    const c = await loadClient();
    c.keepOrderChoices(ORDER_ID, { offers: { code: 'TIHAR10', gifts: {}, removed: [] }, promo: 'TIHAR10' });
    expect(c.takeOrderChoices('other')).toBeNull();
    expect(c.takeOrderChoices(ORDER_ID)).toEqual({ offers: { code: 'TIHAR10', gifts: {}, removed: [] }, promo: 'TIHAR10' });
    expect(c.takeOrderChoices(ORDER_ID)).toBeNull();
    c.keepOrderChoices(ORDER_ID, { promo: 'TIHAR10' });
    c.clearPendingOrder();
    expect(c.takeOrderChoices(ORDER_ID)).toBeNull();
    // nothing to keep: nothing stored
    c.keepOrderChoices(ORDER_ID, {});
    expect(sessionStorage.getItem(STORAGE_KEYS.orderChoices)).toBeNull();
  });
});

describe('the pages: the wait, the proof and the code', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
  it("the pay panel's own buttons wait for the server's STOCK_HELD wait too, and no start while it runs", () => {
    const pay = read('react/pay-order.tsx');
    expect(pay).toMatch(/disabled=\{waitLeft > 0\}[\s\S]{0,120}\{waitLeft > 0 \? retryLabel\(waitLeft\)/);
    expect(pay).toMatch(/disabled=\{busy \|\| waitLeft > 0\}[\s\S]{0,80}Pay another way/);
    expect(pay).toMatch(/const start = async[^{]*\{\s*\/\/[^\n]*\n\s*if \(stockWaitFor\(orderId\) > 0\) return 'failed';/);
  });
  it("the shopper's code is kept with the waiting order and given back when it is given up", () => {
    const checkout = read('react/checkout.tsx');
    expect(checkout.indexOf('orderChoices.snapshot()')).toBeGreaterThan(0);
    expect(checkout.indexOf('orderChoices.snapshot()')).toBeLessThan(checkout.indexOf('offers.clearChoices()'));
    expect(checkout).toMatch(/savePendingOrder\(waitingOrder\);\s*orderChoices\.keep\(res\._id, choicesBefore\);/);
    expect(checkout).toMatch(/const forgetPending = \(\)[^{]*\{\s*const p = readPendingOrder\(\);\s*const back = p \? orderChoices\.restore\(p\.order_id\) : null;/);
    // cash on delivery instead: the code goes with the new order at once
    expect(checkout).toMatch(/const back = forgetPending\(\);[\s\S]*?placeNew\('COD', '', null, back\)/);
    // a refused payment start gives the code back before the waiting order is forgotten
    expect(read('react/pay-order.tsx')).toMatch(/const giveUp = \(orderId: string\) => \{\s*orderChoices\.restore\(orderId\);\s*if \(readPendingOrder\(\)\?\.order_id === orderId\) clearPendingOrder\(\);/);
  });
  it('a waiting order is checked with its proof, else not at all; a shortage is told, never capped behind the back', () => {
    const checkout = read('react/checkout.tsx');
    expect(checkout).toMatch(/waitingProof\(waiting\.order_id, waiting\.transaction, values\.customer_phone_number\)/);
    expect(checkout).toMatch(/\(!waiting \|\| !!waitingStockProof\)/);
    const ui = read('react/stock-ui.tsx');
    // with a waiting order: onShort once per answer, and return before capLines
    expect(ui).toMatch(/if \(waiting\) \{[\s\S]*?onShort\?\.\([\s\S]*?return;\s*\}\s*cart\.capLines/);
    expect(read('react/cart-lines.tsx')).toMatch(/waitingProof\(p\.order_id, p\.transaction\)/);
  });
});
