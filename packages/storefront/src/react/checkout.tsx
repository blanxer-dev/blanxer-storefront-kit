'use client';
/**
 * The Blanxer checkout, ported from the storefront (`src/features/checkout`
 * on main cabd695). Behaviour is fixed; restyle it with the `bx-*` classes,
 * CSS variables (`<BlanxerProvider theme>`), `labels`, `className` and the
 * header/footer slots. Never re-implement this logic in a site.
 *
 * Stores on Offers: the summary, code field and Place Order amount come from the server's
 * cart quote (`useCartQuote`), and the order carries the code, removed offers and gift
 * picks. Other stores keep the coupon flow unchanged.
 *
 * Advance payment (cash on delivery with part paid online first): the advance comes from the
 * server's quote (`advance`), the COD tile says it, the shopper picks the online method that pays
 * it, and the order is then paid like an online order. Every online order (and advance order)
 * keeps the cart until its payment is confirmed; a try that didn't finish is paid again on the
 * same order ("Payment not finished"), never placed twice.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { STORAGE_KEYS } from '../core/config.js';
import { quoteCheckout } from '../core/checkout.js';
import { deliveryPlaces } from '../core/delivery.js';
import { fieldError, errorMessage } from '../core/http.js';
import { codeFieldError } from '../core/offers.js';
import { buildOrderPayload, contentId, initialCheckoutValues, type CheckoutFormValues } from '../core/order.js';
import { paymentFlow, paymentMethodsFor } from '../core/payments.js';
import {
  activeAdvance,
  advanceBlocks,
  advanceFlow,
  advancePaymentOn,
  advanceWords,
  cartSignature,
  codOffer,
  orderAdvance,
  pendingDue,
  pendingFor,
  pickAdvanceVia,
  placedAmount,
  quotePayable,
  toAdvance,
  type Advance,
  type PendingOrder,
} from '../core/advance.js';
import { todayISODate } from '../core/format.js';
import { validation } from '../core/validation.js';
import type { Coupon, DeliveryTable, OrderResponse, PaymentMethodName } from '../core/types.js';
import {
  applyCoupon,
  buildOrderMeta,
  clearPendingOrder,
  firePurchase,
  getDeliveryCharges,
  loadPendingOrder,
  localOrderMeta,
  placeOrder,
  readPendingOrder,
  releaseHold,
  rememberCheckoutUser,
  savePendingOrder,
  savePendingPurchase,
  splitName,
  takePendingPurchase,
  trackEvent,
} from '../client/index.js';
import { useBlanxer } from './context.js';
import { useCart } from './cart.js';
import { CartLines } from './cart-lines.js';
import { useCartQuote, useOffers } from './offers.js';
import { OfferCodeField, OfferGiftPicker, OfferSummary } from './offer-ui.js';
import { useMoney } from './money.js';
import { AdvanceSummaryRows, useAdvanceQuote } from './advance-ui.js';
import { AdvanceMethodModal, PaymentDueBox, usePayOrder } from './pay-order.js';
import { Button, SelectInput, TextInput, cx } from './ui.js';

export interface CheckoutLabels {
  title: string;
  senderSection: string;
  receiverSection: string;
  generalSection: string;
  companySection: string;
  addressSection: string;
  paymentSection: string;
  summary: string;
  subtotal: string;
  delivery: string;
  discount: string;
  total: string;
  free: string;
  promo: string;
  apply: string;
  remove: string;
  placeOrder: string;
  emptyCart: string;
  continueShopping: string;
}

const DEFAULT_LABELS: CheckoutLabels = {
  title: 'Checkout',
  senderSection: 'Sender Information',
  receiverSection: 'Receiver Information',
  generalSection: 'General Information',
  companySection: 'Company Information',
  addressSection: 'Delivery Address',
  paymentSection: 'Payment Methods',
  summary: 'Order Summary',
  subtotal: 'Sub-total',
  delivery: 'Delivery Charge',
  discount: 'Discount',
  total: 'Total',
  free: 'FREE',
  promo: 'Promo Code',
  apply: 'Apply',
  remove: 'Remove',
  placeOrder: 'Place Order',
  emptyCart: 'Your cart is empty.',
  continueShopping: 'Continue shopping',
};

const ERROR_FIELDS = [
  'customer_email',
  'customer_phone_number',
  'customer_alt_phone_number',
  'customer_full_name',
  'customer_address',
  'customer_address_city',
  'sender_email',
  'sender_phone_number',
  'sender_full_name',
  'pan',
  'company_name',
  'delivery_date',
  'order_note',
];

export interface CheckoutProps {
  /** Delivery table from `getDeliveryCharges()` (server). Fetched in the browser when omitted. */
  delivery?: DeliveryTable | null;
  labels?: Partial<CheckoutLabels>;
  className?: string;
  /** Rendered above the form (e.g. breadcrumb, back link). */
  header?: ReactNode;
  /** Rendered under the Place Order button (e.g. trust badges). */
  footer?: ReactNode;
  /** Optional icon/content per payment method, e.g. `{ Esewa: <img …/> }`. */
  paymentMethodIcons?: Partial<Record<PaymentMethodName, ReactNode>>;
  /** Called after the order is created (before any payment redirect). */
  onOrderPlaced?: (order: OrderResponse, paymentMethod: string) => void;
}

