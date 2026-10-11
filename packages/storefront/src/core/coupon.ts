import { formatCurrency } from './format.js';
import type { Coupon, PaymentMethodName } from './types.js';

export const COUPON_TYPE = { flat: 1, percent: 2, shipping: 3 } as const;

export interface CouponCheck {
  success: boolean;
  error: string;
}

/**
 * Client-side coupon rules, identical to the storefront's `useCoupon`:
 * minimum order value (on cart + delivery), COD-only / online-only, and the
 * delivery-place list (only checked once a place is chosen).
 */
export const checkCouponValidity = (
  coupon: Partial<Coupon> | null | undefined,
  opts: { paymentMethod: PaymentMethodName | string; deliveryCharge: number; cartTotal: number; place?: string },
): CouponCheck => {
  if (!coupon?.code) return { success: false, error: '' };

  const totalAmount = opts.cartTotal + opts.deliveryCharge;
  const min = coupon.min_order_value;
  if (min != null && min != -1 && totalAmount < min) {
    return {
      success: false,
      error: `Coupon is only applicable for order value above ${formatCurrency(min)}`,
    };
  }
  if (coupon.only_for_cod_payment && opts.paymentMethod !== 'COD') {
    return { success: false, error: 'Only cash on delivery can use this coupon' };
  }
  if (coupon.only_for_online_payment && opts.paymentMethod === 'COD') {
    return { success: false, error: 'Only online payment method can use this coupon' };
  }
  const bound = coupon.places || [];
  if (bound.length && !!opts.place && !bound.includes(opts.place)) {
    return { success: false, error: `This coupon is not valid for ${opts.place}` };
  }
  return { success: true, error: '' };
};

/**
 * Discount in NPR. Flat and percent apply to `total_applicable_amount` (the
 * server-computed eligible amount); shipping applies to the delivery charge.
 * `max_discount_amount = -1` means no cap.
 */
export const couponDiscount = (coupon: Partial<Coupon> | null | undefined, deliveryCharge: number): number => {
  if (!coupon) return 0;
  let d = 0;
  const amount = Number(coupon.total_applicable_amount) || 0;
  const val = Number(coupon.coupon_value) || 0;
  const max = coupon.max_discount_amount;

  if (coupon.coupon_type == COUPON_TYPE.flat) {
    d = Math.min(amount, val);
  } else if (coupon.coupon_type == COUPON_TYPE.percent) {
    const p = Math.floor((val / 100) * amount);
    d = max == -1 || max == null ? Math.min(p, amount) : Math.min(p, max);
  } else if (coupon.coupon_type == COUPON_TYPE.shipping) {
    const s = Math.floor((val / 100) * deliveryCharge);
    d = max == -1 || max == null ? Math.min(s, deliveryCharge) : Math.min(s, max);
  }
  return Math.max(d, 0);
};

export const isShippingCoupon = (coupon?: Partial<Coupon> | null): boolean =>
  coupon?.coupon_type == COUPON_TYPE.shipping;
