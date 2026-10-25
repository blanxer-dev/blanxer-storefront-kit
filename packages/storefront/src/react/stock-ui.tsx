'use client';
/**
 * Stock the server says isn't there (stock-oversell contract §2, §9): the notice that shows the
 * server's words with the short lines ("Sold out" / "Only 2 left"), "Change my order" and, for
 * stock held in other shoppers' checkouts, "Try again" once the server's wait is over; and the
 * cart's caps from `POST /order/public/stock-check`. Every number is the server's.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { capCart, noCaps, retryLabel, stockCheckBody, stockLineLeft, stockLineName, stockNoticeTitle, type CapLine, type CartChange, type StockCaps, type StockRefusal } from '../core/stock.js';
import { stockCheck } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useOptionalCart } from './cart.js';
import { Button, Modal, cx } from './ui.js';

const NO_CAPS: StockCaps = noCaps();

export interface UseStockCapsOptions {
  /** the lines the checkout would order (the cart's selected lines) */
  lines: CapLine[];
  /** ask only while true (e.g. not while an order waits for its payment: its own hold would count) */
  enabled?: boolean;
  /** debounce, ms (default 400) */
  delayMs?: number;
}

/**
 * The server's caps for these lines (`stockCheck`, debounced, a stale request aborted). `caps`
 * keeps the last answer (empty until one comes, and for an older backend); `fresh` is true once
 * it is for the lines as they are now. `check()` asks right away (before Place order).
 */
export function useStockCaps({ lines, enabled = true, delayMs = 400 }: UseStockCapsOptions) {
  const { storeId } = useBlanxer();
  const key = useMemo(() => JSON.stringify(stockCheckBody(storeId, lines).lines), [storeId, lines]);
  const [answer, setAnswer] = useState<{ key: string; caps: StockCaps } | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!enabled || !storeId || key === '[]') return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      stockCheck(storeId, linesRef.current, { signal: ctrl.signal })
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
      const caps = await stockCheck(storeId, linesRef.current);
      setAnswer({ key: k, caps });
      return caps;
    } catch {
      return NO_CAPS;
    }
  }, [storeId]);

  return { caps: answer?.caps ?? NO_CAPS, fresh: !!answer && answer.key === key, check };
}

/**
 * `useStockCaps` over the cart's selected lines, holding the cart to the answer: when the
 * server allows fewer than the cart has, the lines are capped (removed at 0) and `onCapped`
 * gets what changed (show it with `<StockNotice refusal={refusalFromChanges(changes)} onDismiss={…} />`).
 */
export function useCartStockCaps({ enabled = true, onCapped, delayMs }: { enabled?: boolean; onCapped?: (changes: CartChange[]) => void; delayMs?: number } = {}) {
  const cart = useOptionalCart();
  const lines = cart?.selectedItems ?? [];
  const on = enabled && !!cart?.hydrated;
  const stock = useStockCaps({ lines, enabled: on, delayMs });
  const onCappedRef = useRef(onCapped);
  onCappedRef.current = onCapped;
  useEffect(() => {
    if (!on || !stock.fresh || !cart) return;
    const { changes } = capCart(lines, stock.caps);
    if (!changes.length) return;
    cart.capLines(stock.caps, lines.map((l) => l.id));
    onCappedRef.current?.(changes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, stock.fresh, stock.caps]);
  return stock;
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
              <span className={cx('bx-stock-notice-left', l.available > 0 ? 'bx-stock-notice-left--some' : 'bx-stock-notice-left--none')}>{stockLineLeft(l)}</span>
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
