'use client';
/**
 * Website advance payment ("pay part online, rest on delivery"): the summary rows and the
 * advance quote for stores not on Offers. Every amount is the server's (`core/advance.ts`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { advanceWords, type Advance } from '../core/advance.js';
import { buildQuoteRequest, createLatest, quoteKey } from '../core/offers.js';
import type { CartItem } from '../core/types.js';
import { quoteAdvance } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { cx } from './ui.js';

export interface AdvanceSummaryRowsProps {
  /** the advance the order is placed with (`activeAdvance(...)`), or null: nothing shown */
  advance: Advance | null;
  className?: string;
  labels?: { payNow?: string; onDelivery?: string };
  /** a store pickup: the rest is paid at the store ("Pay at the store") */
  atStore?: boolean;
}

/**
 * "Pay now (advance)" / "Pay on delivery" under the Total. The wrapper is always rendered and
 * `aria-live="polite"`, so a change of place or method reads out the new split.
 */
export function AdvanceSummaryRows({ advance, className, labels, atStore }: AdvanceSummaryRowsProps) {
  const money = useMoney();
  const w = advance ? advanceWords(advance, money, atStore ? 'store' : 'delivery') : null;
  return (
    <div className={cx('bx-advance-split', className)} aria-live="polite" data-bx="advance-split">
      {advance && w ? (
        <>
          <dl className="bx-totals">
            <div className="bx-total-row bx-advance-row bx-advance-row--now">
              <dt>{labels?.payNow || w.payNowLabel}</dt>
              <dd>{money(advance.amount)}</dd>
            </div>
            <div className="bx-total-row bx-advance-row bx-advance-row--later">
              <dt>{labels?.onDelivery || w.onDeliveryLabel}</dt>
              <dd>{money(advance.on_delivery)}</dd>
            </div>
          </dl>
          <span className="bx-sr-only">{w.live}</span>
        </>
      ) : null}
    </div>
  );
}

export interface UseAdvanceQuoteOptions {
  lines: CartItem[];
  /** delivery place; nothing is asked until one is picked */
  place?: string;
  phone?: string;
  /** legacy coupon `_id` when one is applied */
  coupon?: string | null;
  /** ask at all (the store has the advance on, it isn't on Offers, no order in flight) */
  enabled: boolean;
  debounceMs?: number;
  /** a store pickup: the store's pickup advance (no place needed) */
  pickup?: boolean;
}

/**
 * The advance for a store not on Offers: `quoteAdvance` with `payment: 'cod'`, debounced, the
 * request it replaces aborted, never a stale answer. `fresh` is false while the answer for the
 * current cart / place / coupon / phone is still out. A failure is null (plain COD).
 */
export function useAdvanceQuote({ lines, place, phone, coupon, enabled, debounceMs = 350, pickup = false }: UseAdvanceQuoteOptions): {
  advance: Advance | null;
  fresh: boolean;
} {
  const { storeId } = useBlanxer();
  const request = useMemo(
    () => buildQuoteRequest({ lines, place, paymentMethod: 'COD', phone, coupon: coupon || '', pickup }),
    [lines, place, phone, coupon, pickup],
  );
  const key = quoteKey(request);
  const on = enabled && !!storeId && (!!place || pickup) && request.products.length > 0;
  const [state, setState] = useState<{ key: string; advance: Advance | null }>({ key: '', advance: null });
  const latest = useRef(createLatest<Advance | null>());

  useEffect(() => {
    if (!on) {
      latest.current.cancel();
      return;
    }
    const t = window.setTimeout(() => {
      latest.current
        .run((signal) => quoteAdvance(storeId, request, { signal }))
        .then((r) => {
          if (!r.stale) setState({ key, advance: r.value });
        })
        .catch((e) => {
          if ((e as any)?.name === 'AbortError') return;
          setState({ key, advance: null });
        });
    }, debounceMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, storeId, key]);

  useEffect(() => () => latest.current.cancel(), []);

  if (!on) return { advance: null, fresh: true };
  return { advance: state.advance, fresh: state.key === key };
}
