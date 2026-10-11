'use client';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { initials } from '../core/format.js';
import { blanxerImageLoader } from '../next/image-loader.js';
import type { CartItem } from '../core/types.js';
import { useCart } from './cart.js';
import { useMoney } from './money.js';
import { Button, cx } from './ui.js';

/** `label|||type|||value` → "label: value" for display. */
const customFieldText = (cf: string) => {
  const [label, type, value] = cf.split('|||');
  return { label: label || '', type: type || '', value: value || '' };
};

export interface CartLinesProps {
  /** Show the per-line checkbox (what checkout orders). Default true. */
  selectable?: boolean;
  /** Quantity +/- and remove. Default true. */
  editable?: boolean;
  /** Product link for a line. Default `/product/<slug>` when the slug is known. */
  productHref?: (line: CartItem) => string | null;
  className?: string;
  empty?: ReactNode;
}

/** The cart lines (image, name, variant, custom fields, price × qty, controls). */
export function CartLines({ selectable = true, editable = true, productHref, className, empty }: CartLinesProps) {
  const cart = useCart();
  const money = useMoney();
  if (!cart.items.length) return <>{empty ?? <p className="bx-muted bx-cart-empty">Your cart is empty.</p>}</>;
  const href = productHref || ((l: CartItem) => (l.slug ? `/product/${l.slug}` : null));

  return (
    <ul className={cx('bx-cart-lines', className)}>
      {cart.items.map((line) => {
        const link = href(line);
        const name = link ? <Link href={link}>{line.product_name}</Link> : line.product_name;
        const unit = line.price + (line.customization_charge || 0);
        return (
          <li key={line.id} className={cx('bx-cart-line', !cart.selectedIds.has(line.id) && 'bx-cart-line--unselected')}>
            {selectable ? (
              <input
                type="checkbox"
                className="bx-cart-select"
                aria-label={`Include ${line.product_name}`}
                checked={cart.selectedIds.has(line.id)}
                onChange={() => cart.toggleSelection(line.id)}
              />
            ) : null}
            <div className="bx-cart-thumb">
              {line.image_url ? (
                <Image loader={blanxerImageLoader} src={line.image_url} alt={line.product_name} width={64} height={64} sizes="64px" />
              ) : (
                <span className="bx-cart-initials">{initials(line.product_name)}</span>
              )}
            </div>
            <div className="bx-cart-info">
              <p className="bx-cart-name">{name}</p>
              {line.variant_name ? <p className="bx-cart-meta">Variant: {line.variant_name}</p> : null}
              {(line.custom_fields || []).filter(Boolean).map((cf) => {
                const f = customFieldText(cf);
                return (
                  <p key={cf} className="bx-cart-meta">
                    {f.label}: {f.type === 'image' ? <a href={f.value} target="_blank" rel="noreferrer">image</a> : f.value}
                  </p>
                );
              })}
              <p className="bx-cart-price">
                {money(line.price)}
                {line.customization_charge ? <span className="bx-cart-meta"> + {money(line.customization_charge)} extra</span> : null} × {line.quantity}
              </p>
              {editable ? (
                <div className="bx-cart-controls">
                  <div className="bx-qty bx-qty--small" role="group" aria-label="Quantity">
                    <button type="button" className="bx-qty-btn" aria-label="Decrease quantity" onClick={() => cart.removeFromCart(line)}>
                      −
                    </button>
                    <span className="bx-qty-value">{line.quantity}</span>
                    <button type="button" className="bx-qty-btn" aria-label="Increase quantity" onClick={() => cart.setQuantity({ ...line, quantity: line.quantity + 1 })}>
                      +
                    </button>
                  </div>
                  <Button variant="ghost" className="bx-cart-remove" onClick={() => cart.removeLine(line.id)}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
            <p className="bx-cart-line-total">{money(unit * line.quantity)}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Full cart page body: lines + selected total + checkout button. */
export function CartView({ checkoutHref = '/checkout', continueHref = '/products', className }: { checkoutHref?: string; continueHref?: string; className?: string }) {
  const cart = useCart();
  const money = useMoney();
  if (!cart.hydrated) return <div className={cx('bx-cart', className)} aria-busy="true" />;
  if (!cart.items.length) {
    return (
      <div className={cx('bx-cart bx-cart--empty', className)}>
        <p>Your cart is empty.</p>
        <Link className="bx-button bx-button--primary" href={continueHref}>
          Continue shopping
        </Link>
      </div>
    );
  }
  const n = cart.selectedItems.length;
  return (
    <div className={cx('bx-cart', className)}>
      <CartLines />
      <div className="bx-cart-footer">
        <p className="bx-cart-total">
          Sub-total ({n} {n === 1 ? 'item' : 'items'}): <strong>{money(cart.selectedTotalPrice)}</strong>
        </p>
        <p className="bx-muted">Delivery and discounts are calculated at checkout.</p>
        {n ? (
          <Link className="bx-button bx-button--primary bx-cart-checkout" href={checkoutHref}>
            Checkout
          </Link>
        ) : (
          <Button disabled>Select items to check out</Button>
        )}
      </div>
    </div>
  );
}
