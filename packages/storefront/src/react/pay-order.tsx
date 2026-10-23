'use client';
/**
 * Paying an order that already exists: the first try right after checkout, "Try again" /
 * "Pay another way" after a failed, closed or expired try, and "Pay Rs X" on the tracking page.
 * Every try starts the gateway for the SAME order id (the server never places a second order);
 * the amount is always the init answer's (the advance on an advance order).
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { holdSecondsOf, retryRefused, type PaymentDue } from '../core/advance.js';
import { errorMessage } from '../core/http.js';
import type { PaymentMethod } from '../core/types.js';
import { followPayment, startPayment, type PaymentStart } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { FonepayCheckoutModal, QrPaymentModal, type FonepayCheckoutData, type PaymentUnpaidReason, type QrPaymentData } from './payment-modals.js';
import { Button, cx } from './ui.js';

export const PAYMENT_ERRORS: Record<string, string> = {
  FonePay: 'Fonepay is not available at the moment, please try again later.',
  Esewa: 'Esewa payment is not available at the moment, please try again later.',
  NPX: 'NPX payment is not available at the moment, please try again later.',
  Khalti: 'Khalti payment is not available at the moment, please try again later.',
  nbank_card: 'Nabil card payment is not available at the moment, please try again later.',
  QR: 'QR payment not available at the moment, please try again later.',
  QR_Dynamic: 'QR payment not available at the moment, please try again later.',
  QR_Static: 'QR payment not available at the moment, please try again later.',
  FonepayCheckout: 'Checkout by Fonepay is not available at the moment, please try again later.',
};

export interface UsePayOrderOptions {
  /** the in-page payment landed (the modal then goes to `/payment/success`) */
  onPaid?: () => void;
  /** the gateway answered (QR shown, or about to leave for a redirect / form) */
  onStarted?: (method: string, orderId: string, start: PaymentStart) => void;
  /** the server refused the try: the order is already paid, or was cancelled */
  onRefused?: (kind: 'paid' | 'cancelled', message: string, orderId: string) => void;
  /** an in-page payment was closed or expired unpaid (a "Try again" on the expired QR restarts it here) */
  onUnpaid?: (reason: Exclude<PaymentUnpaidReason, 'retry'>, method: string, orderId: string) => void;
  /** init failed for another reason (after the error toast) */
  onError?: (method: string, orderId: string) => void;
}

/** Start (or restart) the gateway for an order, with the in-page QR modals. Render `modals`. */
export function usePayOrder(opts: UsePayOrderOptions = {}) {
  const { storeId, notify } = useBlanxer();
  const [qr, setQr] = useState<QrPaymentData | null>(null);
  const [fonepay, setFonepay] = useState<FonepayCheckoutData | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<{ method: string; orderId: string } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Resolves 'qr' (modal open), 'left' (redirect / form on its way), or 'failed'. */
  const start = async (method: string, orderId: string, holdSeconds?: number): Promise<'qr' | 'left' | 'failed'> => {
    setBusy(true);
    last.current = { method, orderId };
    try {
      const s = await startPayment(method, { store: storeId, order: orderId, url: window.location.origin });
      optsRef.current.onStarted?.(method, orderId, s);
      // the init's hold wins (every attempt answers what is left); create-order's only for older backends
      const hold = holdSecondsOf(s) ?? holdSecondsOf({ hold_seconds: holdSeconds }) ?? undefined;
      if (s.type === 'qr') {
        setQr({ ...(s as any), order_id: orderId, store_id: storeId, hold_seconds: hold });
        setBusy(false);
        return 'qr';
      }
      if (s.type === 'fonepay_checkout') {
        setFonepay({ ...(s as any), order_id: orderId, store_id: storeId, hold_seconds: hold });
        setBusy(false);
        return 'qr';
      }
      if (s.type === 'none') {
        setBusy(false);
        return 'failed';
      }
      followPayment(s);
      // the page is leaving for the gateway: stay busy
      return 'left';
    } catch (e) {
      setBusy(false);
      const serverMessage = String((e as any)?.body?.message || '');
      const refused = retryRefused(serverMessage);
      if (refused) {
        notify({ type: refused === 'paid' ? 'success' : 'info', title: refused === 'paid' ? 'Already paid' : 'Order cancelled', message: serverMessage });
        optsRef.current.onRefused?.(refused, serverMessage, orderId);
        return 'failed';
      }
      const msg = method === 'Khalti' ? errorMessage(e, PAYMENT_ERRORS.Khalti) : PAYMENT_ERRORS[method] || errorMessage(e);
      notify({ type: 'error', title: 'Error', message: msg });
      optsRef.current.onError?.(method, orderId);
      return 'failed';
    }
  };

  const unpaid = (reason: PaymentUnpaidReason) => {
    const l = last.current;
    if (!l) return;
    if (reason === 'retry') void start(l.method, l.orderId);
    else optsRef.current.onUnpaid?.(reason, l.method, l.orderId);
  };

  const modals = (
    <>
      <QrPaymentModal open={!!qr} data={qr} onClose={() => setQr(null)} onSuccess={() => optsRef.current.onPaid?.()} onUnpaid={unpaid} />
      <FonepayCheckoutModal open={!!fonepay} data={fonepay} onClose={() => setFonepay(null)} onSuccess={() => optsRef.current.onPaid?.()} onUnpaid={unpaid} />
    </>
  );

  return { start, busy, open: !!qr || !!fonepay, modals };
}

