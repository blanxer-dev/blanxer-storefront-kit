'use client';
/**
 * Offers state for the browser: the store's public offers and display settings, the
 * shopper's code (one per order), removed automatic offers and gift picks, and the cart
 * quote. Everything is priced by the server; nothing here computes a discount.
 *
 * When the store isn't on Offers (`enabled: false`) every hook returns empty values and
 * the checkout keeps the coupon flow.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../core/config.js';
import {
  buildQuoteRequest,
  createLatest,
  normalizeCode,
  offersDisplay,
  offersPlugin,
  quoteKey,
  type OffersDisplay,
  type OffersResponse,
  type PublicOffer,
  type Quote,
  type QuoteRequest,
} from '../core/offers.js';
import type { CartItem } from '../core/types.js';
import { getOffers, getProductOffers, quoteCart } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useCart } from './cart.js';

export interface OffersContextValue {
  /**
   * we know whether the store is on Offers. Until then `enabled` is false and the checkout
   * shows neither the coupon field nor the code field.
   */
  ready: boolean;
  /**
   * the store is on Offers: its plugin is on and `GET /public/promotions` said so. Any
   * failure (404 from an older backend, network, a non-JSON answer) → false → coupon flow.
   */
  enabled: boolean;
  offers: PublicOffer[];
  display: OffersDisplay;
  /** server time − browser time, ms (countdowns) */
  clockOffset: number;
  /** the shopper's code ('' = none). Kept in localStorage `promo_code`, like `?promo=`. */
  code: string;
  setCode: (code: string) => void;
  /** automatic offers the shopper removed (e.g. a gift they don't want) */
  removedOffers: string[];
  removeOffer: (offerId: string) => void;
  restoreOffer: (offerId: string) => void;
  /** gift picked per offer id: `productId|variantId` */
  giftChoices: Record<string, string>;
  chooseGift: (offerId: string, productId: string, variantId?: string | null) => void;
  /** Forget the code, removals and gift picks (after an order is placed). */
  clearChoices: () => void;
  refresh: () => void;
  /** Turn offers off for this page (the quote endpoint isn't there): the coupon flow takes over. */
  disable: () => void;
}

const OffersContext = createContext<OffersContextValue | null>(null);

const OFF: OffersContextValue = {
  ready: true,
  enabled: false,
  offers: [],
  display: offersDisplay(null),
  clockOffset: 0,
  code: '',
  setCode: () => {},
  removedOffers: [],
  removeOffer: () => {},
  restoreOffer: () => {},
  giftChoices: {},
  chooseGift: () => {},
  clearChoices: () => {},
  refresh: () => {},
  disable: () => {},
};

/** Offers state from the nearest `<BlanxerProvider>` (or empty values outside one). */
export const useOffers = (): OffersContextValue => useContext(OffersContext) || OFF;

