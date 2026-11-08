'use client';
/**
 * Selling online from several stores (pooled stores, backend contract plans/multi-outlet §4):
 * the checkout plan hook, "Arrives in 2 parcels" in the summary, the parcels of a placed
 * checkout on the order page, and "Available at Pokhara, Butwal" on the product page. Every
 * number is the server's (`core/plan.ts`). None of it renders or calls anything on a store that
 * isn't pooled.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createLatest } from '../core/offers.js';
import {
  checkoutPlanBody,
  checkoutPlanKey,
  deliveryByLocation,
  groupOrderRows,
  parcelRows,
  parcelsTitle,
  PLAN_CHANGED_NOTE,
  filterStoreRows,
  SEARCH_FROM,
  showsStores,
  storeRows,
  storesLine,
  storesWith,
  type CheckoutPlan,
  type CheckoutPlanInput,
  type PlacedCheckoutNote,
  type StoreAvailability,
  type StoreHas,
} from '../core/plan.js';
import { STORAGE_KEYS } from '../core/config.js';
import { checkoutPlan, shopperCity, storeAvailability } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { Button, Modal, cx } from './ui.js';

export interface UseCheckoutPlanOptions extends Omit<CheckoutPlanInput, 'storeId'> {
  /** ask at all: a pooled store with lines, a place (or a pickup) and no order in flight */
  enabled: boolean;
  debounceMs?: number;
}

export interface CheckoutPlanState {
  /** the latest plan (may be for the cart as it was a moment ago: see `fresh`) */
  plan: CheckoutPlan | null;
  /** the plan answers the cart / place / method / code as they are now */
  fresh: boolean;
  /** the plan for the current cart is still out (Place order waits) */
  waiting: boolean;
  /** the last call failed (the checkout falls back to today's display; the server plans on create) */
  error: unknown;
  /** put a plan in as the current one (the fresh plan of a 409 `CHECKOUT_PLAN_STALE`) */
  replace: (plan: CheckoutPlan) => void;
  /** ask again now */
  refresh: () => void;
}

/**
 * The server's checkout plan for the lines being checked out, debounced, the request it replaces
 * aborted, never a stale answer shown as fresh.
 */
