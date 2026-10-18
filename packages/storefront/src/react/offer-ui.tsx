'use client';
/**
 * Offer components: badges, product-page blocks (tier table, notes, bundle), cart progress,
 * upsell messages, the code field, the totals with offer rows, and the Offers page list.
 * Each one shows what the server says (the quote, the public offer rules) and respects the
 * store's display settings. Restyle with the `bx-offer-*` classes; or build your own from
 * `useOffers`, `useCartQuote` and the helpers in `@blanxer-dev/storefront/core`.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { blanxerImageLoader } from '../next/image-loader.js';
import {
  badgeColor,
  bundleText,
  cartMilestones,
  milestoneBar,
  normalizeCode,
  offerConditionsText,
  offerGroup,
  offerHeadline,
  offersPageLists,
  offerTagline,
  productBadges,
  productHint,
  quoteSavings,
  shortDate,
  summaryRows,
  tierRows,
  topBarOffers,
  upsellMessages,
  type BadgeTone,
  type OfferGroup,
  type OfferProductRef,
  type PublicOffer,
  type Quote,
  type QuoteRequest,
} from '../core/offers.js';
import { errorMessage } from '../core/http.js';
import { isOutOfStock } from '../core/variants.js';
import { ensureNumber } from '../core/format.js';
import type { CartItem, Product, ProductVariant } from '../core/types.js';
import { getProductPublic, quoteCart } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useCart } from './cart.js';
import { useMoney } from './money.js';
import { formatCountdown } from './flash-sale.js';
import { useCartQuote, useOfferClock, useOffers, useProductOffers } from './offers.js';
import { Button, cx } from './ui.js';

const toneVar = (tone: BadgeTone, colors: Record<string, string>) => ({ ['--bx-offer-tone' as any]: badgeColor(colors[tone]) });

// ---------------------------------------------------------------- badges and hints

export interface OfferBadgesProps {
  /** id, price, categories (ids or names) and variant ids are enough */
  product: OfferProductRef;
  max?: number;
  className?: string;
}

