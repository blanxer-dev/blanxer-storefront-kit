import { afterEach, describe, expect, it } from 'vitest';
import { localOrderMeta, pushMetaEvent } from '../src/client/index.js';

describe('Meta helpers', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('local Purchase payload: catalog ids, contents, total quantity', () => {
    const m = localOrderMeta(
      [
        { product: 'p1', variant: 'v1', quantity: 2, price: 400 },
        { product: 'p2', quantity: 1, price: 100 },
      ],
      950,
      '1042',
    );
    expect(m.content_ids).toEqual(['p1_v1', 'p2']);
    expect(m.contents).toEqual([
      { id: 'p1_v1', quantity: 2, item_price: 400 },
      { id: 'p2', quantity: 1, item_price: 100 },
    ]);
    expect(m.num_items).toBe(3);
    expect(m.value).toBe(950);
    expect(m.order_id).toBe('1042');
    expect(m.purchase_event_id).toBeTruthy();
  });

  it('mirrors events into the GTM dataLayer in GA4 shape with the Meta event id', () => {
    (globalThis as any).window = {};
    pushMetaEvent(
      'Purchase',
      { value: 950, currency: 'NPR', order_id: '1042', contents: [{ id: 'p1_v1', quantity: 2, item_price: 400 }] },
      'purchase_abc',
    );
    const dl = (globalThis as any).window.dataLayer;
    expect(dl[0]).toEqual({ ecommerce: null });
    expect(dl[1]).toEqual({
      event: 'purchase',
      meta_event_name: 'Purchase',
      meta_event_id: 'purchase_abc',
      ecommerce: {
        currency: 'NPR',
        value: 950,
        transaction_id: '1042',
        items: [{ item_id: 'p1_v1', price: 400, quantity: 2 }],
      },
    });
  });

  it('events without products push a plain event', () => {
    (globalThis as any).window = {};
    pushMetaEvent('Contact', {}, 'e1');
    expect((globalThis as any).window.dataLayer).toEqual([{ event: 'contact', meta_event_name: 'Contact', meta_event_id: 'e1' }]);
  });
});