export function useCheckoutPlan({ enabled, debounceMs = 350, ...input }: UseCheckoutPlanOptions): CheckoutPlanState {
  const { storeId } = useBlanxer();
  const body = useMemo(
    () => checkoutPlanBody({ ...input, storeId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeId, input.lines, input.place, input.paymentMethod, input.pickupOutlet, input.offers?.code, input.offers?.removedOffers, input.offers?.giftChoices, input.coupon, input.phone],
  );
  const key = checkoutPlanKey(body);
  const on = enabled && !!storeId && body.products.length > 0 && (!!body.place || body.fulfilment === 'pickup');
  const [state, setState] = useState<{ key: string; plan: CheckoutPlan | null; error: unknown }>({ key: '', plan: null, error: null });
  const [force, setForce] = useState(0);
  const forced = useRef(false);
  const latest = useRef(createLatest<CheckoutPlan | null>());

  useEffect(() => {
    if (!on) {
      latest.current.cancel();
      return;
    }
    const now = forced.current;
    forced.current = false;
    const t = window.setTimeout(
      () => {
        latest.current
          .run((signal) => checkoutPlan(body, { signal }))
          .then((r) => {
            if (r.stale) return;
            setState((s) => ({ key, plan: r.value || s.plan, error: r.value ? null : new Error('not a plan') }));
          })
          .catch((e) => {
            if ((e as any)?.name === 'AbortError') return;
            setState((s) => ({ key, plan: s.plan, error: e }));
          });
      },
      now ? 0 : debounceMs,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, force]);

  useEffect(() => () => latest.current.cancel(), []);

  const current = state.key === key;
  return {
    plan: on ? state.plan : null,
    fresh: on && current && !state.error && !!state.plan,
    waiting: on && !current,
    error: on && current ? state.error : null,
    replace: (plan) => {
      latest.current.cancel();
      setState({ key, plan, error: null });
    },
    refresh: () => {
      forced.current = true;
      setForce((n) => n + 1);
    },
  };
}

export interface PlanParcelsProps {
  plan: CheckoutPlan | null | undefined;
  className?: string;
  labels?: { delivery?: string; free?: string; from?: string };
}

/**
 * "Arrives in 2 parcels": each parcel's store, what is in it and its delivery, then the delivery
 * per location ("Pokhara Rs 150 · Butwal free"). Nothing for a single parcel (shown as today).
 */
export function PlanParcels({ plan, className, labels }: PlanParcelsProps) {
  const money = useMoney();
  const title = parcelsTitle(plan);
  if (!plan || !title) return null;
  const rows = parcelRows(plan);
  const byLocation = deliveryByLocation(plan, money);
  return (
    <section className={cx('bx-plan-parcels', className)} data-bx="plan-parcels" aria-live="polite">
      <p className="bx-plan-title bx-strong">{title}</p>
      <ol className="bx-plan-list">
        {rows.map((r) => (
          <li key={r.index} className="bx-plan-parcel">
            <p className="bx-plan-from">
              {labels?.from || 'From'} {r.from}
              <span className="bx-muted">
                {' · '}
                {labels?.delivery || 'Delivery'} {r.delivery > 0 ? money(r.delivery) : labels?.free || 'free'}
              </span>
            </p>
            <p className="bx-plan-items bx-muted">{r.items}</p>
          </li>
        ))}
      </ol>
      {byLocation ? <p className="bx-plan-delivery bx-muted">{`${labels?.delivery || 'Delivery'}: ${byLocation}`}</p> : null}
    </section>
  );
}

/** The plan changed under the shopper (409 `CHECKOUT_PLAN_STALE`): the server's words and what changed. */
export function PlanNotice({ message, changes, onDismiss, className }: { message: string; changes: string[]; onDismiss?: () => void; className?: string }) {
  return (
    <div className={cx('bx-notice bx-plan-notice', className)} role="status" data-bx="plan-notice">
      <p className="bx-strong">{message}</p>
      {changes.map((c) => (
        <p key={c}>{c}</p>
      ))}
      {onDismiss ? (
        <Button variant="ghost" onClick={onDismiss}>
          OK
        </Button>
      ) : null}
    </div>
  );
}

/** The note kept by the checkout for this order (a split checkout, or parcels that changed on create). */
export const readPlacedCheckout = (orderId: string): PlacedCheckoutNote | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.placedCheckout);
    const n = raw ? (JSON.parse(raw) as PlacedCheckoutNote) : null;
    if (!n || n.order_id !== orderId) return null;
    return n;
  } catch {
    return null;
  }
};

export const savePlacedCheckout = (note: PlacedCheckoutNote | null) => {
  try {
    if (note) sessionStorage.setItem(STORAGE_KEYS.placedCheckout, JSON.stringify(note));
    else sessionStorage.removeItem(STORAGE_KEYS.placedCheckout);
  } catch {
    /* storage blocked */
  }
};

/**
 * The order page of a split checkout: "Your checkout arrives in 2 parcels" with every order
 * number, the store it ships from and its status, linking to each order. With `fromCheckout`,
 * the "parcels changed" note when create moved an item to another store.
 */
