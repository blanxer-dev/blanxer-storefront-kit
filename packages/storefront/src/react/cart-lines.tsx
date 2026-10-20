'use client';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { initials } from '../core/format.js';
import { blanxerImageLoader } from '../next/image-loader.js';
import type { CartItem } from '../core/types.js';
import { addedLines, isFreeLine, lineOffers, quoteLineFor, type Quote } from '../core/offers.js';
import { useCart } from './cart.js';
import { useMoney } from './money.js';
import { useCartQuote, useOffers } from './offers.js';
import { OfferCodeField, OfferGiftPicker, OfferMessages, OfferProgress, OfferSummary } from './offer-ui.js';
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
  /**
   * Stores on Offers: the cart quote (`useCartQuote`). Lines then show their offers and
   * the server's price, and gift lines the server added are listed with a "Free" label.
   */
  quote?: Quote | null;
}

/** The cart lines (image, name, variant, custom fields, price × qty, controls). */
export function CartLines({ selectable = true, editable = true, productHref, className, empty, quote }: CartLinesProps) {
  const cart = useCart();
  const money = useMoney();
  const offers = useOffers();
  if (!cart.items.length) return <>{empty ?? <p className="bx-muted bx-cart-empty">Your cart is empty.</p>}</>;
  const href = productHref || ((l: CartItem) => (l.slug ? `/product/${l.slug}` : null));

  return (
    <ul className={cx('bx-cart-lines', className)}>
      {cart.items.map((line) => {
        const link = href(line);
        const name = link ? <Link href={link}>{line.product_name}</Link> : line.product_name;
        const unit = line.price + (line.customization_charge || 0);
        // the server's price for this line: full price less its product offers
        const ql = quote && cart.selectedIds.has(line.id) ? quoteLineFor(quote, line) : undefined;
        const lineDeals = lineOffers(quote, ql);
        // a shared offer is split over lines in paisa; lines show whole rupees, totals stay exact
        const lineSaving = Math.round(lineDeals.reduce((t, d) => t + d.amount, 0));
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
              {lineDeals.map((d) => (
                <p key={d.promotion_id} className="bx-offer-line-tag">
                  {d.application!.title} · -{money(Math.round(d.amount))}
                </p>
              ))}
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
            <p className="bx-cart-line-total">
              {lineSaving > 0 ? <s className="bx-cart-line-was">{money(unit * line.quantity)}</s> : null}
              {money(unit * line.quantity - lineSaving)}
            </p>
          </li>
        );
      })}
      {addedLines(quote).map((g) => {
        const app = quote!.applications.find((a) => a.promotion_id === g.added_by);
        const free = isFreeLine(g);
        return (
          <li key={g.key} className="bx-cart-line bx-offer-gift-line">
            {selectable ? <span className="bx-cart-select" aria-hidden="true" /> : null}
            <div className="bx-cart-thumb">
              {g.image_url ? (
                <Image loader={blanxerImageLoader} src={g.image_url} alt={g.name} width={64} height={64} sizes="64px" />
              ) : (
                <span className="bx-cart-initials">{initials(g.name)}</span>
              )}
            </div>
            <div className="bx-cart-info">
              <p className="bx-cart-name">
                {g.qty > 1 ? `${g.qty} × ` : ''}
                {g.name}
              </p>
              {g.variant_name ? <p className="bx-cart-meta">Variant: {g.variant_name}</p> : null}
              <p className="bx-offer-line-tag bx-offer-line-tag--gift">{free ? `Free gift · ${app?.title || ''}` : app?.title || 'Offer'}</p>
              {editable && app?.method === 'automatic' ? (
                <p className="bx-cart-meta">
                  Added for you ·{' '}
                  <button type="button" className="bx-offer-link" onClick={() => offers.removeOffer(g.added_by!)}>
                    Remove
                  </button>
                </p>
              ) : null}
            </div>
            <p className="bx-cart-line-total">
              {g.promo_discount > 0 ? <s className="bx-cart-line-was">{money(g.gross)}</s> : null}
              {free ? <span className="bx-free">Free</span> : money(g.net)}
            </p>
          </li>
        );
      })}
      {editable
        ? offers.removedOffers.map((id) => {
            const o = offers.offers.find((x) => x.id === id);
            if (!o) return null;
            return (
              <li key={`removed_${id}`} className="bx-offer-removed">
                You removed {o.title}.{' '}
                <button type="button" className="bx-offer-link" onClick={() => offers.restoreOffer(id)}>
                  Add it back
                </button>
              </li>
            );
          })
        : null}
    </ul>
  );
}

/** Full cart page body: lines + selected total + checkout button. */
export function CartView({ checkoutHref = '/checkout', continueHref = '/products', className }: { checkoutHref?: string; continueHref?: string; className?: string }) {
  const cart = useCart();
  const money = useMoney();
  const offersOn = useOffers().enabled;
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
  if (offersOn) return <OffersCartView checkoutHref={checkoutHref} className={className} />;
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

/** Cart body for stores on Offers: progress, lines with offers and gifts, messages, code, totals from the quote. */
function OffersCartView({ checkoutHref, className }: { checkoutHref: string; className?: string }) {
  const cart = useCart();
  const money = useMoney();
  const { quote, request, fresh, loading, error } = useCartQuote();
  const n = cart.selectedItems.length;
  const customization = cart.selectedItems.reduce((t, l) => t + (l.customization_charge || 0) * l.quantity, 0);
  const saving = quote ? quote.totals.promo_discount : 0;
  return (
    <div className={cx('bx-cart bx-cart--offers', className)} aria-busy={loading || undefined}>
      <OfferProgress quote={quote} />
      <CartLines quote={quote} />
      <OfferGiftPicker quote={quote} />
      <OfferMessages quote={quote} />
      <div className="bx-cart-footer bx-cart-footer--offers">
        {n ? <OfferCodeField request={request} quote={quote} collapsed /> : null}
        {quote && n ? (
          <OfferSummary quote={quote} customization={customization} className={cx(!fresh && 'bx-offer-summary--updating')} />
        ) : (
          <p className="bx-cart-total">
            Sub-total ({n} {n === 1 ? 'item' : 'items'}): <strong>{money(cart.selectedTotalPrice)}</strong>
          </p>
        )}
        {error && !quote ? <p className="bx-muted">Offers are applied when you place the order.</p> : null}
        {n ? (
          <Link className="bx-button bx-button--primary bx-cart-checkout" href={checkoutHref}>
            Checkout{saving > 0 ? ` · save ${money(saving)}` : ''}
          </Link>
        ) : (
          <Button disabled>Select items to check out</Button>
        )}
      </div>
    </div>
  );
}
