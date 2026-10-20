'use client';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { initials } from '../core/format.js';
import { orderLineFree, orderOfferSummary } from '../core/offers.js';
import { fieldError, errorMessage } from '../core/http.js';
import { validation } from '../core/validation.js';
import { blanxerImageLoader } from '../next/image-loader.js';
import { cancelOrder, getOrder, submitReview } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { Button, Modal, TextArea, TextInput, cx } from './ui.js';

/** Group lines of the same product for the review list (variants joined). */
const groupByProduct = (items: any[]) => {
  const grouped: Record<string, any> = {};
  for (const item of items) {
    const key = item.product_id;
    if (!key) continue;
    if (!grouped[key]) grouped[key] = { ...item, variant_names: item.variant_name ? [item.variant_name] : [] };
    else {
      if (item.variant_name) grouped[key].variant_names.push(item.variant_name);
      grouped[key].quantity += item.quantity;
    }
  }
  return Object.values(grouped).map((it: any) => ({ ...it, variant_name: it.variant_names.join(', ') }));
};

const maskedPhone = (p?: string) => `ending with ${String(p || '').replace(/^(\d{7})/, '_______')}`;

function Thumb({ src, name }: { src?: string; name?: string }) {
  if (!src) return <span className="bx-cart-initials">{initials(name)}</span>;
  return <Image loader={blanxerImageLoader} src={src} alt={name || ''} width={54} height={54} sizes="54px" />;
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="bx-stars" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={cx('bx-star', n <= value && 'bx-star--on')} onClick={() => onChange(n)}>
            ★
          </button>
        ) : (
          <span key={n} className={cx('bx-star', n <= value && 'bx-star--on')} aria-hidden="true">
            ★
          </span>
        ),
      )}
    </div>
  );
}

function ReviewModal({ open, onClose, product, order, onDone }: { open: boolean; onClose: () => void; product: any; order: any; onDone: () => void }) {
  const { storeId, notify } = useBlanxer();
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const close = () => {
    setRating(5);
    setReview('');
    setPhone('');
    setErrors({});
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = { review: validation.required(review) || '', phone_number: validation.required(phone) || '' };
    setErrors(v);
    if (v.review || v.phone_number) return;
    setLoading(true);
    try {
      const res = await submitReview({ store_id: storeId, product_id: product?.product_id, order_id: order?._id, rating, review, phone_number: phone });
      notify({ type: 'success', title: 'Success', message: res?.message || 'Thanks for your review' });
      close();
      onDone();
    } catch (err) {
      setErrors({ review: fieldError(err, 'review'), phone_number: fieldError(err, 'phone_number') });
      const msg = (err as any)?.body?.message;
      if (msg) notify({ type: 'error', title: 'Error', message: msg });
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={close} title="Review Product">
      <form onSubmit={submit} className="bx-stack">
        <div className="bx-review-product">
          <p className="bx-strong">{product?.product_name}</p>
          {product?.variant_name ? <p className="bx-muted">Variant: {product.variant_name}</p> : null}
        </div>
        <div>
          <p className="bx-label">Your Rating</p>
          <Stars value={rating} onChange={(v) => setRating(Math.max(v, 1))} />
        </div>
        <TextArea label="Review" required placeholder="eg: very nice product and packaging" value={review} onChange={(e) => setReview(e.target.value)} error={errors.review} />
        <TextInput label="Phone number (used to create order)" type="tel" required placeholder={maskedPhone(order?.customer_phone_number)} value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone_number} />
        <Button type="submit" loading={loading}>
          Submit Review
        </Button>
      </form>
    </Modal>
  );
}