/** Offer badges for a product card or gallery (absolutely positioned in the corner the store picked). */
export function OfferBadges({ product, max = 2, className }: OfferBadgesProps) {
  const { store } = useBlanxer();
  const { enabled, offers, display } = useOffers();
  const badges = useMemo(
    () => (enabled ? productBadges(product, offers, display, store?.categories || [], max) : []),
    [enabled, offers, display, product, store?.categories, max],
  );
  if (!badges.length) return null;
  return (
    <div className={cx('bx-offer-badges', `bx-offer-badges--${display.badge_corner}`, className)}>
      {badges.map((b) => (
        <span key={b.offer_id} className={cx('bx-offer-badge', `bx-offer-badge--${display.badge_style}`, `bx-offer-badge--${b.tone}`)} style={toneVar(b.tone, display.colors)}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

/** One line under a card's price ("Buy 3, save 15%", "Free with orders over Rs 5,000"). */
export function OfferCardHint({ product, className }: { product: OfferProductRef; className?: string }) {
  const { store } = useBlanxer();
  const { enabled, offers, display } = useOffers();
  const hint = useMemo(() => (enabled && display.badges ? productHint(product, offers, store?.categories || []) : null), [enabled, display.badges, offers, product, store?.categories]);
  if (!hint) return null;
  return (
    <p className={cx('bx-offer-hint', `bx-offer-hint--${hint.tone}`, hint.upcoming && 'bx-offer-hint--upcoming', className)} style={toneVar(hint.tone, display.colors)}>
      {hint.text}
    </p>
  );
}

/** Store top bar with the offers that ask for it (setting "Top bar" on). Rotates every 5 s. */
export function OfferTopBar({ className, href = '/offers' }: { className?: string; href?: string | null }) {
  const { enabled, offers, display } = useOffers();
  const items = useMemo(() => (enabled ? topBarOffers(offers, display) : []), [enabled, offers, display]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % items.length), 5000);
    return () => window.clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  const o = items[i % items.length]!;
  const text = (
    <>
      <strong>{o.title}</strong>
      {o.code ? (
        <>
          {' '}
          with code <strong>{o.code}</strong>
        </>
      ) : null}
    </>
  );
  return (
    <div className={cx('bx-offer-topbar', className)} aria-live="polite">
      {href && display.offers_page ? <Link href={href}>{text}</Link> : text}
      {items.length > 1 ? (
        <span className="bx-offer-topbar-count">
          {(i % items.length) + 1} / {items.length}
        </span>
      ) : null}
    </div>
  );
}

/** A nav link to the Offers page, rendered only when the store is on Offers with the page on. */
export function OffersLink({ href = '/offers', className, children = 'Offers' }: { href?: string; className?: string; children?: ReactNode }) {
  const { enabled, display, offers } = useOffers();
  if (!enabled || !display.offers_page || !offers.length) return null;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- product page

/** "Mix any Kurtas", "These products", "Any product" for a tier offer's scope. */
const scopeLabel = (o: PublicOffer, categories: Array<{ _id: string; name: string }>) => {
  const s = o.tiers?.scope;
  if (!s || s.type === 'all') return 'Any product';
  if (o.tiers?.per_product) return 'Per product';
  if (s.type === 'categories') {
    const names = (s.categories || []).map((id) => categories.find((c) => String(c._id) === String(id))?.name).filter(Boolean);
    return names.length ? `Mix any ${names.join(', ')}` : 'Mix and match';
  }
  return (s.products || []).length > 1 ? 'Mix these products' : 'This product';
};

/** Tier table for a "buy more, save more" offer. The active tier and the saving come from the cart quote. */
export function OfferTierTable({ offer, className }: { offer: PublicOffer; className?: string }) {
  const { store } = useBlanxer();
  const { display } = useOffers();
  const money = useMoney();
  const { quote } = useCartQuote();
  const rows = tierRows(offer, quote);
  if (!rows.length) return null;
  const applied = quote?.applications.find((a) => a.promotion_id === offer.id);
  const inBag = (quote?.lines || []).filter((l) => !l.added_by && l.allocations.some((a) => a.promotion_id === offer.id)).reduce((t, l) => t + l.qty, 0);
  const upsell = quote?.messages.find((m) => m.type === 'upsell' && m.promotion_id === offer.id);
  const until = offer.ends_at ? `until ${shortDate(offer.ends_at)}` : '';
  return (
    <section className={cx('bx-offer-tiers', className)} style={toneVar('tier', display.colors)} aria-label={offer.title}>
      <div className="bx-offer-tiers-head">
        <p className="bx-offer-tiers-title">{offer.title}</p>
        <p className="bx-offer-tiers-scope">{[scopeLabel(offer, store?.categories || []), until].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="bx-offer-tiers-grid">
        {rows.map((r) => (
          <div key={r.min} className={cx('bx-offer-tier', r.active && 'bx-offer-tier--active')}>
            <span className="bx-offer-tier-label">{r.label}</span>
            <span className="bx-offer-tier-value">{r.value}</span>
          </div>
        ))}
      </div>
      <p className="bx-offer-tiers-note">
        {applied && applied.amount > 0 ? (
          <>
            With {inBag} in your bag you're saving <strong>{money(applied.amount)}</strong>.{' '}
          </>
        ) : null}
        {upsell ? upsell.text : !applied ? 'Mix and match; your bag shows the saving.' : null}
      </p>
    </section>
  );
}

function Countdown({ to, prefix = 'ends in' }: { to: string; prefix?: string }) {
  const now = useOfferClock(true);
  if (now == null) return null;
  const ms = new Date(to).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return (
    <span className="bx-offer-countdown">
      {prefix} <strong>{formatCountdown(ms)}</strong>
    </span>
  );
}

/** Copies a code and keeps it as the shopper's code (applied in the bag once it qualifies). */
export function OfferCodeChip({ code, className }: { code: string; className?: string }) {
  const { setCode } = useOffers();
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    setCode(code);
    try {
      void navigator.clipboard?.writeText(code);
    } catch {
      /* clipboard blocked */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" className={cx('bx-offer-code', className)} onClick={onClick} aria-label={`Copy code ${code}`}>
      {code} · {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const placesText = (places: string[]) => (places.length ? ` in ${places.join(', ')}` : '');

/** Store-wide offer notes on a product page: delivery, gift, public codes (with countdowns). */
export function OfferNotes({ offers, className }: { offers: PublicOffer[]; className?: string }) {
  const { display } = useOffers();
  const money = useMoney();
  const notes: Array<{ id: string; tag: string; tone: BadgeTone; body: ReactNode; ends?: string | null }> = [];
  for (const o of offers) {
    if (o.state !== 'live') continue;
    const ends = display.countdowns && o.display?.countdown ? o.ends_at : null;
    if (o.kind === 'free_delivery' && display.pdp_delivery) {
      const f = o.free_delivery!;
      const what = f.value_type === 'percent' && f.value >= 100 ? 'Free delivery' : `${f.value_type === 'percent' ? `${f.value}%` : money(f.value)} off delivery`;
      notes.push({
        id: o.id,
        tag: 'Delivery',
        tone: 'saving',
        ends,
        body: (
          <>
            <strong>{what}</strong>
            {o.conditions.min_amount ? ` on orders over ${money(o.conditions.min_amount)}` : ''}
            {placesText(o.conditions.places)}
          </>
        ),
      });
    } else if (o.kind === 'gift' && o.gift?.trigger.basis === 'amount') {
      notes.push({
        id: o.id,
        tag: 'Gift',
        tone: 'gift',
        ends,
        body: (
          <>
            <strong>{o.title}</strong>
            {o.gift.auto_add ? ' — added to your bag automatically' : ''}
          </>
        ),
      });
    } else if (o.method === 'code' && o.code && o.amount_off?.scope?.type === 'all') {
      notes.push({
        id: o.id,
        tag: 'Code',
        tone: 'saving',
        ends,
        body: (
          <>
            <strong>{o.title}</strong>
            {o.conditions.min_amount ? ` on orders over ${money(o.conditions.min_amount)}` : ''} with <OfferCodeChip code={o.code} />
          </>
        ),
      });
    } else if (o.kind === 'bxgy') {
      notes.push({ id: o.id, tag: 'Offer', tone: 'bxgy', ends, body: <strong>{o.title}</strong> });
    }
  }
  if (!notes.length) return null;
  return (
    <ul className={cx('bx-offer-notes', className)}>
      {notes.map((n) => (
        <li key={n.id} className="bx-offer-note">
          <span className="bx-offer-note-tag" style={toneVar(n.tone, display.colors)}>
            {n.tag}
          </span>
          <span className="bx-offer-note-body">
            {n.body}
            {n.ends ? (
              <>
                {' · '}
                <Countdown to={n.ends} />
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// bundle item products, fetched once per page load
const productMemo = new Map<string, Promise<Product | null>>();
const loadProduct = (storeId: string, id: string) => {
  const key = `${storeId}:${id}`;
  let p = productMemo.get(key);
  if (!p) {
    p = getProductPublic(storeId, id).catch(() => null);
    productMemo.set(key, p);
  }
  return p;
};

const variantsOf = (p: Product): ProductVariant[] => (p.variants || []).filter((v) => !!v?._id);

const bundleLine = (p: Product, variant: ProductVariant | undefined, qty: number): CartItem => ({
  id: '',
  product: p._id,
  product_name: p.name,
  slug: p.slug,
  sku: variant?.sku || p.sku || '',
  price: ensureNumber(variant?.price ?? p.price),
  compare_at_price: ensureNumber(variant?.compare_at_price ?? p.compare_at_price),
  quantity: qty,
  weight: ensureNumber(variant?.weight ?? p.weight),
  variant: variant?._id || '',
  variant_name: variant?.option_name || '',
  image_url: variant?.image_url || p.image_urls?.[0] || '',
  custom_fields: [],
});

/**
 * "Bundle & save" block: the set's items, a variant pick for items with options, the set
 * price from a server quote of just these items, and "Add all".
 */
export function BundleOffer({ offer, className, labels }: { offer: PublicOffer; className?: string; labels?: { title?: string; addAll?: string } }) {
  const { storeId, store, notify } = useBlanxer();
  const cart = useCart();
  const { display } = useOffers();
  const money = useMoney();
  const items = offer.bundle?.items || [];
  const [products, setProducts] = useState<Array<Product | null>>([]);
  const [picks, setPicks] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!storeId || !items.length) return;
    let alive = true;
    Promise.all(items.map((i) => loadProduct(storeId, String(i.product_id)))).then((ps) => alive && setProducts(ps));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, offer.id]);

  const lines = useMemo(() => {
    if (products.length !== items.length || products.some((p) => !p)) return [];
    return items.map((it, i) => {
      const p = products[i]!;
      const vs = variantsOf(p);
      const want = it.variant_id || picks[i] || '';
      const v = vs.length ? vs.find((x) => x._id === want) || vs.find((x) => ensureNumber(x.quantity) > 0) || vs[0] : undefined;
      return bundleLine(p, v, it.qty || 1);
    });
  }, [products, items, picks]);

  const { quote } = useCartQuote({ lines, code: '', enabled: lines.length > 0 });
  if (!items.length || !display.pdp_bundle) return null;
  if (!lines.length) return null;

  const app = quote?.applications.find((a) => a.promotion_id === offer.id);
  const setGross = (quote?.lines || []).filter((l) => !l.added_by).reduce((t, l) => t + l.gross, 0);
  const advanced = !!store?.use_advanced_inventory;
  const unavailable = lines.some((l, i) => {
    const p = products[i]!;
    const v = variantsOf(p).find((x) => x._id === l.variant);
    return isOutOfStock(p, v, l.quantity, advanced);
  });

  const addAll = () => {
    cart.addManyToCart(lines);
    notify({ type: 'success', title: 'Added to cart', message: offer.title });
  };

  return (
    <section className={cx('bx-offer-bundle', className)} style={toneVar('bundle', display.colors)} aria-label={offer.title}>
      <div className="bx-offer-bundle-head">
        <p className="bx-offer-bundle-title">
          {labels?.title || 'Bundle & save'} · {offer.title}
        </p>
        {app && app.amount > 0 ? <span className="bx-offer-bundle-save">Save {money(app.amount)}</span> : null}
      </div>
      <div className="bx-offer-bundle-body">
        <ul className="bx-offer-bundle-items">
          {lines.map((l, i) => {
            const p = products[i]!;
            const vs = variantsOf(p);
            return (
              <li key={`${l.product}_${i}`} className="bx-offer-bundle-item">
                <div className="bx-offer-bundle-thumb">
                  {l.image_url ? <Image loader={blanxerImageLoader} src={l.image_url} alt={l.product_name} width={96} height={96} sizes="96px" /> : null}
                </div>
                <div className="bx-offer-bundle-info">
                  <Link href={`/product/${p.slug}`} className="bx-offer-bundle-name">
                    {l.quantity > 1 ? `${l.quantity} × ` : ''}
                    {l.product_name}
                  </Link>
                  {vs.length > 1 && !items[i]!.variant_id ? (
                    <select
                      className="bx-offer-bundle-variant"
                      aria-label={`${p.name} option`}
                      value={l.variant}
                      onChange={(e) => setPicks((prev) => ({ ...prev, [i]: e.target.value }))}
                    >
                      {vs.map((v) => (
                        <option key={v._id} value={v._id}>
                          {v.option_name}
                        </option>
                      ))}
                    </select>
                  ) : l.variant_name ? (
                    <span className="bx-offer-bundle-variant-name">{l.variant_name}</span>
                  ) : null}
                  <span className="bx-offer-bundle-price">{money(l.price)}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="bx-offer-bundle-buy">
          <p className="bx-offer-bundle-all">All {lines.reduce((t, l) => t + l.quantity, 0)}</p>
          <p className="bx-offer-bundle-total">
            {app && app.amount > 0 ? <s>{money(setGross)}</s> : null}
            <strong>{quote ? money(setGross - (app?.amount || 0)) : bundleText(offer)}</strong>
          </p>
          <Button className="bx-offer-bundle-add" disabled={unavailable} onClick={addAll}>
            {unavailable ? 'Out of stock' : labels?.addAll || `Add all ${lines.length}`}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Everything offers show on a product page, by the store's settings: tier tables, notes
 * (delivery, gift, codes) and bundle blocks. Place it under the add-to-cart block.
 */
export function ProductOffers({ product, className }: { product: Pick<Product, '_id'>; className?: string }) {
  const { enabled, display } = useOffers();
  const { offers } = useProductOffers(enabled ? product._id : null);
  if (!enabled || !offers.length) return null;
  const tiers = display.pdp_tiers ? offers.filter((o) => o.kind === 'tiers' && o.state === 'live') : [];
  const bundles = display.pdp_bundle ? offers.filter((o) => o.kind === 'bundle' && o.state === 'live') : [];
  return (
    <div className={cx('bx-offer-product', className)}>
      {tiers.map((o) => (
        <OfferTierTable key={o.id} offer={o} />
      ))}
      {display.pdp_notes ? <OfferNotes offers={offers} /> : null}
      {bundles.map((o) => (
        <BundleOffer key={o.id} offer={o} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- cart

/** Spend progress (free delivery, gifts) from the quote. Hidden when the setting is off. */
export function OfferProgress({ quote, className }: { quote: Quote | null; className?: string }) {
  const { enabled, offers, display } = useOffers();
  const money = useMoney();
  const milestones = useMemo(() => (enabled && display.cart_progress ? cartMilestones(quote, offers) : []), [enabled, display.cart_progress, quote, offers]);
  const bar = milestoneBar(milestones);
  if (!bar) return null;
  const open = milestones.find((m) => !m.done);
  const done = milestones.filter((m) => m.done);
  const head = open ? open.text : `Unlocked: ${done.map((m) => m.title).join(' · ')}`;
  return (
    <div className={cx('bx-offer-progress', className)}>
      <p className="bx-offer-progress-title">{head}</p>
      <div className="bx-offer-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={bar.max} aria-valuenow={bar.reached}>
        <div className="bx-offer-progress-fill" style={{ width: `${Math.round(bar.fraction * 100)}%` }} />
      </div>
      <ul className="bx-offer-progress-steps">
        {milestones.map((m) => (
          <li key={m.promotion_id} className={cx('bx-offer-progress-step', m.done && 'bx-offer-progress-step--done')}>
            {m.title} · {m.done ? (m.pending ? 'unlocked, applies at checkout' : 'unlocked') : `${money(m.remaining)} to go`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Upsell / "pick your gift" messages from the quote (server text). Hidden when the setting is off. */
export function OfferMessages({ quote, className, exclude = [] }: { quote: Quote | null; className?: string; exclude?: string[] }) {
  const { enabled, offers, display } = useOffers();
  if (!enabled || !display.cart_upsell) return null;
  // spend milestones already show in the progress bar
  const shown = new Set([...exclude, ...(display.cart_progress ? cartMilestones(quote, offers).map((m) => m.promotion_id) : [])]);
  const list = upsellMessages(quote).filter((m) => !m.promotion_id || !shown.has(m.promotion_id));
  if (!list.length) return null;
  return (
    <ul className={cx('bx-offer-messages', className)}>
      {list.map((m, i) => (
        <li key={`${m.promotion_id || ''}_${i}`} className={cx('bx-offer-message', `bx-offer-message--${m.type}`)}>
          {m.text}
        </li>
      ))}
    </ul>
  );
}

export interface OfferCodeState {
  input: string;
  setInput: (v: string) => void;
  applying: boolean;
  /** the result of the last apply, or the quote's word on the saved code */
  message: { tone: 'success' | 'info' | 'error'; text: string } | null;
  /** the shopper's code ('' = none) */
  code: string;
  apply: () => Promise<void>;
  remove: () => void;
}

/**
 * The code field's logic. One code per order: a new code is checked with a quote first; it
 * replaces the current one only if the server applies it and it saves more.
 */
export function useOfferCode({ request, quote, error }: { request: QuoteRequest; quote: Quote | null; error?: string }): OfferCodeState {
  const { storeId } = useBlanxer();
  const { code, setCode } = useOffers();
  const money = useMoney();
  const [input, setInput] = useState('');
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<OfferCodeState['message']>(null);

  useEffect(() => {
    if (error) setMessage({ tone: 'error', text: error });
  }, [error]);

  const apply = async () => {
    const candidate = normalizeCode(input);
    if (!candidate) return;
    if (candidate === code) {
      setMessage({ tone: 'info', text: `${candidate} is already on this order.` });
      return;
    }
    setApplying(true);
    setMessage(null);
    try {
      const res = await quoteCart(storeId, { ...request, code: candidate });
      if (!res) return;
      if (res.code?.status !== 'applied') {
        setMessage({ tone: 'error', text: res.code?.message || "This code isn't valid." });
        return;
      }
      // the shopper keeps whichever order saves more overall (both totals from the server)
      const current = quote?.code?.status === 'applied' && code ? quoteSavings(quote) : null;
      const next = quoteSavings(res);
      if (current != null && next <= current) {
        const codeAmount = (q: Quote | null, c: string) => q?.applications.find((a) => a.method === 'code' && a.code === c)?.amount || 0;
        setMessage({
          tone: 'info',
          text: `Only one code per order. ${candidate} would save ${money(codeAmount(res, candidate))} — ${code} saves ${money(codeAmount(quote, code))}, so we kept it.`,
        });
        return;
      }
      setCode(candidate);
      setInput('');
      setMessage({ tone: 'success', text: current != null ? `${candidate} applied instead of ${code}.` : res.code.message });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e, 'Could not check this code. Please try again.') });
    } finally {
      setApplying(false);
    }
  };

  const remove = () => {
    setCode('');
    setMessage(null);
  };

  return { input, setInput, applying, message, code, apply, remove };
}

export interface OfferCodeFieldProps {
  /** the current quote request (from `useCartQuote`) */
  request: QuoteRequest;
  quote: Quote | null;
  /** order-time error for the code (`fields.code`) */
  error?: string;
  /** start closed behind a "Have a code?" link */
  collapsed?: boolean;
  className?: string;
  labels?: { placeholder?: string; apply?: string; have?: string; another?: string; remove?: string };
}

/** "Have a code?" field with the applied code as a removable chip. Hidden when the setting is off. */
export function OfferCodeField({ request, quote, error, collapsed = false, className, labels }: OfferCodeFieldProps) {
  const { enabled, display } = useOffers();
  const s = useOfferCode({ request, quote, error });
  const [open, setOpen] = useState(!collapsed);
  if (!enabled || !display.code_field) return null;
  const app = quote?.applications.find((a) => a.method === 'code' && a.code === s.code);
  const quoteWord = s.code && quote?.code?.code === s.code && quote.code.status === 'rejected' ? quote.code.message : '';
  const inputOpen = !collapsed || open;
  return (
    <div className={cx('bx-offer-codefield', className)}>
      {s.code ? (
        <div className="bx-offer-codefield-applied">
          <span className="bx-offer-codechip">
            {s.code}
            <button type="button" className="bx-offer-codechip-remove" aria-label={`${labels?.remove || 'Remove'} ${s.code}`} onClick={s.remove}>
              ×
            </button>
          </span>
          {app ? <span className="bx-muted">{app.title}</span> : null}
        </div>
      ) : null}
      {quoteWord ? <p className="bx-offer-codefield-msg bx-offer-codefield-msg--error">{quoteWord}</p> : null}
      {inputOpen ? (
        <div className="bx-offer-codefield-row">
          <input
            className="bx-input"
            placeholder={labels?.placeholder || 'Discount code'}
            aria-label={labels?.placeholder || 'Discount code'}
            value={s.input}
            onChange={(e) => s.setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void s.apply();
              }
            }}
          />
          <Button variant="secondary" className="bx-offer-codefield-apply" loading={s.applying} onClick={() => void s.apply()}>
            {labels?.apply || 'Apply'}
          </Button>
        </div>
      ) : (
        <button type="button" className="bx-offer-link" onClick={() => setOpen(true)}>
          {s.code ? labels?.another || 'Have another code?' : labels?.have || 'Have a code?'}
        </button>
      )}
      {s.message ? <p className={cx('bx-offer-codefield-msg', `bx-offer-codefield-msg--${s.message.tone}`)}>{s.message.text}</p> : null}
    </div>
  );
}

export interface OfferSummaryProps {
  quote: Quote | null;
  /** Σ customization charge × qty of the lines (not in the quote) */
  customization?: number;
  /** show the delivery row (checkout) */
  showDelivery?: boolean;
  /** delivery place, for the row label */
  place?: string;
  className?: string;
  labels?: { subtotal?: string; delivery?: string; total?: string; free?: string; saving?: (amount: string) => string; deliveryLater?: string };
}

/** Sub-total, one row per offer, delivery, total and "You're saving" — all from the quote. */
export function OfferSummary({ quote, customization = 0, showDelivery = false, place, className, labels }: OfferSummaryProps) {
  const { display } = useOffers();
  const money = useMoney();
  if (!quote) return null;
  const rows = summaryRows(quote);
  const d = quote.delivery;
  const saving = quoteSavings(quote);
  return (
    <div className={cx('bx-offer-summary', className)}>
      <dl className="bx-totals">
        <div className="bx-total-row">
          <dt>{labels?.subtotal || 'Sub-total'}</dt>
          <dd>{money(quote.totals.gross + customization)}</dd>
        </div>
        {rows.map((r) => (
          <div key={r.promotion_id} className="bx-total-row bx-total-row--discount" data-offer-kind={r.kind}>
            <dt>{r.label}</dt>
            <dd>-{money(r.amount)}</dd>
          </div>
        ))}
        {showDelivery ? (
          <div className="bx-total-row">
            <dt>
              {labels?.delivery || 'Delivery'}
              {place ? <span className="bx-muted"> · {place}</span> : null}
            </dt>
            <dd>
              {d.before == null ? (
                <span className="bx-muted">{labels?.deliveryLater || 'Choose a place'}</span>
              ) : (
                <>
                  {d.discount > 0 ? <s className="bx-muted">{money(d.before)}</s> : null}{' '}
                  {d.after === 0 ? <span className="bx-free">{labels?.free || 'FREE'}</span> : money(d.after ?? d.before)}
                </>
              )}
            </dd>
          </div>
        ) : null}
        <div className="bx-total-row bx-total-row--grand">
          <dt>{labels?.total || 'Total'}</dt>
          <dd>{money((showDelivery ? quote.totals.total : quote.totals.goods) + customization)}</dd>
        </div>
      </dl>
      {!showDelivery ? <p className="bx-muted bx-offer-summary-note">{labels?.deliveryLater || 'Delivery is added at checkout.'}</p> : null}
      {display.cart_savings && saving > 0 ? (
        <p className="bx-offer-savings">{labels?.saving ? labels.saving(money(saving)) : `You're saving ${money(saving)} on this order`}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- offers page

const GROUP_LABEL: Record<OfferGroup | 'all', string> = { all: 'All', codes: 'Codes', bundles: 'Bundles', gifts: 'Gifts', delivery: 'Delivery', discounts: 'Discounts' };

const toneOf = (o: PublicOffer): BadgeTone =>
  o.kind === 'tiers' ? 'tier' : o.kind === 'bundle' ? 'bundle' : o.kind === 'gift' ? 'gift' : o.kind === 'bxgy' ? 'bxgy' : 'saving';

export interface OffersListProps {
  /** default: the store's offers from `useOffers` */
  offers?: PublicOffer[];
  /** where "Shop now" goes for an offer (null hides it). Default `/products`. */
  offerHref?: (offer: PublicOffer) => string | null;
  className?: string;
  /** heading of the upcoming list */
  soonTitle?: string;
}

/** The Offers page: filter chips, a card per live offer (code copy, countdown), and "Coming soon". */
export function OffersList({ offers: given, offerHref, className, soonTitle = 'Coming soon' }: OffersListProps) {
  const ctx = useOffers();
  const offers = given || ctx.offers;
  const display = ctx.display;
  const [filter, setFilter] = useState<OfferGroup | 'all'>('all');
  const { live, soon } = useMemo(() => offersPageLists(offers), [offers]);
  const groups = useMemo(() => (['codes', 'bundles', 'gifts', 'delivery', 'discounts'] as OfferGroup[]).filter((g) => live.some((o) => offerGroup(o) === g)), [live]);
  const shown = filter === 'all' ? live : live.filter((o) => offerGroup(o) === filter);
  const href = offerHref || (() => '/products');

  const card = (o: PublicOffer, upcoming = false) => {
    const link = href(o);
    const ends = !upcoming && display.countdowns && o.display?.countdown && o.ends_at ? o.ends_at : null;
    return (
      <article key={o.id} className={cx('bx-offer-card', upcoming && 'bx-offer-card--soon')} style={toneVar(toneOf(o), display.colors)}>
        {!upcoming ? <div className={cx('bx-offer-card-hero', `bx-offer-card-hero--${toneOf(o)}`)}>{offerHeadline(o)}</div> : null}
        <p className="bx-offer-card-tag">{offerTagline(o)}</p>
        <h3 className="bx-offer-card-title">{o.title}</h3>
        <p className="bx-offer-card-text">{offerConditionsText(o)}</p>
        <div className="bx-offer-card-foot">
          {upcoming ? null : o.code ? (
            <OfferCodeChip code={o.code} />
          ) : link ? (
            <Link href={link} className="bx-button bx-button--secondary bx-offer-card-cta">
              {o.kind === 'bundle' ? 'Get the bundle' : 'Shop now'}
            </Link>
          ) : null}
          <span className="bx-offer-card-when">
            {upcoming ? (
              `${shortDate(o.starts_at)}${o.ends_at ? ` – ${shortDate(o.ends_at)}` : ''}`
            ) : ends ? (
              <Countdown to={ends} prefix="Ends in" />
            ) : o.ends_at ? (
              `Until ${shortDate(o.ends_at)}`
            ) : o.kind === 'gift' ? (
              'While stock lasts'
            ) : (
              'No end date'
            )}
          </span>
        </div>
      </article>
    );
  };

  if (!live.length && !soon.length) return <p className="bx-muted">No offers right now.</p>;
  return (
    <div className={cx('bx-offers', className)}>
      {groups.length > 1 ? (
        <div className="bx-offers-filters" role="group" aria-label="Filter offers">
          {(['all', ...groups] as Array<OfferGroup | 'all'>).map((g) => (
            <button key={g} type="button" className={cx('bx-chip', filter === g && 'bx-chip--active')} aria-pressed={filter === g} onClick={() => setFilter(g)}>
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="bx-offers-grid">{shown.map((o) => card(o))}</div>
      {soon.length ? (
        <>
          <h2 className="bx-offers-soon-title">{soonTitle}</h2>
          <div className="bx-offers-grid">{soon.map((o) => card(o, true))}</div>
        </>
      ) : null}
    </div>
  );
}
