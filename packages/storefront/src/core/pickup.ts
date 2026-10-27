/**
 * Store pickup at checkout (Blanxer backend `docs/fulfilment-rules.md`, TSK-154): the shopper picks
 * Home delivery or Pick up at store; a pickup names one of the store's pickup outlets, pays no
 * delivery charge and never the delivery advance. The outlets come from `check_domain`
 * (`store_pickup.outlets`, [] = off), their stock for this cart from
 * `POST /order/public/pickup-stock`. The server decides everything again on create.
 */
import type { PickupOutlet, PickupStockRow, Store } from './types.js';

export type Fulfilment = 'delivery' | 'pickup';

/** The store's pickup outlets ([] = the store offers no pickup). */
export const pickupOutletsOf = (store?: Partial<Store> | null): PickupOutlet[] =>
  Array.isArray(store?.store_pickup?.outlets) ? store!.store_pickup!.outlets.filter((o) => !!o?._id) : [];

/** How the store lets a pickup be paid: at the store (default) and whether it asks an advance first. */
export const pickupPaymentOf = (store?: Partial<Store> | null) => {
  const atStore = store?.store_pickup?.pay_at_store !== false;
  return { pay_at_store: atStore, advance: atStore && store?.store_pickup?.advance === true };
};

/**
 * The outlet to show picked: the shopper's own pick while it still has the cart, else the server's
 * recommendation (the first with everything), else the shopper's pick as it was (shown short).
 */
export const pickedOutlet = (current: string, rows: PickupStockRow[] | null, recommended: string | null): string => {
  if (!rows?.length) return current;
  const mine = rows.find((r) => r._id === current);
  if (mine?.in_stock) return current;
  if (recommended && rows.some((r) => r._id === recommended)) return recommended;
  return mine ? current : rows[0]!._id;
};

const lineLabel = (l: { name: string; variant_name?: string }) => `${l.name}${l.variant_name ? ` (${l.variant_name})` : ''}`;

/** One line under an outlet: "In stock", "Only 1 of Pashmina left here", "Pashmina is out of stock here". */
export const pickupStockLine = (row: PickupStockRow | undefined): string => {
  if (!row) return '';
  if (row.in_stock) return 'In stock';
  const first = row.short[0];
  if (!first) return 'Not available here';
  const more = row.short.length > 1 ? ` (+${row.short.length - 1} more)` : '';
  return first.available > 0
    ? `Only ${first.available} of ${lineLabel(first)} left here${more}`
    : `${lineLabel(first)} is out of stock here${more}`;
};

/** "Lalitpur has everything in your cart." when the picked outlet doesn't. */
export const recommendLine = (picked: string, rows: PickupStockRow[] | null, recommended: string | null): string => {
  if (!rows?.length) return '';
  if (rows.find((r) => r._id === picked)?.in_stock) return '';
  const rec = rows.find((r) => r._id === recommended);
  if (rec) return `${rec.name} has everything in your cart.`;
  // a store with one pickup outlet (backend FU-1b) has no other store to suggest
  return rows.length === 1
    ? 'The store doesn’t have everything in your cart right now. Choose home delivery.'
    : 'No store has everything in your cart right now. Choose home delivery.';
};

/** What the order call adds for a pickup ({} for a delivery). */
export const pickupOrderFields = (fulfilment: Fulfilment, outlet: string | null | undefined) =>
  fulfilment === 'pickup' && outlet ? { fulfilment: 'pickup' as const, pickup_outlet: outlet } : {};

/** Place order waits until the picked outlet has the cart ('' = nothing blocks). */
export const pickupBlocks = (fulfilment: Fulfilment, outlet: string, rows: PickupStockRow[] | null): string => {
  if (fulfilment !== 'pickup') return '';
  if (!outlet) return 'Choose the store you will pick up from.';
  const row = rows?.find((r) => r._id === outlet);
  return row && !row.in_stock ? 'This store doesn’t have everything in your cart. Choose another store.' : '';
};

/**
 * The payment methods for a pickup: cash on delivery becomes "Pay at store", or goes when the
 * store takes pickups paid online only. The order still sends `COD` (cash when collected).
 */
export const pickupMethods = <T extends { name: string; display_name: string }>(methods: T[], payAtStore: boolean): T[] =>
  methods.flatMap((m) => (m.name !== 'COD' ? [m] : payAtStore ? [{ ...m, display_name: 'Pay at store' }] : []));

/** The body of `POST /order/public/pickup-stock`. */
export const pickupStockBody = (
  storeId: string,
  lines: Array<{ product: string; variant?: string; quantity: number; bundle_picks?: string[]; added_by?: string }>,
) => ({
  store_id: storeId,
  lines: lines
    .filter((l) => !l.added_by && l.product && Number(l.quantity) > 0)
    .map((l) => ({
      product: String(l.product),
      variant: String(l.variant || ''),
      quantity: Math.floor(Number(l.quantity)),
      ...(l.bundle_picks?.length ? { bundle_picks: l.bundle_picks } : {}),
    })),
});

/** "Store pickup · Thamel" for an order read with a pickup ('' for a delivery). */
export const pickupLabel = (order?: { fulfilment?: { type?: string; outlet_name?: string } | null } | null): string =>
  order?.fulfilment?.type === 'pickup' ? `Store pickup${order.fulfilment.outlet_name ? ` · ${order.fulfilment.outlet_name}` : ''}` : '';
