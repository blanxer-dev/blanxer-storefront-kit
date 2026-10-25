'use client';
/**
 * Stock the server says isn't there (stock-oversell contract §2, §9): the notice that shows the
 * server's words with the short lines ("Sold out" / "Only 2 left"), "Change my order" and, for
 * stock held in other shoppers' checkouts, "Try again" once the server's wait is over; and the
 * cart's caps from `POST /order/public/stock-check`. Every number is the server's.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../core/config.js';
import {
  capCart,
  noCaps,
  refusalFromChanges,
  retryLabel,
  stockCheckBody,
  stockLineLeft,
  stockLineName,
  stockNoticeTitle,
  type CapLine,
  type CartChange,
  type StockCaps,
  type StockRefusal,
  type WaitingProof,
} from '../core/stock.js';
import type { CartItem } from '../core/types.js';
import { keepOrderChoices, stockCheck, takeOrderChoices, type OrderChoices } from '../client/index.js';
import { useOffers } from './offers.js';
import { useBlanxer } from './context.js';
import { useOptionalCart } from './cart.js';
import { Button, Modal, cx } from './ui.js';

const NO_CAPS: StockCaps = noCaps();
const NO_LINES: CartItem[] = [];

export interface UseStockCapsOptions {
  /** the lines the checkout would order (the cart's selected lines) */
  lines: CapLine[];
  /** ask only while true */
  enabled?: boolean;
  /**
   * this cart's order that waits for its payment, with its proof (`waitingProof`), so its own
   * hold isn't counted (contract v1.2). While an order waits and there is no proof, don't ask.
   */
  waiting?: WaitingProof | null;
  /** debounce, ms (default 400) */
  delayMs?: number;
}

/**
 * The server's caps for these lines (`stockCheck`, debounced, a stale request aborted). `caps`
 * keeps the last answer (empty until one comes, and for an older backend); `fresh` is true once
 * it is for the lines as they are now; `checked` is the request that answer is for (act once per
 * answer). `check()` asks right away (before Place order).
 */
export function useStockCaps({ lines, enabled = true, waiting, delayMs = 400 }: UseStockCapsOptions) {
  const { storeId } = useBlanxer();
  const key = useMemo(() => JSON.stringify(stockCheckBody(storeId, lines, waiting)), [storeId, lines, waiting]);
  const [answer, setAnswer] = useState<{ key: string; caps: StockCaps } | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!enabled || !storeId || !linesRef.current.length) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      stockCheck(storeId, linesRef.current, waitingRef.current, { signal: ctrl.signal })
        .then((caps) => setAnswer({ key, caps }))
        .catch(() => {});
    }, delayMs);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [key, enabled, storeId, delayMs]);

  const check = useCallback(async (): Promise<StockCaps> => {
    const k = keyRef.current;
    try {
      const caps = await stockCheck(storeId, linesRef.current, waitingRef.current);
      setAnswer({ key: k, caps });
      return caps;
    } catch {
      return NO_CAPS;
    }
  }, [storeId]);

  return { caps: answer?.caps ?? NO_CAPS, fresh: !!answer && answer.key === key, checked: answer?.key ?? '', check };
}

export interface UseCartStockCapsOptions {
  enabled?: boolean;
  /** no order waits: the cart was held to the answer, this is what changed */
  onCapped?: (changes: CartChange[]) => void;
  /** this cart's order that waits for its payment, with its proof (see `useStockCaps`) */
  waiting?: WaitingProof | null;
  /**
   * an order waits and the answer is short: told once per answer, the cart is NOT changed behind
   * the shopper's back ("Change my order": give the waiting order up, then `cart.capLines(caps)`)
   */
  onShort?: (refusal: StockRefusal, caps: StockCaps) => void;
  delayMs?: number;
}

/**
 * `useStockCaps` over the cart's selected lines. No order waiting: when the server allows fewer
 * than the cart has, the lines are capped (removed at 0) and `onCapped` gets what changed (show
 * it with `<StockNotice refusal={refusalFromChanges(changes)} onDismiss={…} />`). An order
 * waiting: `onShort` once per answer, nothing changed.
 */