export interface PaymentDueBoxProps {
  /** what is still to pay online (`paymentDue(order)` / `pendingDue(pending)`) */
  due: PaymentDue;
  /** the store's online methods (`paymentMethodsFor(store, { codAllowed: false })`) */
  methods: PaymentMethod[];
  onPay: (method: string) => void;
  busy?: boolean;
  /** heading; default "Advance due — Pay Rs X" / "Payment not received — Pay Rs X" (then shown under it) */
  title?: string;
  /** the method of the try that didn't finish: the button reads "Try again" while it is picked */
  retryMethod?: string;
  className?: string;
  /** more actions under the button */
  children?: ReactNode;
}

/** "Advance due — Pay Rs 150" with the store's online methods as radios and a pay button. */
export function PaymentDueBox({ due, methods, onPay, busy, title, retryMethod, className, children }: PaymentDueBoxProps) {
  const money = useMoney();
  const id = useId();
  const names = methods.map((m) => m.name as string);
  const initial = (due.via && names.includes(due.via) ? due.via : '') || (retryMethod && names.includes(retryMethod) ? retryMethod : '') || names[0] || '';
  const [picked, setPicked] = useState(initial);
  const method = names.includes(picked) ? picked : initial;
  const amount = due.amount > 0 ? money(due.amount) : '';
  const heading = due.advance ? `Advance due — Pay ${amount}` : amount ? `Payment not received — Pay ${amount}` : 'Payment not received';
  const sub = [due.on_delivery != null ? `${money(due.on_delivery)} cash on delivery` : '', due.order_number ? `order #${due.order_number}` : '']
    .filter(Boolean)
    .join(' · ');
  const label = due.advance ? 'Pay the advance with' : 'Pay with';
  const button = retryMethod && method === retryMethod ? 'Try again' : amount ? `Pay ${amount}` : 'Pay now';
  return (
    <section className={cx('bx-advance-due', className)} aria-labelledby={`${id}-title`} data-bx="payment-due">
      <h2 className="bx-advance-due-title" id={`${id}-title`}>
        {title || heading}
      </h2>
      {title ? <p className="bx-strong bx-advance-due-amount">{heading}</p> : null}
      {sub ? <p className="bx-muted bx-advance-due-sub">{sub}</p> : null}
      {names.length ? (
        <>
          <p className="bx-advance-label" id={`${id}-label`}>
            {label}
          </p>
          <div className="bx-payment-methods bx-advance-methods" role="radiogroup" aria-labelledby={`${id}-label`}>
            {methods.map((m) => (
              <label key={m.name} className={cx('bx-payment-method', 'bx-advance-method', method === m.name && 'bx-payment-method--active')} data-method={m.name}>
                <input type="radio" name={`${id}-method`} value={m.name} checked={method === m.name} onChange={() => setPicked(m.name)} />
                <span className="bx-payment-name">{m.display_name}</span>
              </label>
            ))}
          </div>
          <Button className="bx-advance-pay" loading={busy} disabled={!method} onClick={() => onPay(method)}>
            {button}
          </Button>
        </>
      ) : (
        <p className="bx-muted">No online payment is available right now.</p>
      )}
      {children}
    </section>
  );
}