function CancelModal({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: any; onDone: () => void }) {
  const { storeId, notify } = useBlanxer();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const close = () => {
    setPhone('');
    setError('');
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validation.required(phone);
    if (v) return setError(v);
    setLoading(true);
    try {
      const res = await cancelOrder({ store_id: storeId, order_id: order?._id, phone_number: phone });
      notify({ type: 'success', title: 'Success', message: res?.message || 'Order cancelled' });
      close();
      onDone();
    } catch (err) {
      setError(fieldError(err, 'phone_number') || errorMessage(err));
    }
    setLoading(false);
  };
  return (
    <Modal open={open} onClose={close} title="Cancel Order">
      <form onSubmit={submit} className="bx-stack">
        <p className="bx-muted">Are you sure you want to cancel this order? This action cannot be undone.</p>
        <TextInput label="Phone number (used to create order)" type="tel" required placeholder={maskedPhone(order?.customer_phone_number)} value={phone} onChange={(e) => setPhone(e.target.value)} error={error} />
        <div className="bx-row">
          <Button variant="secondary" onClick={close}>
            Go Back
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            Cancel Order
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface OrderTrackingProps {
  orderId: string;
  /** True when arriving from checkout (`?from=checkout`): shows the "order placed" banner. */
  fromCheckout?: boolean;
  className?: string;
}

/** `/track/[id]`: order status, lines, totals, cancel (by phone) and per-product reviews once delivered. */
export function OrderTracking({ orderId, fromCheckout, className }: OrderTrackingProps) {
  const { store, storeId } = useBlanxer();
  const money = useMoney();
  const [order, setOrder] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [reviewing, setReviewing] = useState<any>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getOrder(storeId, orderId);
      if (!res?._id) throw new Error('missing');
      setOrder(res);
      setState('ready');
    } catch {
      setState('missing');
    }
  }, [storeId, orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(
    () => (order ? (order.product_total_price || 0) + (order.delivery_charge || 0) + (order.customization_total || 0) - (order.discount?.d_value || 0) : 0),
    [order],
  );

  if (state === 'loading') return <div className={cx('bx-track', className)} aria-busy="true"><p className="bx-muted">Loading your order…</p></div>;
  if (state === 'missing') {
    return (
      <div className={cx('bx-track bx-track--missing', className)}>
        <h1 className="bx-track-title">Order not found</h1>
        <p className="bx-muted">Check the link from your SMS or email.</p>
        <Link className="bx-button bx-button--primary" href="/">
          Go to home
        </Link>
      </div>
    );
  }

  // orders priced by Offers: one row per offer, free units, waived delivery (older orders: null)
  const offerSummary = orderOfferSummary(order);
  const reviewEligible = order.status === 'Delivered';
  const cancelEligible = ['Pending', 'Processing'].includes(order.status) && !!store?.checkout?.extras?.allow_customer_cancellation;
  const reviewProducts = groupByProduct(order.ordered_products || []);
  const statusClass = (s: string) => `bx-badge bx-badge--${String(s || '').toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className={cx('bx-track', className)} data-bx="track">
      {fromCheckout ? (
        <div className="bx-notice bx-notice--success">
          <p className="bx-strong">Congratulations! Your order has been placed successfully!</p>
          <p>Thank you for your purchase. You will receive a confirmation SMS or call soon.</p>
        </div>
      ) : null}
      <h1 className="bx-track-title">Track Your Order</h1>
      <dl className="bx-track-meta">
        <div>
          <dt>Customer</dt>
          <dd>
            {order.customer_full_name} <span className="bx-muted">({order.customer_phone_number})</span>
          </dd>
        </div>
        {order.order_number ? (
          <div>
            <dt>Order</dt>
            <dd>#{order.order_number}</dd>
          </div>
        ) : null}
        <div>
          <dt>Order Status</dt>
          <dd>
            <span className={statusClass(order.status)}>{order.status}</span> &amp; <span className={statusClass(order.payment_status)}>{order.payment_status}</span>
          </dd>
        </div>
      </dl>

      <section className="bx-track-card">
        <h2 className="bx-section-title">Order Summary</h2>
        <ul className="bx-cart-lines">
          {(order.ordered_products || []).map((el: any, i: number) => {
            const free = orderLineFree(el);
            const gross = (el.price + (el.customization_charge || 0)) * el.quantity;
            return (
            <li key={el._id || `${el.product_id}_${i}`} className={cx('bx-cart-line', free.allFree && 'bx-offer-gift-line')}>
              <div className="bx-cart-thumb">
                <Thumb src={el.image_url} name={el.product_name} />
              </div>
              <div className="bx-cart-info">
                <p className="bx-cart-name">{el.product_name}</p>
                {el.variant_name ? <p className="bx-cart-meta">Variant: {el.variant_name}</p> : null}
                {el.print?.name ? <p className="bx-cart-meta">Print: {el.print.name}</p> : null}
                {el.sku ? <p className="bx-cart-meta">SKU: {el.sku}</p> : null}
                <p className="bx-cart-price">
                  {money(el.price)} × {el.quantity}
                </p>
                {el.customization_charge ? <p className="bx-cart-meta">+ {money(el.customization_charge)} extra charge</p> : null}
                {free.free > 0 && !free.allFree ? <p className="bx-offer-line-tag">{free.free} free</p> : null}
              </div>
              <p className="bx-cart-line-total">
                {free.allFree ? (
                  <>
                    <s className="bx-cart-line-was">{money(gross)}</s>
                    <span className="bx-free">Free</span>
                  </>
                ) : (
                  money(gross)
                )}
              </p>
            </li>
            );
          })}
        </ul>
        <dl className="bx-totals">
          <div className="bx-total-row">
            <dt>Sub-total</dt>
            <dd>{money(order.product_total_price || 0)}</dd>
          </div>
          {offerSummary ? (
            <>
              {offerSummary.rows.map((r) => (
                <div key={r.promotion_id} className="bx-total-row bx-total-row--discount" data-offer-kind={r.kind}>
                  <dt>{r.label}</dt>
                  <dd>({money(r.amount)})</dd>
                </div>
              ))}
              {offerSummary.other > 0 ? (
                <div className="bx-total-row bx-total-row--discount">
                  <dt>Discount</dt>
                  <dd>({money(offerSummary.other)})</dd>
                </div>
              ) : null}
            </>
          ) : order.discount?.d_value ? (
            <div className="bx-total-row bx-total-row--discount">
              <dt>Discount {order.discount.code ? `[${order.discount.code}]` : ''}</dt>
              <dd>({money(order.discount.d_value)})</dd>
            </div>
          ) : null}
          <div className="bx-total-row">
            <dt>Delivery Charge</dt>
            <dd>
              {offerSummary?.delivery.waived ? (
                <>
                  <s className="bx-muted">{money(offerSummary.delivery.before || 0)}</s>{' '}
                </>
              ) : null}
              {order.delivery_charge ? money(order.delivery_charge) : <span className="bx-free">FREE</span>}
            </dd>
          </div>
          {order.customization_total ? (
            <div className="bx-total-row">
              <dt>Extra Charges</dt>
              <dd>{money(order.customization_total)}</dd>
            </div>
          ) : null}
          <div className="bx-total-row bx-total-row--grand">
            <dt>Total</dt>
            <dd>{money(total)}</dd>
          </div>
          {order.partial_payment_amount > 0 ? (
            <>
              <div className="bx-total-row">
                <dt>Partial Payment</dt>
                <dd>({money(order.partial_payment_amount)})</dd>
              </div>
              <div className="bx-total-row">
                <dt>Cash on Delivery</dt>
                <dd>{money(total - order.partial_payment_amount)}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {cancelEligible ? (
          <Button variant="danger" className="bx-cancel-order" onClick={() => setCancelling(true)}>
            Cancel Order
          </Button>
        ) : null}
      </section>

      <section className="bx-track-reviews">
        <h2 className="bx-section-title">Reviews</h2>
        {reviewEligible ? (
          <ul className="bx-cart-lines">
            {reviewProducts.map((el: any) => {
              const received = order.review?.received?.includes(el.product_id);
              const review = received ? (order.reviews || []).find((r: any) => r.product == el.product_id) : null;
              return (
                <li key={el._id} className="bx-cart-line">
                  <div className="bx-cart-thumb">
                    <Thumb src={el.image_url} name={el.product_name} />
                  </div>
                  <div className="bx-cart-info">
                    <p className="bx-cart-name">{el.product_name}</p>
                    {el.variant_name ? <p className="bx-cart-meta">Variant: {el.variant_name}</p> : null}
                    {received ? <p className="bx-cart-meta">Review: {review?.review}</p> : null}
                  </div>
                  {received ? (
                    <Stars value={Number(review?.rating) || 0} />
                  ) : (
                    <Button variant="secondary" onClick={() => setReviewing(el)}>
                      Review Product
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bx-muted">You can review this order only after it&apos;s delivered; currently it is not eligible for review.</p>
        )}
      </section>

      <ReviewModal open={!!reviewing} product={reviewing} order={order} onClose={() => setReviewing(null)} onDone={load} />
      <CancelModal open={cancelling} order={order} onClose={() => setCancelling(false)} onDone={load} />
    </div>
  );
}