export function useCartStockCaps({ enabled = true, onCapped, waiting, onShort, delayMs }: UseCartStockCapsOptions = {}) {
  const cart = useOptionalCart();
  const lines = cart?.selectedItems ?? NO_LINES;
  const on = enabled && !!cart?.hydrated;
  const stock = useStockCaps({ lines, enabled: on, waiting, delayMs });
  const cbs = useRef({ onCapped, onShort });
  cbs.current = { onCapped, onShort };
  const toldFor = useRef('');
  useEffect(() => {
    if (!on || !stock.fresh || !cart) return;
    const { changes } = capCart(lines, stock.caps);
    if (!changes.length) return;
    if (waiting) {
      const told = `${waiting.order_id}:${stock.checked}`;
      if (toldFor.current === told) return;
      toldFor.current = told;
      cbs.current.onShort?.(refusalFromChanges(changes)!, stock.caps);
      return;
    }
    cart.capLines(stock.caps, lines.map((l) => l.id));
    cbs.current.onCapped?.(changes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, stock.fresh, stock.caps]);
  return stock;
}

/**
 * The shopper's code (and Offers picks) across an order that waits for its payment: placing it
 * clears them, so `snapshot()` them before clearing and `keep(order_id, choices)` once it waits;
 * `restore(order_id)` when that order is given up (refused for stock, "Change my order", changed
 * details, cash on delivery instead) puts them back, so the replacement order sends the code again
 * and the server prices it again. Gone once the order is paid (`clearPendingOrder`).
 */
export function useOrderChoices() {
  const offers = useOffers();
  const snapshot = (): OrderChoices => {
    let promo = '';
    try {
      promo = localStorage.getItem(STORAGE_KEYS.promoCode) || '';
    } catch {
      /* private mode */
    }
    return { offers: offers.enabled ? offers.choices() : undefined, promo: promo || undefined };
  };
  return {
    snapshot,
    keep: (order_id: string, choices: OrderChoices) => keepOrderChoices(order_id, choices),
    /** what was put back (null: nothing kept for that order) */
    restore: (order_id: string): OrderChoices | null => {
      const c = takeOrderChoices(order_id);
      if (!c) return null;
      if (c.offers) offers.restoreChoices(c.offers);
      else if (c.promo)
        try {
          localStorage.setItem(STORAGE_KEYS.promoCode, c.promo);
        } catch {
          /* private mode */
        }
      return c;
    },
  };
}

export interface StockNoticeProps {
  /** `toStockRefusal(err)`, or `refusalFromChanges(changes)` for a cart the stock check changed */
  refusal: StockRefusal;
  /** "Change my order": hold the cart to what is left and place a new order */
  onChangeOrder?: () => void;
  changeLabel?: string;
  /** STOCK_HELD only: "Try again" (enabled once the server's `retry_after_seconds` are over) */
  onRetry?: () => void;
  /** a cart already held to what is left: the button that closes the notice */
  onDismiss?: () => void;
  /** default "Continue with the rest" */
  dismissLabel?: string;
  /** the heading (`stockNoticeTitle`) is shown in the box; the modal puts it in its title instead */
  hideTitle?: boolean;
  busy?: boolean;
  className?: string;
}

/** Seconds left of the server's wait (`retry_after_seconds`), counted down from when it came. */
function useRetryWait(refusal: StockRefusal) {
  const [left, setLeft] = useState(() => Math.ceil(refusal.retry_after_seconds || 0));
  useEffect(() => {
    const total = Math.ceil(refusal.retry_after_seconds || 0);
    setLeft(total);
    if (!total) return;
    const until = Date.now() + total * 1000;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (!s) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [refusal]);
  return left;
}

/**
 * The stock is gone (contract §2, §9): the heading, the server's words ("Sorry, Hot-water bag
 * just sold out. You were not charged."), each short line with what is left ("Sold out" /
 * "Only 1 left"), and the way on: "Change my order" (the cart held to what is left, a new order
 * from it) and, for STOCK_HELD, "Try again" once the server's wait is over. Never a pay button,
 * never a generic error.
 */
export function StockNotice({ refusal, onChangeOrder, changeLabel = 'Change my order', onRetry, onDismiss, dismissLabel = 'Continue with the rest', hideTitle, busy, className }: StockNoticeProps) {
  const id = useId();
  const wait = useRetryWait(refusal);
  const held = refusal.code === 'STOCK_HELD';
  const retry = held && onRetry;
  return (
    <section className={cx('bx-stock-notice', held && 'bx-stock-notice--held', className)} role="alert" aria-labelledby={`${id}-msg`} data-bx="stock-notice" data-code={refusal.code}>
      {hideTitle ? null : <p className="bx-stock-notice-title">{stockNoticeTitle(refusal.code)}</p>}
      <p className="bx-stock-notice-message" id={`${id}-msg`}>
        {refusal.message}
      </p>
      {refusal.lines.length ? (
        <ul className="bx-stock-notice-lines">
          {refusal.lines.map((l, i) => (
            <li key={`${l.product_id}|${l.variant_id}|${i}`} className="bx-stock-notice-line">
              <span className="bx-stock-notice-name">
                {stockLineName(l)}
                {l.wanted > 0 ? <span className="bx-muted"> · you wanted {l.wanted}</span> : null}
              </span>
              <span className={cx('bx-stock-notice-left', l.available > 0 ? 'bx-stock-notice-left--some' : 'bx-stock-notice-left--none')}>{stockLineLeft(l, refusal.code)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {onChangeOrder || retry || onDismiss ? (
        <div className="bx-stock-notice-actions">
          {onChangeOrder ? (
            <Button className="bx-stock-notice-change" disabled={busy} onClick={onChangeOrder}>
              {changeLabel}
            </Button>
          ) : null}
          {retry ? (
            <Button variant="secondary" className="bx-stock-notice-retry" loading={busy} disabled={wait > 0} onClick={onRetry}>
              {retryLabel(wait)}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant={onChangeOrder ? 'ghost' : 'secondary'} className="bx-stock-notice-ok" onClick={onDismiss}>
              {dismissLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** `StockNotice` in a small modal (a refused order or payment). Closing it changes nothing. */
export function StockNoticeModal({ open, onClose, refusal, ...props }: Omit<StockNoticeProps, 'refusal'> & { open: boolean; onClose: () => void; refusal: StockRefusal | null }) {
  if (!refusal) return null;
  return (
    <Modal open={open} onClose={onClose} title={stockNoticeTitle(refusal.code)} dismissible className="bx-stock-modal">
      <StockNotice {...props} refusal={refusal} hideTitle />
    </Modal>
  );
}
