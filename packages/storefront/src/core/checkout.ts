import { cartTotals } from './cart.js';
import { checkCouponValidity, couponDiscount, isShippingCoupon } from './coupon.js';
import { computeDelivery } from './delivery.js';
import { paymentMethodsFor } from './payments.js';
import type { CartItem, Coupon, DeliveryTable, PaymentMethod, Store } from './types.js';

export interface CheckoutQuote {
  subtotal: number;
  customization: number;
  /** Sub-total shown to the shopper (products + customization). */
  total: number;
  weight: number;
  deliveryCharge: number;
  codAllowed: boolean;
  paymentMethods: PaymentMethod[];
  coupon: { valid: boolean; error: string; discount: number; shipping: boolean };
  /** What the shopper pays. */
  payable: number;
}

/** Everything the checkout summary shows, from pure inputs. */
export const quoteCheckout = (input: {
  store: Partial<Store>;
  lines: CartItem[];
  delivery: DeliveryTable | null | undefined;
  place: string;
  paymentMethod: string;
  coupon?: Partial<Coupon> | null;
  /** a store pickup: no delivery charge, and paying at the store is allowed anywhere */
  pickup?: boolean;
}): CheckoutQuote => {
  const t = cartTotals(input.lines);
  const d = input.pickup ? { charge: 0, cod: true } : computeDelivery(input.delivery, input.place, t.weight);
  const check = checkCouponValidity(input.coupon, {
    paymentMethod: input.paymentMethod,
    deliveryCharge: d.charge,
    cartTotal: t.total,
    place: input.place,
  });
  const discount = couponDiscount(input.coupon, d.charge);
  const payable = check.success ? t.total + d.charge - discount : t.total + d.charge;
  return {
    subtotal: t.subtotal,
    customization: t.customization,
    total: t.total,
    weight: t.weight,
    deliveryCharge: d.charge,
    codAllowed: d.cod,
    paymentMethods: paymentMethodsFor(input.store, { codAllowed: d.cod }),
    coupon: { valid: check.success, error: check.error, discount, shipping: isShippingCoupon(input.coupon) },
    payable: Math.max(0, payable),
  };
};