const readStorage = (key: string): string => {
  try {
    return typeof window === 'undefined' ? '' : localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
};

// one list per store per page load; client navigations reuse it for a minute
const LIST_TTL = 60_000;
const listCache = new Map<string, { at: number; res: Promise<OffersResponse> }>();

const loadOffers = (storeId: string, force = false): Promise<OffersResponse> => {
  const hit = listCache.get(storeId);
  if (hit && !force && Date.now() - hit.at < LIST_TTL) return hit.res;
  const res = getOffers(storeId);
  listCache.set(storeId, { at: Date.now(), res });
  res.catch(() => listCache.delete(storeId));
  return res;
};

/** Mounted by `<BlanxerProvider>`. Fetches the store's offers once per page load. */
export function OffersProvider({ children }: { children: ReactNode }) {
  const { store, storeId } = useBlanxer();
  const hint = offersPlugin(store);
  // no offers plugin on the store → coupon flow at once, without asking the API
  const asks = !!hint?.enabled;
  const [list, setList] = useState<OffersResponse | null>(null);
  const [ready, setReady] = useState(!asks);
  const [disabled, setDisabled] = useState(false);
  const [code, setCodeState] = useState('');
  const [removedOffers, setRemoved] = useState<string[]>([]);
  const [giftChoices, setGifts] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!storeId || !asks) {
      setReady(true);
      return;
    }
    let alive = true;
    // getOffers never throws: a missing endpoint or a bad answer comes back as offers off
    loadOffers(storeId, tick > 0)
      .then((res) => alive && setList(res))
      .catch(() => alive && setList(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [storeId, tick, asks]);

  // the code: `?promo=` on this URL wins, else what's saved (BlanxerProvider saves `?promo=` too)
  useEffect(() => {
    let promo = '';
    try {
      promo = new URLSearchParams(window.location.search).get('promo') || '';
    } catch {
      promo = '';
    }
    setCodeState(normalizeCode(promo || readStorage(STORAGE_KEYS.promoCode)));
    try {
      const saved = JSON.parse(readStorage(STORAGE_KEYS.offerChoices) || '{}');
      if (Array.isArray(saved?.removed)) setRemoved(saved.removed.map(String));
      if (saved?.gifts && typeof saved.gifts === 'object') setGifts(saved.gifts);
    } catch {
      /* ignore */
    }
  }, []);

  const saveChoices = (removed: string[], gifts: Record<string, string>) =>
    writeStorage(STORAGE_KEYS.offerChoices, removed.length || Object.keys(gifts).length ? JSON.stringify({ removed, gifts }) : '');

  const setCode = useCallback((c: string) => {
    const v = normalizeCode(c);
    setCodeState(v);
    writeStorage(STORAGE_KEYS.promoCode, v);
  }, []);

  const removeOffer = useCallback(
    (id: string) =>
      setRemoved((prev) => {
        const next = prev.includes(id) ? prev : [...prev, id];
        saveChoices(next, giftChoices);
        return next;
      }),
    [giftChoices],
  );
  const restoreOffer = useCallback(
    (id: string) =>
      setRemoved((prev) => {
        const next = prev.filter((x) => x !== id);
        saveChoices(next, giftChoices);
        return next;
      }),
    [giftChoices],
  );
  const chooseGift = useCallback(
    (offerId: string, productId: string, variantId?: string | null) =>
      setGifts((prev) => {
        const next = { ...prev, [offerId]: `${productId}|${variantId || ''}` };
        saveChoices(removedOffers, next);
        return next;
      }),
    [removedOffers],
  );
  const clearChoices = useCallback(() => {
    setCodeState('');
    setRemoved([]);
    setGifts({});
    writeStorage(STORAGE_KEYS.promoCode, '');
    writeStorage(STORAGE_KEYS.offerChoices, '');
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const disable = useCallback(() => setDisabled(true), []);

  const enabled = asks && !disabled && !!list?.enabled;
  const value = useMemo<OffersContextValue>(
    () => ({
      ready,
      enabled,
      offers: enabled ? list?.data || [] : [],
      display: offersDisplay(enabled ? list?.settings : hint?.display),
      clockOffset: list?.server_time ? new Date(list.server_time).getTime() - Date.now() : 0,
      code: enabled ? code : '',
      setCode,
      removedOffers: enabled ? removedOffers : [],
      removeOffer,
      restoreOffer,
      giftChoices: enabled ? giftChoices : {},
      chooseGift,
      clearChoices,
      refresh,
      disable,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, enabled, list, hint?.enabled, code, removedOffers, giftChoices, setCode, removeOffer, restoreOffer, chooseGift, clearChoices, refresh, disable],
  );

  return <OffersContext.Provider value={value}>{children}</OffersContext.Provider>;
}

// ---------------------------------------------------------------- product offers

const productCache = new Map<string, { at: number; res: Promise<OffersResponse> }>();

/**
 * The offers that touch one product (`GET /public/promotions/:store_id/product/:id`), for
 * the product page. Empty when the store isn't on Offers.
 */
export function useProductOffers(productId: string | null | undefined): { offers: PublicOffer[]; loading: boolean } {
  const { storeId } = useBlanxer();
  const { enabled, ready } = useOffers();
  const [offers, setOffers] = useState<PublicOffer[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!storeId || !productId || !enabled) {
      setOffers([]);
      return;
    }
    let alive = true;
    const key = `${storeId}:${productId}`;
    let hit = productCache.get(key);
    if (!hit || Date.now() - hit.at > LIST_TTL) {
      hit = { at: Date.now(), res: getProductOffers(storeId, productId) };
      productCache.set(key, hit);
      hit.res.catch(() => productCache.delete(key));
    }
    setLoading(true);
    hit.res
      .then((r) => alive && setOffers(r.enabled ? r.data : []))
      .catch(() => alive && setOffers([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [storeId, productId, enabled, ready]);
  return { offers, loading };
}

// ---------------------------------------------------------------- cart quote

// the same cart asked twice within a few seconds (cart drawer + product page) is one call
const QUOTE_TTL = 8_000;
const quoteCache = new Map<string, { at: number; quote: Quote | null }>();

export interface UseCartQuoteOptions {
  /** lines to price; default the cart's selected lines (what checkout orders) */
  lines?: CartItem[];
  /** delivery place (checkout); delivery offers wait for it */
  place?: string;
  /** checkout payment method name; undefined = not asked yet */
  paymentMethod?: string;
  /** shopper's phone (sent only once it's 10 digits) */
  phone?: string;
  /** use this code instead of the shopper's saved one ('' = none) */
  code?: string | null;
  /** wait this long after the last change (default 350 ms) */
  debounceMs?: number;
  /** false: don't quote (e.g. the store isn't on Offers) */
  enabled?: boolean;
}

export interface CartQuoteState {
  /** the latest server quote (null before the first answer, or when the store isn't on Offers) */
  quote: Quote | null;
  /** the request the current inputs make */
  request: QuoteRequest;
  /** `quote` answers the current inputs (false while a newer request is on its way) */
  fresh: boolean;
  loading: boolean;
  error: unknown;
  /** quote again now (no debounce, no cache) */
  refresh: () => void;
}

/**
 * The cart priced by the server. Debounced, re-quotes when the lines, code, place, payment
 * or phone change, aborts the request it replaces and never shows a stale answer.
 */
export function useCartQuote(opts: UseCartQuoteOptions = {}): CartQuoteState {
  const { storeId } = useBlanxer();
  const cart = useCart();
  const offers = useOffers();
  const lines = opts.lines ?? cart.selectedItems;
  const on = offers.enabled && opts.enabled !== false && cart.hydrated && lines.length > 0;
  const request = useMemo(
    () =>
      buildQuoteRequest({
        lines,
        code: opts.code !== undefined ? opts.code : offers.code,
        place: opts.place,
        paymentMethod: opts.paymentMethod,
        phone: opts.phone,
        removedOffers: offers.removedOffers,
        giftChoices: offers.giftChoices,
      }),
    [lines, opts.code, offers.code, opts.place, opts.paymentMethod, opts.phone, offers.removedOffers, offers.giftChoices],
  );
  const key = quoteKey(request);
  const [state, setState] = useState<{ key: string; quote: Quote | null }>({ key: '', quote: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [force, setForce] = useState(0);
  const forced = useRef(false);
  const latest = useRef(createLatest<Quote | null>());

  useEffect(() => {
    if (!on || !storeId) {
      latest.current.cancel();
      setLoading(false);
      if (!on) setState({ key: '', quote: null });
      return;
    }
    const cacheKey = `${storeId}:${key}`;
    const now = forced.current;
    forced.current = false;
    const hit = quoteCache.get(cacheKey);
    if (hit && !now && Date.now() - hit.at < QUOTE_TTL) {
      latest.current.cancel();
      setState({ key, quote: hit.quote });
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const t = window.setTimeout(
      () => {
        latest.current
          .run((signal) => quoteCart(storeId, request, { signal }))
          .then((r) => {
            if (r.stale) return;
            if (!r.value) {
              // the endpoint isn't there (or the store left Offers): the coupon flow takes over
              offers.disable();
              setLoading(false);
              return;
            }
            quoteCache.set(cacheKey, { at: Date.now(), quote: r.value });
            setState({ key, quote: r.value });
            setError(null);
            setLoading(false);
          })
          .catch((e) => {
            if ((e as any)?.name === 'AbortError') return;
            setError(e);
            setLoading(false);
          });
      },
      now ? 0 : (opts.debounceMs ?? 350),
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, storeId, key, force]);

  useEffect(() => () => latest.current.cancel(), []);

  return {
    quote: on ? state.quote : null,
    request,
    fresh: on && state.key === key,
    loading: on && loading,
    error: on ? error : null,
    refresh: () => {
      forced.current = true;
      setForce((n) => n + 1);
    },
  };
}

/**
 * Ticking clock (server-corrected) for countdowns; ticks only while `on`. null until mounted,
 * so server-rendered pages never disagree with the browser about the time.
 */
export function useOfferClock(on = true): number | null {
  const { clockOffset } = useOffers();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now == null ? null : now + clockOffset;
}
