'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { releaseHold } from '../client/index.js';
import { holdSecondsOf } from '../core/advance.js';

// Ported from the storefront's use-payment-hold.ts.
//
// The backend holds the order's units for `hold_seconds` (returned by order
// create). The QR timer follows it, ending GRACE_SECONDS early so a payment
// made in the last seconds still lands inside the hold. Measured from when the
// QR opens (not the server clock), so a wrong device clock can't skew it.
//
// The hold is released ONLY when the timer runs out or the shopper confirms
// closing the QR — never on tab switch or page leave, because shoppers pay in
// their banking app while the QR stays open here.
//
// The hold comes from the payment init's answer (every attempt, retries included). When it says
// none (the hold has ended, e.g. a retry after expiry), there is no countdown: the QR stays
// usable, never shows "expired", and nothing is released on a timer.

export const DEFAULT_HOLD_SECONDS = 280; // older backends send no hold time
export const HOLD_GRACE_SECONDS = 20;

/** Seconds the QR stays usable for a given `hold_seconds` (older backends: no hold → 280). */
export const qrSeconds = (holdSeconds: unknown): number => {
  const h = Number(holdSeconds) || 0;
  return h > HOLD_GRACE_SECONDS ? h - HOLD_GRACE_SECONDS : DEFAULT_HOLD_SECONDS;
};

export interface HoldData {
  order_id: string;
  store_id: string;
  transaction: string;
  /** hold left from the init answer; absent / 0 = no countdown */
  hold_seconds?: number | null;
  [k: string]: any;
}

export function usePaymentHold({
  open,
  data,
  check,
  checkEverySeconds,
}: {
  open: boolean;
  data: HoldData | null;
  /** Resolves true once the payment is confirmed. */
  check: () => Promise<boolean>;
  checkEverySeconds: number;
}) {
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const releasedRef = useRef(false);
  const settledRef = useRef(false);
  const checkRef = useRef(check);
  checkRef.current = check;

  useEffect(() => {
    if (!open) return;
    releasedRef.current = false;
    settledRef.current = false;
    const hold = holdSecondsOf(data);
    // the grace keeps a last-second payment inside the hold; a nearly-ended hold shows what's left
    setDeadline(hold == null ? 0 : Date.now() + (hold > HOLD_GRACE_SECONDS ? hold - HOLD_GRACE_SECONDS : hold) * 1000);
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open, data?.transaction, data?.hold_seconds]);

  const timeLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  /** a countdown runs (the init said how long the hold lasts) */
  const timed = deadline > 0;
  const expired = open && timed && timeLeft <= 0;

  const release = useCallback(async () => {
    if (releasedRef.current || settledRef.current) return;
    releasedRef.current = true;
    if (!data?.order_id || !data?.store_id || !data?.transaction) return;
    try {
      await releaseHold({ store_id: data.store_id, order_id: data.order_id, transaction_id: data.transaction });
    } catch {
      // best effort — the hold also expires on its own
    }
  }, [data?.order_id, data?.store_id, data?.transaction]);

  useEffect(() => {
    if (expired) release();
  }, [expired, release]);

  const runCheck = useCallback(async () => {
    if (settledRef.current) return true;
    const ok = await checkRef.current().catch(() => false);
    if (ok) settledRef.current = true;
    return ok;
  }, []);

  // automatic check while the QR is live, and right away on return to the tab
  useEffect(() => {
    if (!open || expired || !data?.transaction) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') runCheck();
    }, checkEverySeconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') runCheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, expired, data?.transaction, checkEverySeconds, runCheck]);

  return { timeLeft, expired, timed, release, settledRef };
}

export function formatTimeLeft(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m < 10 ? `0${m}` : m}:${s < 10 ? `0${s}` : s}`;
}
