import { ensureNumber } from './format.js';
import type { CartItem } from './types.js';

/** Line id: caller id (custom fields / print lines) or `${product}_${variant}`. */
export const lineId = (item: Pick<CartItem, 'id' | 'product' | 'variant'>): string =>
  item.id || `${item.product}_${item.variant}`;

export interface CartTotals {
  /** Σ price × qty */
  subtotal: number;
  /** Σ customization_charge × qty */
  customization: number;
  /** subtotal + customization (the "Sub-total" the checkout shows) */
  total: number;
  /** Σ weight × qty, kg */
  weight: number;
  items: number;
}

export const cartTotals = (lines: CartItem[]): CartTotals => {
  let subtotal = 0;
  let customization = 0;
  let weight = 0;
  let items = 0;
  for (const l of lines) {
    const q = ensureNumber(l.quantity);
    subtotal += ensureNumber(l.price) * q;
    customization += ensureNumber(l.customization_charge) * q;
    weight += ensureNumber(l.weight) * q;
    items += q;
  }
  return { subtotal, customization, total: subtotal + customization, weight, items };
};
