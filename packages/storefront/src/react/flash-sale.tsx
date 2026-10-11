'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FlashSaleForProduct } from '../core/types.js';
import { errorMessage, getFlashSaleForProduct, notifyFlashSale } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { Button, cx } from './ui.js';

const REFRESH_LIVE_MS = 15_000;
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** `1d 02:03:04` style countdown. */
export const formatCountdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d ? `${d}d ` : ''}${h || d ? `${pad(h)}:` : ''}${pad(m)}:${pad(sec)}`;
};

export interface FlashSaleStripProps {
  productId: string;
  productName?: string;
  /** Called with `{ max_per_order }` while a sale with a cap is live, else null. */
  onRules?: (rules: { max_per_order: number } | null) => void;
  className?: string;
}

/**
 * Flash-sale strip for a product page (storefront FlashSaleBox): live →
 * countdown to the end, units left, max per order; upcoming → countdown to the
 * start, sale price, "Notify me". Reloads data when the sale starts or ends.
 */
export function FlashSaleStrip({ productId, productName, onRules, className }: FlashSaleStripProps) {
  const { storeId, notify } = useBlanxer();
  const money = useMoney();
  const router = useRouter();
  const [data, setData] = useState<FlashSaleForProduct | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const load = useCallback(async () => {
    if (!storeId || !productId) return;
    try {
      const res = await getFlashSaleForProduct(storeId, productId);
      if (res?.server_time) offset.current = new Date(res.server_time).getTime() - Date.now();
      setData(res);
    } catch {
      setData(null);
    }
  }, [storeId, productId]);

  useEffect(() => {
    load();
  }, [load]);

  const sale = data?.sale || null;
  const live = sale?.status === 'live';

  useEffect(() => {
    onRules?.(live && sale?.max_per_order ? { max_per_order: sale.max_per_order } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, sale?.max_per_order]);

  useEffect(() => {
    if (!sale) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    const r = live ? window.setInterval(load, REFRESH_LIVE_MS) : undefined;
    return () => {
      window.clearInterval(t);
      if (r) window.clearInterval(r);
    };
  }, [sale, live, load]);

  const target = sale ? new Date(live ? sale.end_at : sale.start_at).getTime() : 0;
  const msLeft = target - (now + offset.current);

  // The sale started or ended: give the backend a moment, then refresh prices.
  const flipped = useRef(false);
  useEffect(() => {
    if (!sale || msLeft > 0 || flipped.current) return;
    flipped.current = true;
    const t = window.setTimeout(() => {
      router.refresh();
      load();
    }, 20_000);
    return () => window.clearTimeout(t);
  }, [sale, msLeft, router, load]);

  if (!sale) return null;

  const subscribe = async () => {
    const value = contact.trim();
    const isPhone = /^\d{10}$/.test(value);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!isPhone && !isEmail) {
      notify({ type: 'error', title: 'Notify me', message: 'Enter a 10-digit phone number or an email' });
      return;
    }
    setSending(true);
    try {
      await notifyFlashSale(storeId, {
        campaign_id: sale._id,
        product_id: productId,
        product_name: productName,
        url: window.location.href,
        ...(isPhone ? { phone: value } : { email: value }),
      });
      setSubscribed(true);
    } catch (e) {
      notify({ type: 'error', title: 'Notify me', message: errorMessage(e, 'Could not save. Please try again.') });
    }
    setSending(false);
  };

  const units = data?.units;
  const allInCheckout = live && !!units && units.available <= 0 && units.in_checkout > 0;
  const soldOut = live && (sale.sold_out || (!!units && units.available <= 0 && units.in_checkout <= 0));

  return (
    <div className={cx('bx-flash', live ? 'bx-flash--live' : 'bx-flash--upcoming', className)}>
      <div className="bx-flash-head">
        <p className="bx-flash-title">{live ? 'Flash sale' : 'Flash sale coming'}</p>
        {sale.show_countdown && msLeft > 0 ? (
          <p className="bx-flash-countdown">
            {live ? 'Ends in' : 'Starts in'} <strong>{formatCountdown(msLeft)}</strong>
          </p>
        ) : null}
      </div>
      {live ? (
        <div className="bx-flash-body">
          {soldOut ? (
            <p className="bx-flash-soldout">Sold out</p>
          ) : allInCheckout ? (
            <p>
              All remaining units are in other shoppers&apos; checkouts. If they don&apos;t pay, they come back in a few
              minutes — check again soon.
            </p>
          ) : sale.show_stock_left && units ? (
            <p>
              Only {units.available} left{units.in_checkout > 0 ? ` · ${units.in_checkout} in checkout` : ''}
            </p>
          ) : null}
          {sale.max_per_order ? <p className="bx-flash-max">Max {sale.max_per_order} per order</p> : null}
        </div>
      ) : (
        <div className="bx-flash-body">
          {sale.offer_price_from ? <p>Sale price from {money(sale.offer_price_from)}</p> : null}
          {subscribed ? (
            <p className="bx-flash-subscribed">We&apos;ll let you know when it starts.</p>
          ) : (
            <div className="bx-flash-notify">
              <input
                className="bx-input"
                placeholder="Phone or email"
                aria-label="Phone or email"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && subscribe()}
              />
              <Button loading={sending} onClick={subscribe}>
                Notify me
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
