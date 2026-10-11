'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { STORAGE_KEYS } from '../core/config.js';
import { validation } from '../core/validation.js';
import type { Product } from '../core/types.js';
import { requestStockAlert } from '../client/index.js';
import { useBlanxer } from './context.js';
import { Button, Modal, TextInput, cx } from './ui.js';

const alertKey = (productId: string, variantId?: string) => `${productId}:${variantId || ''}`;
const readAlerts = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.stockAlerts);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const rememberAlert = (key: string) => {
  try {
    const set = new Set(readAlerts());
    set.add(key);
    localStorage.setItem(STORAGE_KEYS.stockAlerts, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
};

export interface StockAlertFormProps {
  product: Pick<Product, '_id' | 'name'>;
  variantId?: string;
  className?: string;
}

/** "Notify me when available" for out-of-stock products (phone and/or email, no login). */
export function StockAlertForm({ product, variantId, className }: StockAlertFormProps) {
  const { storeId, notify } = useBlanxer();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const key = alertKey(product._id, variantId);

  useEffect(() => setSubscribed(readAlerts().includes(key)), [key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!phone && !email) return notify({ type: 'error', title: 'Error', message: 'Enter a phone number or an email address.' });
    if (email && validation.email(email)) return notify({ type: 'error', title: 'Error', message: 'Enter a valid email address.' });
    if (phone && validation.phone(phone)) return notify({ type: 'error', title: 'Error', message: 'Enter a valid 10-digit phone number.' });
    setLoading(true);
    try {
      const res = await requestStockAlert({
        store: storeId,
        product: product._id,
        variant_id: variantId || '',
        phone: phone || undefined,
        email: email || undefined,
        product_name: product.name,
        // no query string / hash in the stored link
        product_url: window.location.origin + window.location.pathname,
      });
      notify({ type: 'success', title: 'Subscribed', message: res?.message || 'We will notify you when this is back in stock.' });
      rememberAlert(key);
      setSubscribed(true);
      setOpen(false);
    } catch {
      notify({ type: 'error', title: 'Error', message: 'Could not subscribe. Please try again.' });
    }
    setLoading(false);
  };

  return (
    <div className={cx('bx-stock-alert', className)}>
      <Button variant="secondary" className={cx('bx-stock-alert-button', subscribed && 'bx-stock-alert-button--done')} onClick={() => setOpen(true)}>
        {subscribed ? "You'll be notified" : 'Notify me when available'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notify me when available" dismissible>
        <form onSubmit={submit} className="bx-stack">
          <p className="bx-muted">{product.name}</p>
          <p className="bx-muted">We&apos;ll let you know as soon as this is back in stock. Enter your phone number, email, or both.</p>
          <TextInput label="Phone number" type="tel" inputMode="numeric" value={phone} disabled={loading} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
          <TextInput label="Email address" type="email" value={email} disabled={loading} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <Button type="submit" loading={loading}>
            Notify me
          </Button>
        </form>
      </Modal>
    </div>
  );
}