export function Checkout({ delivery: deliveryProp, labels, className, header, footer, paymentMethodIcons, onOrderPlaced }: CheckoutProps) {
  const { store, storeId, notify } = useBlanxer();
  const cart = useCart();
  const router = useRouter();
  const money = useMoney();
  const l = { ...DEFAULT_LABELS, ...labels };
  const lines = cart.selectedItems;

  const [orderPlaced, setOrderPlaced] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryTable | null>(deliveryProp || null);
  const [values, setValues] = useState<CheckoutFormValues>(() => initialCheckoutValues(store));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const placingRef = useRef(false);
  const [testOrder, setTestOrder] = useState(false);
  // advance payment: the "Pay Rs X & place order" modal, and the method last picked there
  const [choosingAdvance, setChoosingAdvance] = useState(false);
  const lastVia = useRef('');
  // the order placed from this tab whose payment isn't confirmed yet (sessionStorage)
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const offers = useOffers();
  const offersOn = offers.enabled;
  const [codeError, setCodeError] = useState('');

  // coupon
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  const receiverInfo = !!store?.checkout?.receiver_info;
  const emailRequired = !!store?.checkout?.extras?.email_required;
  const senderEmailRequired = !!store?.checkout?.extras?.sender_email_required;

  // Checkout always reflects the cart: nothing selected → select everything.
  useEffect(() => {
    if (!orderPlaced && cart.items.length > 0 && cart.selectedIds.size === 0) cart.selectAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.items.length, cart.selectedIds.size, orderPlaced]);

  useEffect(() => {
    if (deliveryProp) {
      setDelivery(deliveryProp);
      return;
    }
    if (!storeId) return;
    getDeliveryCharges(storeId)
      .then(setDelivery)
      .catch(() => setDelivery({ defaults: [], places: [] }));
  }, [deliveryProp, storeId]);

  const placeItems = useMemo(() => deliveryPlaces(delivery), [delivery]);
  useEffect(() => {
    if (placeItems.length) setValues((v) => ({ ...v, customer_address_city: placeItems[0]!.value }));
  }, [placeItems]);

  const quote = quoteCheckout({
    store,
    lines,
    delivery,
    place: values.customer_address_city,
    paymentMethod,
    coupon,
  });
  const place = values.customer_address_city;

  // Offers: the server prices the order (lines, code, delivery place, payment, phone).
  const cq = useCartQuote({
    lines,
    place,
    paymentMethod,
    phone: values.customer_phone_number,
    enabled: offersOn && !orderPlaced,
  });
  const offerQuote = offersOn ? cq.quote : null;
  const customization = quote.customization;
  // the server's payable (customization included); older backends: add customization here
  const payable = offerQuote ? (quotePayable(offerQuote) ?? offerQuote.totals.total + customization) : quote.payable;
  useEffect(() => setCodeError(''), [offers.code]);

  // Advance payment. Stores on Offers: the quote carries it (always the COD advance, whatever
  // method is picked). Other stores: asked only when the store has the advance switched on.
  const advanceOn = advancePaymentOn(store);
  const plainAdvance = useAdvanceQuote({
    lines,
    place,
    phone: values.customer_phone_number,
    coupon: coupon?._id || '',
    enabled: advanceOn && offers.ready && !offersOn && !orderPlaced,
  });
  const advance: Advance | null = offersOn
    ? toAdvance(cq.quote?.advance)
    : advanceOn
      ? plainAdvance.advance
      : null;
  // the answer for this cart / place / code hasn't come yet (only waited for on advance stores)
  const advanceFresh = !advanceOn || (offersOn ? cq.fresh || (!cq.loading && !!cq.error) : plainAdvance.fresh);
  const offer = codOffer(advance);
  // An advance that is the whole order and required: no cash on delivery here.
  const methods = offer.mode === 'hidden' ? quote.paymentMethods.filter((m) => m.name !== 'COD') : quote.paymentMethods;
  const online = methods.filter((m) => m.name !== 'COD').map((m) => m.name as string);
  // COD where the advance applies: the summary splits and the button asks for the advance;
  // the method that pays it is picked only when the order is placed (`advanceFlow`)
  const active = activeAdvance(paymentMethod, offer);
  const words = offer.mode === 'advance' ? advanceWords(offer.advance, money) : null;
  const blocked = advanceBlocks(paymentMethod, offer, online) || (paymentMethod === 'COD' && !advanceFresh);

  // A payment that didn't finish, for the cart as it is now: pay it again on the same order. The
  // stored copy is read from the server first (Place order waits): paid meanwhile → forgotten,
  // its lines leave the cart; cancelled / nothing to pay → forgotten; due → the server's amount.
  const [waitingCheck, setWaitingCheck] = useState(true);
  const [paidMeanwhile, setPaidMeanwhile] = useState<PendingOrder | null>(null);
  const checkStored = () => {
    setWaitingCheck(true);
    return loadPendingOrder(storeId)
      .then(({ pending: p, paid: done }) => {
        if (done) setPaidMeanwhile(done);
        setPending(p);
      })
      .finally(() => setWaitingCheck(false));
  };
  useEffect(() => {
    void checkStored();
    // back from a gateway page (bfcache): the button isn't busy any more, the order still waits
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setSubmitting(false);
      void checkStored();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  useEffect(() => {
    if (!paidMeanwhile || !cart.hydrated) return;
    cart.removeLines(paidMeanwhile.lines);
    notify({ type: 'success', title: 'Payment received', message: `Order #${paidMeanwhile.order_number} is paid.` });
    setPaidMeanwhile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidMeanwhile, cart.hydrated]);
  const signature = useMemo(() => cartSignature(lines), [lines]);
  const waiting = cart.hydrated ? pendingFor(pending, signature) : null;
  const allOnline = useMemo(() => paymentMethodsFor(store, { codAllowed: false }), [store]);

  // Preselect the first method; if the chosen one disappears (e.g. a place without COD), move to the first.
  const methodNames = methods.map((m) => m.name).join(',');
  useEffect(() => {
    if (!methods.length) {
      setPaymentMethod('');
      return;
    }
    setPaymentMethod((prev) => (prev && methods.some((m) => m.name === prev) ? prev : methods[0]!.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodNames]);

  const productsForCoupon = () => lines.map((el) => ({ product: el.product, variant: el.variant, quantity: el.quantity }));

  const fetchCoupon = async (codeOverride?: string) => {
    const code = (codeOverride || couponCode).trim();
    if (!code) return;
    setCouponLoading(true);
    setCouponError('');
    try {
      const res = await applyCoupon({ store: storeId, code, products: productsForCoupon() });
      setCoupon(res);
    } catch (e) {
      setCouponError(errorMessage(e, 'Coupon code not found'));
    }
    setCouponLoading(false);
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponCode('');
    setCouponError('');
  };

  // `?promo=` (stored by BlanxerProvider, or on this URL) is applied once when the order has lines.
  // Stores on Offers read it in OffersProvider instead.
  const autoApplied = useRef(false);
  useEffect(() => {
    if (!lines.length || autoApplied.current || offersOn || !offers.ready) return;
    let promo = '';
    try {
      promo = new URLSearchParams(window.location.search).get('promo') || localStorage.getItem(STORAGE_KEYS.promoCode) || '';
    } catch {
      promo = '';
    }
    if (!promo) return;
    autoApplied.current = true;
    setCouponCode(promo.toUpperCase());
    fetchCoupon(promo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, offersOn, offers.ready]);

  const initiateFired = useRef(false);
  useEffect(() => {
    if (!lines.length || initiateFired.current) return;
    initiateFired.current = true;
    trackEvent('InitiateCheckout', checkoutContents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  // Catalog-matching line ids with quantities, for InitiateCheckout / AddPaymentInfo.
  const checkoutContents = () => {
    const contents = lines.map((l: any) => ({
      id: contentId(l),
      quantity: l.quantity || 1,
      item_price: (l.price || 0) + (l.customization_charge || 0),
    }));
    return {
      content_ids: Array.from(new Set(contents.map((c) => c.id))),
      contents,
      content_type: 'product',
      value: payable,
      currency: 'NPR',
      num_items: contents.reduce((s, c) => s + c.quantity, 0),
    };
  };

  // AddPaymentInfo once, when the shopper picks a method themselves.
  const paymentInfoFired = useRef(false);
  const choosePaymentMethod = (name: string) => {
    setPaymentMethod(name);
    if (!paymentInfoFired.current && lines.length) {
      paymentInfoFired.current = true;
      trackEvent('AddPaymentInfo', checkoutContents());
    }
  };

  const set = (key: keyof CheckoutFormValues) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: '' }));
  };

  const validate = (): Record<string, string> => {
    const v = values;
    const e: Record<string, string | null> = {
      customer_full_name: validation.required(v.customer_full_name),
      // Same as the storefront: the email format is only checked when the store requires an email (the server validates the rest).
      customer_email: emailRequired ? validation.email(v.customer_email) : null,
      customer_phone_number: validation.phone(v.customer_phone_number),
      customer_alt_phone_number: validation.optionalPhone(v.customer_alt_phone_number),
      customer_address: validation.required(v.customer_address),
      customer_address_city: validation.required(v.customer_address_city),
    };
    if (receiverInfo) {
      e.sender_full_name = validation.required(v.sender_full_name);
      e.sender_phone_number = validation.phone(v.sender_phone_number);
      if (senderEmailRequired) e.sender_email = validation.email(v.sender_email);
    }
    const out: Record<string, string> = {};
    for (const [k, msg] of Object.entries(e)) if (msg) out[k] = msg;
    return out;
  };

  const forgetPending = () => {
    clearPendingOrder();
    setPending(null);
    try {
      sessionStorage.removeItem(STORAGE_KEYS.checkoutOrderId);
    } catch {
      /* ignore */
    }
  };

  // Payment confirmed: only now do the ordered lines leave the cart.
  const paid = () => {
    const p = readPendingOrder();
    if (p) cart.removeLines(p.lines);
    else cart.removeSelectedFromCart();
    clearPendingOrder();
    setPending(null);
  };

  const pay = usePayOrder({
    onPaid: paid,
    onStarted: (method, orderId, start) => {
      const p = readPendingOrder();
      if (!p || p.order_id !== orderId) return;
      const transaction = (start as any).transaction ? String((start as any).transaction) : p.transaction;
      const next: PendingOrder = { ...p, method, ...(transaction ? { transaction } : {}) };
      savePendingOrder(next);
      setPending(next);
    },
    onRefused: (kind, _message, orderId) => {
      if (kind === 'paid') {
        // paid already (e.g. in another tab): the success page clears the cart and goes to the order
        try {
          sessionStorage.setItem(STORAGE_KEYS.checkoutOrderId, orderId);
        } catch {
          /* ignore */
        }
        router.push('/payment/success');
        return;
      }
      // cancelled: that order is gone, the shopper may place a new one
      forgetPending();
      takePendingPurchase();
      setSubmitting(false);
    },
    onUnpaid: () => setPending(readPendingOrder()),
    onError: () => setSubmitting(false),
  });

  const payAgain = (method: string) => {
    if (!waiting) return;
    void pay.start(method, waiting.order_id);
  };

  const startOver = () => {
    forgetPending();
    takePendingPurchase();
  };

  // Give the waiting order's held units back: by its payment attempt when known, else by the
  // order's phone (after a failed redirect there is no attempt id). Best effort: the hold also ends.
  const releaseWaiting = async (p: PendingOrder) => {
    const phone = String(values.customer_phone_number || '').trim();
    try {
      if (p.transaction) await releaseHold({ store_id: storeId, order_id: p.order_id, transaction_id: p.transaction });
      else if (/^\d{10}$/.test(phone)) await releaseHold({ store_id: storeId, order_id: p.order_id, phone_number: phone });
    } catch {
      /* best effort */
    }
  };

  // "Change the order details instead": drop the waiting order (its units go back) and edit the form again.
  const changeDetails = async () => {
    const p = waiting;
    if (p) await releaseWaiting(p);
    startOver();
  };

  // Shopper's-choice advance: drop the unpaid advance order (give its units back) and place a
  // new plain cash-on-delivery order with the same details.
  const codInstead = async () => {
    const p = waiting;
    if (!p?.advance || p.advance.required) return;
    setSubmitting(true);
    await releaseWaiting(p);
    forgetPending();
    takePendingPurchase();
    setPaymentMethod('COD');
    await placeNew('COD', '', null);
  };

  /** Form errors shown and the first one focused; true when the form is fine. */
  const formOk = (): boolean => {
    const v = validate();
    setErrors(v);
    if (!Object.keys(v).length) return true;
    const first = document.querySelector('.bx-checkout [aria-invalid="true"]') as HTMLElement | null;
    first?.focus();
    return false;
  };

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    if (waiting || placingRef.current) return; // never a second order for this cart: pay the waiting one
    if (!active) {
      void placeNew(paymentMethod, '', null);
      return;
    }
    // COD with an advance: ask which online method pays it (the order is created on confirm),
    // or go straight to the store's only one when the advance is required
    if (!formOk()) return;
    const flow = advanceFlow(offer, online);
    if (flow.kind === 'direct') void placeNew('COD', flow.via, active);
    else if (flow.kind === 'choose') setChoosingAdvance(true);
    else void placeNew(paymentMethod, '', null);
  };

  /** From the advance modal: an online method → the advance order; '' (shopper's choice) → plain COD. */
  const confirmAdvance = (via: string) => {
    setChoosingAdvance(false);
    if (via) lastVia.current = via;
    void placeNew('COD', via, via ? active : null);
  };

  const placeNew = async (method: string, via: string, adv: Advance | null) => {
    if (placingRef.current) return;
    if (!formOk()) return;
    if (!lines.length || !method) return;

    placingRef.current = true;
    setSubmitting(true);
    try {
      // matching data for Meta (this browser session only)
      rememberCheckoutUser({
        email: values.customer_email,
        phone: values.customer_phone_number,
        city: values.customer_address_city,
        ...splitName(values.customer_full_name),
      });
      const payload = buildOrderPayload({
        store,
        lines,
        values,
        paymentMethod: method,
        url: window.location.origin,
        couponId: quote.coupon.valid && coupon?._id ? coupon._id : '',
        // a code the latest quote rejected isn't sent (the shopper sees why); with no quote yet the server decides
        offers: offersOn
          ? {
              code: !offerQuote || offerQuote.code?.status === 'applied' ? offers.code : '',
              removedOffers: offers.removedOffers,
              giftChoices: offers.giftChoices,
            }
          : undefined,
        meta: buildOrderMeta(),
        advance: adv,
        advanceVia: via,
      });
      const res = await placeOrder(storeId, payload);

      if (!res?._id) {
        // Test numbers (0000000000 / mailinator) are accepted without creating an order.
        setTestOrder(true);
        notify({ type: 'info', title: 'Test order accepted', message: 'This phone/email is a test contact, so no order was created.' });
        setSubmitting(false);
        return;
      }

      // An advance order is paid online first, with the method picked for the advance; the
      // server decides (no `advance` on the answer = plain COD, as on older backends).
      const resAdvance = method === 'COD' ? orderAdvance(res) : null;
      const payWith = method === 'COD' ? (resAdvance ? via || online[0] || '' : '') : method;
      if (paymentFlow(payWith) === 'none') setOrderPlaced(true);
      onOrderPlaced?.(res, method);
      // The backend's Purchase payload (same id + value as its server event);
      // built locally only against an older backend.
      const purchase =
        res.meta || localOrderMeta(lines as any, payable, String(res.order_number || ''));
      if (offersOn) offers.clearChoices();
      try {
        sessionStorage.setItem(STORAGE_KEYS.checkoutOrderId, res._id);
      } catch {
        /* storage blocked */
      }
      savePendingPurchase(purchase);

      if (paymentFlow(payWith) === 'none') {
        // COD: the server already sent its Purchase; the pixel fires with the same id.
        firePurchase(purchase);
        try {
          sessionStorage.removeItem(STORAGE_KEYS.checkoutOrderId);
          sessionStorage.removeItem(STORAGE_KEYS.pixelPurchasePending);
        } catch {
          /* ignore */
        }
        cart.removeSelectedFromCart();
        router.replace(`/track/${res._id}?from=checkout`);
        return;
      }

      // Online order or advance order: the cart stays until the payment is confirmed, and the
      // order waits here so a try that doesn't finish is paid again on the same order.
      const waitingOrder: PendingOrder = {
        order_id: res._id,
        order_number: String(res.order_number ?? ''),
        amount: placedAmount(res),
        lines: lines.map((x) => x.id),
        signature: cartSignature(lines),
        method: payWith,
        advance: resAdvance,
      };
      savePendingOrder(waitingOrder);
      setPending(waitingOrder);
      const outcome = await pay.start(payWith, res._id, res.hold_seconds);
      if (outcome !== 'left') setSubmitting(false);
    } catch (err) {
      const fe: Record<string, string> = {};
      for (const k of ERROR_FIELDS) {
        const m = fieldError(err, k);
        if (m) fe[k] = m;
      }
      setErrors(fe);
      const codeMsg = codeFieldError(err);
      if (codeMsg) setCodeError(codeMsg);
      const fieldKeys = Object.keys(fe);
      const generic = (err as any)?.body?.message || (!fieldKeys.length ? errorMessage(err) : fieldError(err, 'products'));
      if (generic) notify({ type: 'error', title: 'Error creating order', message: generic });
      setSubmitting(false);
    } finally {
      placingRef.current = false;
    }
  };

  if (cart.hydrated && !cart.items.length && !orderPlaced && !pay.open) {
    return (
      <div className={cx('bx-checkout bx-checkout--empty', className)}>
        {header}
        <p>{l.emptyCart}</p>
        <Link className="bx-button bx-button--primary" href="/products">
          {l.continueShopping}
        </Link>
      </div>
    );
  }

  const placeOptions = [{ value: '', label: 'Choose item' }, ...placeItems];
  const n = (i: number) => `${i}. `;
  const today = todayISODate();
  const cityField = (
    <SelectInput
      label="City/District"
      required
      value={values.customer_address_city}
      onChange={set('customer_address_city')}
      options={placeOptions}
      error={errors.customer_address_city}
      autoComplete="address-level2"
    />
  );
  const d = offerQuote?.delivery;
  const deliveryNote =
    d && d.discount > 0 && values.customer_address_city ? (
      <p className="bx-offer-delivery-note">
        {d.after === 0 ? (
          <>
            Delivery to {values.customer_address_city} is <strong>free</strong> on this order.
          </>
        ) : (
          <>
            Delivery offer: <strong>-{money(d.discount)}</strong> on this order.
          </>
        )}
      </p>
    ) : null;
  const addressFields = (
    <div className="bx-grid-2">
      <TextInput label="Address" required placeholder="eg: kathmandu, tinkune" value={values.customer_address} onChange={set('customer_address')} error={errors.customer_address} autoComplete="street-address" />
      <TextInput label="Landmark" placeholder="eg: madan bhandari park" value={values.customer_address_landmark} onChange={set('customer_address_landmark')} />
    </div>
  );

  return (
    <div className={cx('bx-checkout', className)} data-bx="checkout">
      {header}
      <form className="bx-checkout-grid" onSubmit={onSubmit} noValidate>
        <div className="bx-checkout-form">
          <h1 className="bx-checkout-title">{l.title}</h1>

          {receiverInfo ? (
            <section className="bx-section">
              <h2 className="bx-section-title">
                {n(1)}
                {l.senderSection}
              </h2>
              <div className="bx-grid-2">
                <TextInput label="Sender Full Name" required placeholder="eg: John Kumar" value={values.sender_full_name || ''} onChange={set('sender_full_name')} error={errors.sender_full_name} />
                <TextInput label="Sender Email" type="email" required={senderEmailRequired} placeholder="eg: john@gmail.com" value={values.sender_email || ''} onChange={set('sender_email')} error={errors.sender_email} />
              </div>
              <TextInput label="Sender Phone Number" type="tel" inputMode="numeric" required placeholder="eg: 9862200000" value={values.sender_phone_number || ''} onChange={set('sender_phone_number')} error={errors.sender_phone_number} />
            </section>
          ) : null}

          <section className="bx-section">
            <h2 className="bx-section-title">{receiverInfo ? `${n(2)}${l.receiverSection}` : `${n(1)}${l.generalSection}`}</h2>
            <div className="bx-grid-2">
              <TextInput label="Full Name" required placeholder="eg: Ram Bahadur" value={values.customer_full_name} onChange={set('customer_full_name')} error={errors.customer_full_name} autoComplete="name" />
              <TextInput label="Email" type="email" required={emailRequired} placeholder="eg: john@gmail.com" value={values.customer_email} onChange={set('customer_email')} error={errors.customer_email} autoComplete="email" />
            </div>
            <TextInput label="Phone Number" type="tel" inputMode="numeric" required placeholder="eg: 9862200000" value={values.customer_phone_number} onChange={set('customer_phone_number')} error={errors.customer_phone_number} autoComplete="tel-national" />
            <TextInput label="Alternate Phone Number (optional)" type="tel" inputMode="numeric" placeholder="eg: 9812300000" value={values.customer_alt_phone_number} onChange={set('customer_alt_phone_number')} error={errors.customer_alt_phone_number} />
            <TextInput label="Order Note (any message for us)" placeholder="eg: I was searching for this product from so long." value={values.order_note} onChange={set('order_note')} error={errors.order_note} maxLength={320} />
            {receiverInfo ? (
              <>
                {cityField}
                {deliveryNote}
                {addressFields}
              </>
            ) : null}
            {store?.checkout?.estimated_delivery ? (
              <TextInput label="Estimated Delivery Date" type="date" min={today} value={values.delivery_date || ''} onChange={set('delivery_date')} error={errors.delivery_date} />
            ) : null}
          </section>

          {store?.checkout?.pan ? (
            <section className="bx-section">
              <h2 className="bx-section-title">
                {n(3)}
                {l.companySection}
              </h2>
              <div className="bx-grid-2">
                <TextInput label="Company Name" placeholder="eg: ABC Pvt Ltd" value={values.company_name || ''} onChange={set('company_name')} error={errors.company_name} maxLength={50} />
                <TextInput label="PAN/VAT Number" placeholder="12XXXXXX" value={values.pan || ''} onChange={set('pan')} error={errors.pan} maxLength={9} />
              </div>
            </section>
          ) : null}

          {!receiverInfo ? (
            <section className="bx-section">
              <h2 className="bx-section-title">{l.addressSection}</h2>
              {cityField}
              {deliveryNote}
              {addressFields}
            </section>
          ) : null}

          {methods.length ? (
            <section className="bx-section">
              <h2 className="bx-section-title">{l.paymentSection}</h2>
              <div className="bx-payment-methods" role="radiogroup" aria-label={l.paymentSection}>
                {methods.map((m) => (
                  <label key={m.name} className={cx('bx-payment-method', paymentMethod === m.name && 'bx-payment-method--active')} data-method={m.name}>
                    <input type="radio" name="bx-payment-method" value={m.name} checked={paymentMethod === m.name} onChange={() => choosePaymentMethod(m.name)} />
                    {paymentMethodIcons?.[m.name] ? <span className="bx-payment-icon">{paymentMethodIcons[m.name]}</span> : null}
                    {m.name === 'COD' && words ? (
                      <span className="bx-payment-text">
                        <span className="bx-payment-name">{m.display_name}</span>
                        <span className="bx-advance-cod-line">{words.codLine}</span>
                      </span>
                    ) : (
                      <span className="bx-payment-name">{m.display_name}</span>
                    )}
                  </label>
                ))}
              </div>
            </section>
          ) : delivery ? (
            <p className="bx-muted">No payment method is available for this place.</p>
          ) : null}
        </div>

        <aside className="bx-checkout-summary" aria-label={l.summary}>
          <h2 className="bx-section-title">{l.summary}</h2>
          <CartLines selectable editable quote={offerQuote} />
          <OfferGiftPicker quote={offerQuote} />
          {offersOn && lines.length ? <OfferCodeField request={cq.request} quote={offerQuote} error={codeError} /> : null}
          {offerQuote ? (
            <OfferSummary
              quote={offerQuote}
              customization={customization}
              showDelivery
              place={values.customer_address_city}
              className={cx(!cq.fresh && 'bx-offer-summary--updating')}
              labels={{ subtotal: l.subtotal, total: l.total, free: l.free, saving: (a) => `You're saving ${a}` }}
              advance={active}
            />
          ) : (
          <dl className="bx-totals">
            <div className="bx-total-row">
              <dt>{l.subtotal}</dt>
              <dd>{money(quote.total)}</dd>
            </div>
            {quote.coupon.valid && !quote.coupon.shipping ? (
              <div className="bx-total-row bx-total-row--discount">
                <dt>
                  {l.discount} - {coupon?.code}
                </dt>
                <dd>-{money(quote.coupon.discount)}</dd>
              </div>
            ) : null}
            <div className="bx-total-row">
              <dt>
                {l.delivery} {quote.weight > 0 ? <span className="bx-muted">[{quote.weight} KG]</span> : null}
              </dt>
              <dd>{quote.deliveryCharge === 0 ? <span className="bx-free">{l.free}</span> : money(quote.deliveryCharge)}</dd>
            </div>
            {quote.coupon.valid && quote.coupon.shipping ? (
              <div className="bx-total-row bx-total-row--discount">
                <dt>
                  {l.discount} - {coupon?.code}
                </dt>
                <dd>-{money(quote.coupon.discount)}</dd>
              </div>
            ) : null}
            <div className="bx-total-row bx-total-row--grand">
              <dt>{l.total}</dt>
              <dd>{money(quote.payable)}</dd>
            </div>
          </dl>
          )}
          {!offerQuote ? <AdvanceSummaryRows advance={active} /> : null}
          {store?.checkout?.extras?.checkout_note ? <p className="bx-checkout-note">{store.checkout.extras.checkout_note}</p> : null}

          {store?.plan && offers.ready && !offersOn ? (
            <div className="bx-promo">
              <TextInput
                label={l.promo}
                placeholder="eg: FREE30"
                value={couponCode}
                readOnly={!!coupon?.code}
                onChange={(e) => {
                  setCouponCode(e.target.value.toUpperCase());
                  setCouponError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!coupon?.code) fetchCoupon();
                  }
                }}
                error={couponError || quote.coupon.error}
              />
              {coupon?.code ? (
                <Button variant="secondary" className="bx-promo-button" onClick={removeCoupon}>
                  {l.remove}
                </Button>
              ) : (
                <Button variant="secondary" className="bx-promo-button" loading={couponLoading} onClick={() => fetchCoupon()}>
                  {l.apply}
                </Button>
              )}
            </div>
          ) : null}

          {testOrder ? <p className="bx-notice">Test order accepted — no order was created for this test phone/email.</p> : null}

          {waiting && !pay.open && !submitting ? (
            <PaymentDueBox
              className="bx-advance-retry"
              title="Payment not finished"
              due={pendingDue(waiting)}
              methods={allOnline}
              lastMethod={waiting.method}
              primaryLabel="Try again"
              busy={pay.busy}
              onPay={payAgain}
            >
              <div className="bx-advance-retry-actions">
                {waiting.advance && !waiting.advance.required ? (
                  <Button variant="secondary" disabled={pay.busy} onClick={codInstead}>
                    Pay all in cash on delivery instead
                  </Button>
                ) : null}
                <Button variant="ghost" className="bx-advance-start-over" disabled={pay.busy} onClick={changeDetails}>
                  Change the order details instead
                </Button>
              </div>
            </PaymentDueBox>
          ) : (
            <>
              <Button
                type="submit"
                className="bx-place-order"
                loading={submitting}
                disabled={submitting || !paymentMethod || !lines.length || blocked || waitingCheck}
              >
                {active && words ? words.button : offerQuote ? `${l.placeOrder} · ${money(payable)}` : l.placeOrder}
              </Button>
              {active && words ? <p className="bx-muted bx-advance-under-button">{words.underButton}</p> : null}
            </>
          )}
          {offersOn ? <p className="bx-muted bx-offer-recheck">Prices and offers are checked again when you place the order.</p> : null}
          {/* Part of the checkout on every BlanxerAPI site: restyle through .bx-powered-by, never remove. */}
          <p className="bx-powered-by">
            Checkout Powered by{' '}
            <a href="https://blanxer.com" target="_blank" rel="noopener noreferrer">
              Blanxer
            </a>
          </p>
          {footer}
        </aside>
      </form>

      {offer.mode === 'advance' && words ? (
        <AdvanceMethodModal
          open={choosingAdvance}
          onClose={() => setChoosingAdvance(false)}
          title={words.modalTitle}
          cod={money(offer.advance.on_delivery)}
          methods={methods.filter((m) => m.name !== 'COD')}
          initial={pickAdvanceVia(lastVia.current, online)}
          payLabel={words.payButton}
          noAdvanceLabel={offer.optional ? words.noAdvance : undefined}
          placeLabel={words.noAdvanceButton}
          noAdvanceCod={money(offer.advance.total)}
          busy={submitting}
          onConfirm={confirmAdvance}
        />
      ) : null}
      {pay.modals}
    </div>
  );
}
