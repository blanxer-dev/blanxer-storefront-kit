import { describe, expect, it } from 'vitest';
import {
  buildOrderPayload,
  cartTotals,
  checkCouponValidity,
  computeDelivery,
  couponDiscount,
  customizationCharge,
  deliveryPlaces,
  extractCustomFields,
  initCustomFieldState,
  initialCheckoutValues,
  isCodAllowed,
  isInPageMethod,
  paymentFlow,
  paymentMethodsFor,
  quoteCheckout,
  serializeCustomFields,
  toClientStore,
  validateCustomFields,
  validation,
  weightBracketIndex,
  type CartItem,
  type DeliveryTable,
  type Store,
} from '../src/core/index.js';

const delivery: DeliveryTable = {
  defaults: [100, 150, 200, 250, 300, 400],
  places: [
    ['Kathmandu', true, 80, -1, 120, -1, 200, 300],
    ['Pokhara', 'Y', 150, 180, 210, 240, 270, 330],
    ['Jumla', 'N', 300, 300, 300, 300, 300, 300],
    ['Ilam', false, -1, -1, -1, -1, -1, -1],
  ],
};

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

describe('delivery', () => {
  it('maps weight to the [1,2,3,5,10] brackets, >10 is the last column', () => {
    expect([0, 1, 1.01, 2, 3, 4, 5, 9.9, 10, 10.5, 50].map(weightBracketIndex)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('uses the place column, and the default for -1', () => {
    expect(computeDelivery(delivery, 'Kathmandu', 0.5).charge).toBe(80);
    expect(computeDelivery(delivery, 'Kathmandu', 1.5).charge).toBe(150); // -1 → default[1]
    expect(computeDelivery(delivery, 'Kathmandu', 4).charge).toBe(250); // -1 → default[3]
    expect(computeDelivery(delivery, 'Kathmandu', 11).charge).toBe(300);
    expect(computeDelivery(delivery, 'Ilam', 2.5).charge).toBe(200);
  });

  it('unknown place: charge 0, no COD (storefront behaviour)', () => {
    expect(computeDelivery(delivery, 'Nowhere', 1)).toEqual({ charge: 0, cod: false, bracket: 0, placeFound: false });
  });

  it("COD only for true or 'Y' (the server rule, not !!cod)", () => {
    expect([true, 'Y', 'N', false, 'yes', 1, '', undefined].map(isCodAllowed)).toEqual([true, true, false, false, false, false, false, false]);
    expect(computeDelivery(delivery, 'Pokhara', 1).cod).toBe(true);
    expect(computeDelivery(delivery, 'Jumla', 1).cod).toBe(false);
  });

  it('lists unique place names in API order', () => {
    expect(deliveryPlaces({ defaults: [], places: [['A', true], ['B', true], ['A', false]] }).map((p) => p.value)).toEqual(['A', 'B']);
  });
});

describe('weight follows the cart (stale-memo fix)', () => {
  it('re-quotes the delivery charge when only the quantity changes', () => {
    const store = { plan: 'free' } as Partial<Store>;
    const q1 = quoteCheckout({ store, lines: [line({ quantity: 1 })], delivery, place: 'Kathmandu', paymentMethod: 'COD' });
    const q2 = quoteCheckout({ store, lines: [line({ quantity: 4 })], delivery, place: 'Kathmandu', paymentMethod: 'COD' });
    expect(q1.weight).toBe(0.5);
    expect(q1.deliveryCharge).toBe(80);
    expect(q2.weight).toBe(2);
    expect(q2.deliveryCharge).toBe(150);
  });
});

describe('payment methods', () => {
  const full: Partial<Store> = {
    plan: 'premium',
    addons: { fonepay_dynamic: true, fonepay_checkout: true, qr_request_enabled: true, esewa: true, fonepay: true, khalti: true, npx: true, nbank_card: true, card: true },
    setting: { fonepay_dynamic_key: 'yes', fonepay_checkout_key: 'yes', esewa_secret: 'yes' },
  };

  it('orders COD first then the online methods; never Card', () => {
    expect(paymentMethodsFor(full, { codAllowed: true }).map((m) => m.name)).toEqual([
      'COD',
      'QR_Dynamic',
      'FonepayCheckout',
      'QR',
      'Esewa',
      'FonePay',
      'Khalti',
      'NPX',
      'nbank_card',
    ]);
  });

  it('drops COD when the place does not allow it', () => {
    expect(paymentMethodsFor(full, { codAllowed: false })[0]!.name).toBe('QR_Dynamic');
  });

  it('free plan: COD only', () => {
    expect(paymentMethodsFor({ ...full, plan: 'free' }, { codAllowed: true }).map((m) => m.name)).toEqual(['COD']);
    expect(paymentMethodsFor({ ...full, plan: undefined }, { codAllowed: false })).toEqual([]);
  });

  it('keyed methods need their key', () => {
    const s = { ...full, setting: {} };
    expect(paymentMethodsFor(s, { codAllowed: false }).map((m) => m.name)).toEqual(['QR', 'FonePay', 'Khalti', 'NPX', 'nbank_card']);
  });

  it('flows', () => {
    expect(['COD', 'Esewa', 'NPX', 'Khalti', 'FonePay', 'nbank_card', 'QR', 'QR_Dynamic', 'FonepayCheckout'].map(paymentFlow)).toEqual([
      'none',
      'form',
      'form',
      'redirect',
      'redirect',
      'redirect',
      'qr',
      'qr',
      'fonepay_checkout',
    ]);
    expect(['QR', 'QR_Dynamic', 'QR_Static', 'FonepayCheckout', 'Esewa', 'COD'].map(isInPageMethod)).toEqual([true, true, true, true, false, false]);
  });
});

describe('coupons', () => {
  const base = { _id: 'c1', code: 'SAVE', coupon_type: 2, coupon_value: 10, max_discount_amount: -1, min_order_value: -1, total_applicable_amount: 2000 };

  it('flat: min(applicable, value)', () => {
    expect(couponDiscount({ ...base, coupon_type: 1, coupon_value: 300 }, 100)).toBe(300);
    expect(couponDiscount({ ...base, coupon_type: 1, coupon_value: 3000 }, 100)).toBe(2000);
  });

  it('percent: floor, capped by max unless -1', () => {
    expect(couponDiscount({ ...base, coupon_value: 15 }, 100)).toBe(300);
    expect(couponDiscount({ ...base, coupon_value: 15, max_discount_amount: 250 }, 100)).toBe(250);
    expect(couponDiscount({ ...base, coupon_value: 33.3, total_applicable_amount: 1001 }, 0)).toBe(333);
  });

  it('shipping: percent of the delivery charge', () => {
    expect(couponDiscount({ ...base, coupon_type: 3, coupon_value: 50 }, 150)).toBe(75);
    expect(couponDiscount({ ...base, coupon_type: 3, coupon_value: 100, max_discount_amount: 60 }, 150)).toBe(60);
  });

  it('validity rules and messages', () => {
    const opts = { paymentMethod: 'COD', deliveryCharge: 100, cartTotal: 900, place: 'Kathmandu' };
    expect(checkCouponValidity(null, opts)).toEqual({ success: false, error: '' });
    expect(checkCouponValidity({ ...base, min_order_value: 1500 }, opts).error).toBe('Coupon is only applicable for order value above 1,500');
    expect(checkCouponValidity({ ...base, min_order_value: 1000 }, opts).success).toBe(true); // 900 + 100 delivery
    expect(checkCouponValidity({ ...base, only_for_online_payment: true }, opts).error).toBe('Only online payment method can use this coupon');
    expect(checkCouponValidity({ ...base, only_for_cod_payment: true }, { ...opts, paymentMethod: 'Esewa' }).error).toBe(
      'Only cash on delivery can use this coupon',
    );
    expect(checkCouponValidity({ ...base, places: ['Pokhara'] }, opts).error).toBe('This coupon is not valid for Kathmandu');
    expect(checkCouponValidity({ ...base, places: ['Pokhara'] }, { ...opts, place: '' }).success).toBe(true);
  });

  it('quote: discount only when valid; payable = total + delivery - discount', () => {
    const store = { plan: 'basic' } as Partial<Store>;
    const lines = [line({ quantity: 2, customization_charge: 50 })];
    const valid = quoteCheckout({ store, lines, delivery, place: 'Kathmandu', paymentMethod: 'COD', coupon: { ...base, coupon_type: 1, coupon_value: 200 } });
    expect(valid.total).toBe(2100);
    expect(valid.deliveryCharge).toBe(80);
    expect(valid.payable).toBe(2100 + 80 - 200);
    const invalid = quoteCheckout({
      store,
      lines,
      delivery,
      place: 'Kathmandu',
      paymentMethod: 'COD',
      coupon: { ...base, coupon_type: 1, coupon_value: 200, only_for_online_payment: true },
    });
    expect(invalid.coupon.valid).toBe(false);
    expect(invalid.payable).toBe(2180);
  });
});

describe('validation', () => {
  it('phone: exactly 10 digits', () => {
    expect(validation.phone('9812345678')).toBeNull();
    expect(validation.phone('981234567')).toBe('Invalid phone number');
    expect(validation.phone('98123456789')).toBe('Invalid phone number');
    expect(validation.phone('98123 45678')).toBe('Invalid phone number');
    expect(validation.optionalPhone('')).toBeNull();
    expect(validation.optionalPhone('123')).toBe('Invalid phone number');
  });

  it('email and required', () => {
    expect(validation.email('a@b.co')).toBeNull();
    expect(validation.email('a@b')).toBe('Invalid email address');
    expect(validation.optionalEmail('')).toBeNull();
    expect(validation.required('')).toBe('This field is required');
    expect(validation.required('x')).toBeNull();
  });
});

describe('order payload', () => {
  const values = {
    ...initialCheckoutValues({ checkout: { receiver_info: true, pan: true, estimated_delivery: true } }),
    customer_full_name: 'Ram',
    customer_email: 'ram@example.com',
    customer_phone_number: '0000000000',
    customer_alt_phone_number: '',
    customer_address: 'Tinkune',
    customer_address_landmark: '',
    customer_address_city: 'Kathmandu',
    order_note: '',
    sender_full_name: 'Sita',
    sender_email: '',
    sender_phone_number: '9800000000',
    pan: '123456789',
    delivery_date: '2026-10-20',
  };

  it('matches the storefront body', () => {
    const p = buildOrderPayload({
      store: { checkout: { receiver_info: true } },
      lines: [
        line({ customization_charge: 50, custom_fields: ['Name|||text|||Ram'], print: { id: 'pr1', name: '', image_url: '', area: null } }),
        line({ id: 'p2_', product: 'p2', variant: '', custom_fields: [''] }),
      ],
      values,
      paymentMethod: 'Esewa',
      url: 'https://shop.example.com',
      couponId: 'c1',
      meta: { event_id: 'e1', fbp: '', fbc: '', event_source_url: 'https://shop.example.com/checkout' },
    });
    expect(p).toEqual({
      products: [
        { product: 'p1', variant: 'v1', quantity: 1, customization_charge: 50, custom_fields: ['Name|||text|||Ram'], print_id: 'pr1' },
        { product: 'p2', variant: '', quantity: 1 },
      ],
      meta: { event_id: 'e1', fbp: '', fbc: '', event_source_url: 'https://shop.example.com/checkout' },
      sender_email: '',
      sender_full_name: 'Sita',
      sender_phone_number: '9800000000',
      customer_email: 'ram@example.com',
      customer_full_name: 'Ram',
      customer_phone_number: '0000000000',
      customer_alt_phone_number: '',
      customer_address: 'Tinkune',
      customer_address_landmark: '',
      customer_address_city: 'Kathmandu',
      order_note: '',
      delivery_date: '2026-10-20',
      pan: '123456789',
      paymentMethod: 'Esewa',
      url: 'https://shop.example.com',
      coupon: 'c1',
    });
  });

  it('no sender fields without receiver_info; coupon defaults to empty string', () => {
    const p = buildOrderPayload({ store: {}, lines: [line()], values: initialCheckoutValues({}), paymentMethod: 'COD', url: 'https://x.dev' });
    expect('sender_full_name' in p).toBe(false);
    expect('pan' in p).toBe(false);
    expect(p.coupon).toBe('');
  });
});

describe('custom fields', () => {
  const product = {
    custom_fields: [
      ['text', 'Name on cake', true, 'eg: Ram', null, null],
      ['text_dp', 'Gift message', false, '', null, 150],
      ['single', 'Flavour', true, '', ['Chocolate', 'Vanilla'], null],
      ['multi', 'Toppings', false, '', ['Nuts', 'Cherry'], null],
      ['date', 'Delivery date', false, '', null, null],
      ['image', 'Photo', false, '', null, null],
    ],
  };

  it('serialises filled fields as label|||type|||value', () => {
    const state = initCustomFieldState(extractCustomFields(product));
    expect(state.map((s) => s.value)).toEqual(['', '', 'Chocolate', [], '', '']);
    const filled = state.map((s) => {
      if (s.label === 'Name on cake') return { ...s, value: 'Sita' };
      if (s.label === 'Gift message') return { ...s, value: 'Happy birthday' };
      if (s.label === 'Toppings') return { ...s, value: ['Nuts', 'Cherry'] };
      if (s.label === 'Delivery date') return { ...s, value: '2026-10-11' };
      if (s.label === 'Photo') return { ...s, value: 'https://cdn.example.com/a.webp' };
      return s;
    });
    expect(serializeCustomFields(filled)).toEqual([
      'Name on cake|||text|||Sita',
      'Gift message|||text_dp|||Happy birthday',
      'Flavour|||single|||Chocolate',
      'Toppings|||multi|||Nuts, Cherry',
      'Delivery date|||date|||Oct 11, 2026',
      'Photo|||image|||https://cdn.example.com/a.webp',
    ]);
    expect(customizationCharge(filled)).toBe(150);
    expect(customizationCharge(state)).toBe(0);
  });

  it('required fields block add-to-cart', () => {
    const { valid, state } = validateCustomFields(initCustomFieldState(extractCustomFields(product)));
    expect(valid).toBe(false);
    expect(state[0]!.error).toBe('This field is required');
    expect(state[2]!.error).toBe(''); // single has a default
  });
});

describe('cart totals', () => {
  it('sums price, customization, weight', () => {
    expect(cartTotals([line({ quantity: 2, customization_charge: 25 }), line({ id: 'x', price: 500, weight: 1 })])).toEqual({
      subtotal: 2500,
      customization: 50,
      total: 2550,
      weight: 2,
      items: 3,
    });
  });
});

describe('toClientStore', () => {
  it('drops gateway and third-party plugin secrets', () => {
    const s = toClientStore({
      _id: 's1',
      name: 'Shop',
      sub_domain: 'shop',
      setting: { esewa_secret: 'yes', npx_key: 'raw-npx-key', fonepay_dynamic_key: '' },
      plugins: [
        { name: 'upaye', details: { token: 'SECRET' } },
        { name: 'fb_pixel', details: '123' },
        { name: 'meta_capi', details: { access_token: 'EAAB' } },
      ],
    } as Store);
    const json = JSON.stringify(s);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('raw-npx-key');
    expect(json).not.toContain('EAAB');
    expect(s.setting).toEqual({ esewa_secret: 'yes', fonepay_dynamic_key: '', fonepay_checkout_key: '' });
    expect(s.plugins).toEqual([
      { name: 'fb_pixel', details: '123' },
      { name: 'meta_capi', details: true },
    ]);
  });
});
