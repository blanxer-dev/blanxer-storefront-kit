'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { STORAGE_KEYS } from '../core/config.js';
import { failedOrderId } from '../core/advance.js';
import { clearPendingOrder, firePurchase, readPendingOrder, takePendingPurchase } from '../client/index.js';
import { useOptionalCart } from './cart.js';
import { cx } from './ui.js';

/** Remove lines from the stored cart when the page has no cart provider. */
const removeStoredLines = (ids: string[]) => {
  try {
    const items = JSON.parse(localStorage.getItem(STORAGE_KEYS.cart) || '[]');
    if (!Array.isArray(items)) return;
    const drop = new Set(ids);
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(items.filter((el: any) => !drop.has(el?.id))));
  } catch {
    /* storage blocked */
  }
};

/**
 * `/payment/success`. Gateways (and the QR modals) land here after a paid
 * order. Fires the Meta Purchase saved at checkout (same event id as the
 * server event), removes the paid order's lines from the cart (kept until now), then sends the
 * shopper to `/track/<order>?from=checkout` (or home when there is no pending order).
 */
export function PaymentSuccess({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  const cart = useOptionalCart();
  const ready = !cart || cart.hydrated;
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    let orderId: string | null = null;
    try {
      orderId = sessionStorage.getItem(STORAGE_KEYS.checkoutOrderId);
      sessionStorage.removeItem(STORAGE_KEYS.checkoutOrderId);
      // the order waiting for this payment: its lines leave the cart now
      const waiting = readPendingOrder();
      if (waiting && (!orderId || waiting.order_id === orderId)) {
        if (cart) cart.removeLines(waiting.lines);
        else removeStoredLines(waiting.lines);
        clearPendingOrder();
        orderId = orderId || waiting.order_id;
      }
      // read once, so a refresh doesn't fire it again; the server already
      // sent its Purchase (same id) when the payment was verified
      const pending = takePendingPurchase();
      if (pending) firePurchase(pending);
    } catch {
      /* storage blocked */
    }
    router.replace(orderId ? `/track/${orderId}?from=checkout` : '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, ready]);

  return (
    <div className={cx('bx-result bx-result--success', className)} aria-busy="true">
      {children ?? (
        <>
          <p className="bx-result-title">Payment successful</p>
          <p className="bx-muted">Taking you to your order…</p>
        </>
      )}
    </div>
  );
}

/**
 * `/payment/failed`. Pass `method` (from `?method=`) to show the card-specific reasons. When this
 * tab placed the order, the main action is "Try payment again" (the order's tracking page, which
 * pays the same order); "Shop More" stays as the second one.
 */
export function PaymentFailed({
  method,
  order,
  homeHref = '/',
  trackHref = (id: string) => `/track/${encodeURIComponent(id)}`,
  className,
}: {
  method?: string;
  /** the order the gateway sent back (`?order=`); read from the URL when not given */
  order?: string;
  homeHref?: string;
  /** the tracking page of an order (default `/track/<id>`) */
  trackHref?: (orderId: string) => string;
  className?: string;
}) {
  const [orderId, setOrderId] = useState<string | null>(null);
  useEffect(() => {
    let id: string | null = null;
    try {
      // this tab's waiting order, else the one the gateway sent back (`?order=`, an eSewa cancel)
      id = failedOrderId(
        [readPendingOrder()?.order_id, sessionStorage.getItem(STORAGE_KEYS.checkoutOrderId)],
        order ?? new URLSearchParams(window.location.search).get('order'),
      );
    } catch {
      id = null;
    }
    setOrderId(id);
    // no order to pay again: the payment didn't go through, no Purchase for it later
    // (with one, the Purchase waits for the retry's /payment/success)
    if (!id) takePendingPurchase();
  }, []);
  const isCard = method === 'card';
  return (
    <div className={cx('bx-result bx-result--failed', className)}>
      <p className="bx-result-title">{isCard ? 'Transaction Failed' : 'Payment for your order failed'}</p>
      {isCard ? (
        <div className="bx-result-body">
          <p>Sorry! We could not process your transaction. Below are possible reasons of failure</p>
          <ul>
            <li>You might have entered wrong card number, expiry date or CVV code.</li>
            <li>You might have entered wrong OTP / Verification code.</li>
            <li>Your card issuing bank might have declined the card processing. Please ask your bank to enable “Online Transaction” on your card.</li>
            <li>If you think everything is fine then please try again.</li>
          </ul>
        </div>
      ) : (
        <p className="bx-result-body">However, you might receive call/sms soon for confirmation</p>
      )}
      {orderId ? (
        <div className="bx-result-actions">
          <Link className="bx-button bx-button--primary" href={trackHref(orderId)}>
            Try payment again
          </Link>
          <Link className="bx-button bx-button--secondary" href={homeHref}>
            Shop More
          </Link>
        </div>
      ) : (
        <Link className="bx-button bx-button--primary" href={homeHref}>
          Shop More
        </Link>
      )}
    </div>
  );
}