export function CheckoutParcels({ order, fromCheckout, className }: { order: any; fromCheckout?: boolean; className?: string }) {
  const money = useMoney();
  const rows = groupOrderRows(order);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!fromCheckout || !order?._id) return;
    setChanged(!!readPlacedCheckout(String(order._id))?.plan_changed);
  }, [fromCheckout, order?._id]);
  if (!rows.length && !changed) return null;
  return (
    <section className={cx('bx-track-card bx-checkout-parcels', className)} data-bx="checkout-parcels">
      {changed ? <p className="bx-notice bx-plan-notice">{PLAN_CHANGED_NOTE}</p> : null}
      {rows.length ? (
        <>
          <h2 className="bx-section-title">{`Your checkout arrives in ${rows.length} parcels`}</h2>
          <ol className="bx-plan-list">
            {rows.map((r) => (
              <li key={r._id} className={cx('bx-plan-parcel', r.current && 'bx-plan-parcel--current')}>
                <p className="bx-plan-from">
                  {r.current ? (
                    <span className="bx-strong">Order #{r.order_number} (this page)</span>
                  ) : (
                    <Link href={`/track/${r._id}`}>Order #{r.order_number}</Link>
                  )}
                  {r.from ? <span className="bx-muted"> · from {r.from}</span> : null}
                </p>
                <p className="bx-plan-items bx-muted">
                  {r.status}
                  {r.total ? ` · ${money(r.total)}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

const availabilityCache = new Map<string, { at: number; value: StoreAvailability }>();
const AVAILABILITY_TTL = 60_000;

/**
 * Which shops have this product (bands only), only when the store shows them. In the routing
 * order of the city the shopper chose at checkout (`shopperCity()`, or `place`), else pool order.
 */
export function useStoreAvailability(productId: string | null | undefined, place?: string | null): StoreAvailability | null {
  const { store, storeId } = useBlanxer();
  const on = showsStores(store) && !!storeId && !!productId;
  const [value, setValue] = useState<StoreAvailability | null>(null);
  useEffect(() => {
    if (!on || !productId) {
      setValue(null);
      return;
    }
    const city = place ?? shopperCity();
    const cacheKey = `${storeId}:${productId}:${city}`;
    const hit = availabilityCache.get(cacheKey);
    if (hit && Date.now() - hit.at < AVAILABILITY_TTL) {
      setValue(hit.value);
      return;
    }
    const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
    storeAvailability(storeId, productId, c ? { signal: c.signal } : undefined, city || null)
      .then((v) => {
        availabilityCache.set(cacheKey, { at: Date.now(), value: v });
        setValue(v);
      })
      .catch(() => {
        /* aborted */
      });
    return () => c?.abort();
  }, [on, storeId, productId, place]);
  return on ? value : null;
}

export interface StoreAvailabilityProps {
  productId: string;
  /** the picked variant ('' = the product without variants, or any variant) */
  variantId?: string | null;
  /** the shopper's city (else the one chosen at checkout): its routing order */
  place?: string | null;
  className?: string;
}

/**
 * The one line under the price on stores that show their shops: "Available at all 13 stores",
 * "Available at Pokhara, Butwal (few left)", or "Available at Chitwan, Kathmandu +11 more · See
 * stores", for the picked variant. "See stores" opens the list (a modal; a bottom sheet on phones).
 * Nothing when no store has it (the page says "Out of stock").
 */
export function StoreAvailabilityLine({ productId, variantId, place, className }: StoreAvailabilityProps) {
  const avail = useStoreAvailability(productId, place);
  const stores = storesWith(avail, variantId);
  const line = storesLine(stores, avail?.pool_count);
  const [open, setOpen] = useState(false);
  if (line.kind === 'none') return null;
  const pickup = line.kind === 'list' && stores.some((s) => s.pickup);
  return (
    <>
      <p className={cx('bx-store-availability', className)} data-bx="store-availability" data-kind={line.kind}>
        {line.text}
        {pickup ? <span className="bx-muted"> · pick up in store at checkout</span> : null}
        {line.canOpen ? (
          <>
            {' · '}
            <button type="button" className="bx-store-availability-see" onClick={() => setOpen(true)}>
              See stores
            </button>
          </>
        ) : null}
      </p>
      <StoreListModal open={open} onClose={() => setOpen(false)} stores={stores} />
    </>
  );
}

/** "See stores": every store that has the picked variant, its city and band, a Pickup tag; a search box above 8 stores. */
export function StoreListModal({ open, onClose, stores, title = 'Stores with this item' }: { open: boolean; onClose: () => void; stores: StoreHas[]; title?: string }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  const rows = storeRows(stores);
  const shown = filterStoreRows(rows, q);
  return (
    <Modal open={open} onClose={onClose} title={title} dismissible sheet className="bx-stores-modal">
      {rows.length > SEARCH_FROM ? (
        <input
          type="search"
          className="bx-input bx-stores-search"
          placeholder="Search a store or city"
          aria-label="Search a store or city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      ) : null}
      <ul className="bx-stores-list" data-bx="store-list">
        {shown.map((r) => (
          <li key={r._id} className="bx-stores-row">
            <div>
              <p className="bx-strong">{r.name}</p>
              {r.city ? <p className="bx-muted">{r.city}</p> : null}
            </div>
            <div className="bx-stores-tags">
              {r.pickup ? <span className="bx-stores-tag bx-stores-tag--pickup">Pickup</span> : null}
              <span className={cx('bx-stores-tag', r.stock === 'Few left' ? 'bx-stores-tag--few' : 'bx-stores-tag--in')}>{r.stock}</span>
            </div>
          </li>
        ))}
        {!shown.length ? <li className="bx-muted bx-stores-empty">No store matches “{q}”.</li> : null}
      </ul>
    </Modal>
  );
}
