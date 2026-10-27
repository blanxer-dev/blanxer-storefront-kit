'use client';

/**
 * Store pickup at checkout (TSK-154): "How do you want it?" (Home delivery / Pick up at store) and
 * the store's pickup outlets with what each has of the cart. Shown only when `check_domain` lists
 * pickup outlets (`pickupOutletsOf(store)`); `Checkout` renders it, or use it in your own form.
 */
import { useEffect, useMemo, useState } from 'react';
import { pickupStock } from '../client/index.js';
import { pickedOutlet, pickupStockLine, recommendLine, type Fulfilment } from '../core/pickup.js';
import type { PickupOutlet, PickupStockRow } from '../core/types.js';
import { useBlanxer } from './context.js';
import { cx } from './ui.js';

/** The cart's stock at each pickup outlet, read again when the lines change (only while `on`). */
export function usePickupStock(
  on: boolean,
  lines: Array<{ product: string; variant?: string; quantity: number; bundle_picks?: string[]; added_by?: string }>,
): { rows: PickupStockRow[] | null; recommended: string | null; loading: boolean } {
  const { storeId } = useBlanxer();
  const key = JSON.stringify(lines.map((l) => [l.product, l.variant || '', l.quantity, l.bundle_picks || [], !!l.added_by]));
  const [state, setState] = useState<{ rows: PickupStockRow[] | null; recommended: string | null; loading: boolean }>({
    rows: null,
    recommended: null,
    loading: false,
  });
  useEffect(() => {
    if (!on || !storeId || !lines.length) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    pickupStock(storeId, lines, { signal: ctrl.signal })
      .then((r) => setState({ rows: r.outlets.length ? r.outlets : null, recommended: r.recommended, loading: false }))
      .catch(() => undefined);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, storeId, key]);
  return state;
}

export interface PickupChoiceProps {
  outlets: PickupOutlet[];
  fulfilment: Fulfilment;
  onFulfilment: (f: Fulfilment) => void;
  picked: string;
  onPick: (outletId: string) => void;
  rows: PickupStockRow[] | null;
  recommended: string | null;
  loading?: boolean;
  labels?: { title?: string; delivery?: string; deliveryLine?: string; pickup?: string; pickupLine?: string; from?: string; ready?: string };
  className?: string;
}

export function PickupChoice({ outlets, fulfilment, onFulfilment, picked, onPick, rows, recommended, loading, labels, className }: PickupChoiceProps) {
  // follow the stock: keep the shopper's store while it has the cart, else the recommended one
  useEffect(() => {
    if (fulfilment !== 'pickup') return;
    const next = pickedOutlet(picked, rows, recommended) || outlets[0]?._id || '';
    if (next !== picked) onPick(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfilment, rows, recommended]);
  const list = useMemo(() => outlets.map((o) => ({ ...o, row: rows?.find((r) => r._id === o._id) })), [outlets, rows]);
  const hint = recommendLine(picked, rows, recommended);
  const choices: Array<{ value: Fulfilment; title: string; line: string }> = [
    { value: 'delivery', title: labels?.delivery || 'Home delivery', line: labels?.deliveryLine || 'Delivered to your address' },
    { value: 'pickup', title: labels?.pickup || 'Pick up at store', line: labels?.pickupLine || 'No delivery charge' },
  ];
  return (
    <section className={cx('bx-section bx-pickup', className)} data-bx="pickup-choice">
      <h2 className="bx-section-title">{labels?.title || 'How do you want it?'}</h2>
      <div className="bx-pickup-choices" role="radiogroup" aria-label={labels?.title || 'How do you want it?'}>
        {choices.map((c) => (
          <label key={c.value} className={cx('bx-payment-method', fulfilment === c.value && 'bx-payment-method--active')} data-fulfilment={c.value}>
            <input type="radio" name="bx-fulfilment" value={c.value} checked={fulfilment === c.value} onChange={() => onFulfilment(c.value)} />
            <span className="bx-payment-text">
              <span className="bx-payment-name">{c.title}</span>
              <span className="bx-muted">{c.line}</span>
            </span>
          </label>
        ))}
      </div>
      {fulfilment === 'pickup' ? (
        <div className="bx-pickup-outlets">
          <h3 className="bx-pickup-from">{labels?.from || 'Pick up from'}</h3>
          <div role="radiogroup" aria-label={labels?.from || 'Pick up from'} aria-busy={!!loading} className="bx-pickup-list">
            {list.map((o) => {
              const short = !!o.row && !o.row.in_stock;
              return (
                <label key={o._id} className={cx('bx-payment-method bx-pickup-outlet', picked === o._id && 'bx-payment-method--active', short && 'bx-pickup-outlet--short')} data-outlet={o.name}>
                  <input type="radio" name="bx-pickup-outlet" value={o._id} checked={picked === o._id} onChange={() => onPick(o._id)} />
                  <span className="bx-payment-text">
                    <span className="bx-payment-name">
                      {o.name}
                      {o._id === recommended && rows && rows.length > 1 ? <span className="bx-pickup-recommended">Recommended</span> : null}
                    </span>
                    {o.address ? (
                      <span className="bx-muted">
                        {o.address}
                        {o.contact_number ? ` · ${o.contact_number}` : ''}
                      </span>
                    ) : null}
                    {o.row ? <span className={short ? 'bx-pickup-stock bx-pickup-stock--short' : 'bx-pickup-stock'}>{pickupStockLine(o.row)}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
          {hint ? (
            <p className="bx-pickup-hint" aria-live="polite">
              {hint}
            </p>
          ) : null}
          <p className="bx-muted">{labels?.ready || 'We’ll call you when it’s ready. Bring your order number.'}</p>
        </div>
      ) : null}
    </section>
  );
}
