import { ensureNumber } from './format.js';
import type { CartItem, DeliveryTable } from './types.js';

/** Upper bounds (kg) of the delivery-charge weight brackets. Above 10 kg uses the last column. */
export const WEIGHT_BRACKETS = [1, 2, 3, 5, 10] as const;

/** Index into `defaults` (0–5) for a total cart weight in kg. */
export const weightBracketIndex = (totalWeight: number): number => {
  const idx = WEIGHT_BRACKETS.findIndex((max) => totalWeight <= max);
  return idx === -1 ? WEIGHT_BRACKETS.length : idx;
};

/** The server's COD rule: only `true` or `'Y'` allow cash on delivery.
 * (The Blanxer storefront used `!!cod`, which wrongly let `'N'` through.) */
export const isCodAllowed = (flag: unknown): boolean => flag === true || flag === 'Y';

/** Sum of `weight × quantity` over the lines, in kg. */
export const cartWeight = (lines: Pick<CartItem, 'weight' | 'quantity'>[]): number =>
  lines.reduce((sum, l) => sum + ensureNumber(l.weight) * ensureNumber(l.quantity), 0);

/** Unique place names for the City/District select, in API order. */
export const deliveryPlaces = (table?: DeliveryTable | null): { label: string; value: string }[] => {
  const places = (table?.places || []) as any[][];
  const names = Array.from(new Set(places.map((p) => String(p?.[0] ?? '')).filter(Boolean)));
  return names.map((n) => ({ label: n, value: n }));
};

export interface DeliveryQuote {
  /** Charge in NPR for this place and weight. */
  charge: number;
  /** Whether COD is offered for the place. */
  cod: boolean;
  /** Bracket index used (0 = ≤1 kg … 5 = >10 kg). */
  bracket: number;
  /** False when the place is not in the table (charge 0, no COD — as on the storefront). */
  placeFound: boolean;
}

/**
 * Delivery charge exactly as the storefront checkout computes it:
 * pick the weight bracket, take the place's column, and fall back to the
 * store default for that bracket when the place's value is negative (`-1`).
 */
export const computeDelivery = (
  table: DeliveryTable | null | undefined,
  place: string,
  totalWeight: number,
): DeliveryQuote => {
  const bracket = weightBracketIndex(totalWeight);
  const defaults = (table?.defaults || []) as number[];
  const chargeDefault = ensureNumber(defaults[bracket]);
  const places = (table?.places || []) as any[][];
  const row = places.find((p) => p?.[0] == place);

  let charge = 0;
  if (row) charge = ensureNumber(row[bracket + 2]);
  charge = charge < 0 ? chargeDefault : charge;

  return { charge, cod: isCodAllowed(row?.[1]), bracket, placeFound: !!row };
};
