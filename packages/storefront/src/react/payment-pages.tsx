'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { STORAGE_KEYS } from '../core/config.js';
import { trackEvent } from '../client/index.js';
import { cx } from './ui.js';

/**
 * `/payment/success`. Gateways (and the QR modals) land here after a paid
 * order. Fires the Meta Purchase saved at checkout (same event id as the
 * server event), then sends the shopper to `/track/<order>?from=checkout`
 * (or home when there is no pending order).
 */
export function PaymentSuccess({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    let orderId: string | null = null;
    try {
      orderId = sessionStorage.getItem(STORAGE_KEYS.checkoutOrderId);
      sessionStorage.removeItem(STORAGE_KEYS.checkoutOrderId);
      const raw = sessionStorage.getItem(STORAGE_KEYS.pixelPurchasePending);
      if (raw) {
        const { event_id, email, phone, ...custom } = JSON.parse(raw);
        trackEvent('Purchase', custom, { eventId: event_id, email, phone });
        sessionStorage.removeItem(STORAGE_KEYS.pixelPurchasePending);
      }
    } catch {
      /* storage blocked */
    }
    router.replace(orderId ? `/track/${orderId}?from=checkout` : '/');
  }, [router]);

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

/** `/payment/failed`. Pass `method` (from `?method=`) to show the card-specific reasons. */
export function PaymentFailed({ method, homeHref = '/', className }: { method?: string; homeHref?: string; className?: string }) {
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
      <Link className="bx-button bx-button--primary" href={homeHref}>
        Shop More
      </Link>
    </div>
  );
}
