'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  customizationCharge,
  extractCustomFields,
  initCustomFieldState,
  optionLabel,
  optionValue,
  serializeCustomFields,
  sortCustomFields,
  TIME_SLOTS,
  validateCustomFields,
  type CustomFieldState,
} from '../core/custom-fields.js';
import { discountPercent, ensureNumber, formatCurrency, todayISODate } from '../core/format.js';
import { backInStockEnabled, stockDisplayOptions } from '../core/store.js';
import {
  findVariant,
  initialSelection,
  isOutOfStock,
  parseColorCode,
  parseRedirectTag,
  productOptions,
  productTags,
  selectionPrice,
  sizesForColor,
  splitVariantOptionName,
} from '../core/variants.js';
import type { CartItem, Product, ProductVariant } from '../core/types.js';
import { trackEvent, uploadCustomFieldImage } from '../client/index.js';
import { useBlanxer } from './context.js';
import { useMoney } from './money.js';
import { useCart } from './cart.js';
import { FlashSaleStrip } from './flash-sale.js';
import { StockAlertForm } from './stock-alert.js';
import { Button, Field, SelectInput, TextArea, TextInput, cx } from './ui.js';

export interface ProductSelection {
  product: Product;
  hasColors: boolean;
  hasSizes: boolean;
  colors: string[];
  colorCodes: string[];
  sizes: string[];
  /** Sizes that exist for the selected colour. */
  availableSizes: string[];
  color: string;
  size: string;
  setColor: (c: string) => void;
  setSize: (s: string) => void;
  /** Selected variant (undefined for simple products). */
  variant: ProductVariant | undefined;
  variantId: string;
  quantity: number;
  setQuantity: (q: number) => void;
  /** Max per order from a live flash sale (0 = none). */
  maxPerOrder: number;
  setMaxPerOrder: (n: number) => void;
  /** Unit price incl. custom-field charges. */
  price: number;
  compareAtPrice: number;
  discountPercent: number;
  outOfStock: boolean;
  comingSoon: boolean;
  noPrice: boolean;
  /** Stock shown when the store's product options say so (else null). */
  stock: number | null;
  lowStock: boolean;
  customFields: CustomFieldState[];
  setCustomField: (id: string, value: any) => void;
  /** The cart line for the current product/variant, if already in the cart. */
  cartLine: CartItem | undefined;
  /** Build the cart line (validates custom fields; null when invalid). */
  buildLine: () => CartItem | null;
  /** Validate and add. Returns the added line, or null when custom fields are invalid. */
  addToCart: () => CartItem | null;
  redirect: { label: string; link: string } | null;
  secondaryRedirect: { label: string; link: string } | null;
}

/** Variant, quantity, stock and custom-field state for a product page (storefront `useSingleProductDetails`). */
export function useProductSelection(product: Product, opts: { initialColor?: string } = {}): ProductSelection {
  const { store } = useBlanxer();
  const cart = useCart();
  const o = useMemo(() => productOptions(product), [product]);
  const initial = useMemo(() => initialSelection(product, opts.initialColor || ''), [product?._id, opts.initialColor]);
  const [color, setColorState] = useState(initial.color);
  const [size, setSize] = useState(initial.size);
  const [quantity, setQty] = useState(1);
  const [maxPerOrder, setMaxPerOrder] = useState(0);
  const defs = useMemo(() => extractCustomFields(product), [product]);
  const [customFields, setCustomFields] = useState<CustomFieldState[]>(() => initCustomFieldState(defs));

  useEffect(() => {
    setColorState(initial.color);
    setSize(initial.size);
    setQty(1);
  }, [product?._id, initial.color, initial.size]);
  useEffect(() => setCustomFields(initCustomFieldState(defs)), [defs]);

  // `?color=` deep links (read on the client so pages can stay static).
  useEffect(() => {
    if (opts.initialColor) return;
    const q = new URLSearchParams(window.location.search).get('color');
    if (!q) return;
    const s = initialSelection(product, q);
    setColorState(s.color);
    setSize(s.size);
  }, [product?._id]);

  const variant = findVariant(product, color, size);
  const advanced = !!store?.use_advanced_inventory;
  const outOfStock = isOutOfStock(product, variant, quantity, advanced);
  const { price: basePrice, compareAtPrice } = selectionPrice(product, variant);
  const extra = customizationCharge(customFields);
  const { showStock, lowStockAt } = stockDisplayOptions(store);
  const stockValue = o.hasColors || o.hasSizes ? variant?.quantity : product.quantity;
  const tags = productTags(product);

  const setColor = (next: string) => {
    if (o.hasColors && o.hasSizes) {
      const valid = new Set<string>();
      for (const v of product.variants || []) {
        const p = splitVariantOptionName(v.option_name || '', o.colors, o.sizes);
        if (p?.color === next) valid.add(p.size);
      }
      if (!valid.has(size)) setSize(o.sizes.find((s) => valid.has(s)) || '');
    }
    setColorState(next);
  };

  const cartLine = useMemo(() => {
    const vid = variant?._id || '';
    return cart.items.find((el) => el.product === product._id && (el.variant || '') === vid && !el.print);
  }, [cart.items, product._id, variant?._id]);

  const setQuantity = (q: number) => {
    const next = Math.max(1, maxPerOrder ? Math.min(maxPerOrder, q) : q);
    setQty(next);
    if (cartLine) cart.setQuantity({ ...cartLine, quantity: next });
  };

  const setCustomField = (id: string, value: any) =>
    setCustomFields((prev) => prev.map((el) => (el.id === id ? { ...el, value, error: '' } : el)));

  const buildLine = (): CartItem | null => {
    const checked = validateCustomFields(customFields);
    setCustomFields(checked.state);
    if (!checked.valid) return null;
    let price = product.price;
    let cmp = product.compare_at_price;
    let weight = product.weight;
    let image = product.image_urls?.[0] || '';
    let sku = product.sku || '';
    if (o.hasColors || o.hasSizes) {
      if (variant?.price) price = variant.price;
      if (variant?.compare_at_price) cmp = variant.compare_at_price;
      if (variant?.image_url) image = variant.image_url;
      if (variant?.sku) sku = variant.sku;
      if (typeof variant?.weight === 'number') weight = variant.weight;
    }
    return {
      id: '',
      quantity,
      product_name: product.name,
      product: product._id,
      slug: product.slug,
      sku,
      price: ensureNumber(price),
      customization_charge: extra,
      compare_at_price: ensureNumber(cmp),
      weight: ensureNumber(weight),
      variant: variant?._id || '',
      variant_name: o.hasColors || o.hasSizes ? (variant?.option_name || '') : '',
      image_url: image,
      custom_fields: serializeCustomFields(checked.state),
      delivery_charge: ensureNumber((product as any).delivery_charge),
    };
  };

  const addToCart = () => {
    const line = buildLine();
    if (!line) return null;
    cart.addToCart(line);
    setCustomFields(initCustomFieldState(defs));
    return line;
  };

  const tagsList = product.tags || [];
  return {
    product,
    hasColors: o.hasColors,
    hasSizes: o.hasSizes,
    colors: o.colors,
    colorCodes: o.colorCodes,
    sizes: o.sizes,
    availableSizes: sizesForColor(product, color),
    color,
    size,
    setColor,
    setSize,
    variant,
    variantId: variant?._id || '',
    quantity,
    setQuantity,
    maxPerOrder,
    setMaxPerOrder,
    price: basePrice + extra,
    compareAtPrice,
    discountPercent: discountPercent(basePrice, compareAtPrice),
    outOfStock,
    comingSoon: tags.comingSoon,
    noPrice: tags.noPrice,
    stock: showStock && stockValue != null ? Number(stockValue) : null,
    lowStock: !!lowStockAt && Number(stockValue) <= lowStockAt,
    customFields,
    setCustomField,
    cartLine,
    buildLine,
    addToCart,
    redirect: parseRedirectTag(tagsList, 'rd_'),
    secondaryRedirect: parseRedirectTag(tagsList, 'ard_'),
  };
}

/** Colour and size chips for a selection. */
export function VariantPicker({ selection, className }: { selection: ProductSelection; className?: string }) {
  const s = selection;
  if (!s.hasColors && !s.hasSizes) return null;
  return (
    <div className={cx('bx-variants', className)}>
      {s.hasColors && (
        <fieldset className="bx-variant-group">
          <legend className="bx-label">
            {s.product.color_name || 'Color'}: <span className="bx-variant-current">{s.color}</span>
          </legend>
          <div className="bx-chips">
            {s.colors.map((c, i) => {
              const code = parseColorCode(s.colorCodes[i] || '');
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={s.color === c}
                  className={cx('bx-chip', code.primary && 'bx-chip--swatch', s.color === c && 'bx-chip--active')}
                  onClick={() => s.setColor(c)}
                  title={c}
                >
                  {code.primary ? (
                    <span
                      className="bx-swatch"
                      style={
                        code.secondary
                          ? { background: `linear-gradient(90deg, ${code.primary} 0 50%, ${code.secondary} 50% 100%)` }
                          : { backgroundColor: code.primary }
                      }
                    />
                  ) : null}
                  <span className="bx-chip-label">{c}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {s.hasSizes && (
        <fieldset className="bx-variant-group">
          <legend className="bx-label">
            {s.product.size_name || 'Size'}: <span className="bx-variant-current">{s.size}</span>
          </legend>
          <div className="bx-chips">
            {s.availableSizes.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={s.size === z}
                className={cx('bx-chip', s.size === z && 'bx-chip--active')}
                onClick={() => s.setSize(z)}
              >
                {z}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function ImageField({ field, onChange, productId, csrfToken }: { field: CustomFieldState; onChange: (v: string) => void; productId: string; csrfToken: string }) {
  const { storeId, notify } = useBlanxer();
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      notify({ type: 'error', title: 'Image upload failed', message: 'Only png, jpg, jpeg or webp images.' });
      return;
    }
    if (file.size > 5_000_000) {
      notify({ type: 'error', title: 'Image upload failed', message: 'You can only upload at max 5MB file' });
      return;
    }
    setLoading(true);
    try {
      const url = await uploadCustomFieldImage(storeId, productId, file, csrfToken);
      if (!url) throw new Error('no url');
      onChange(url);
    } catch {
      notify({ type: 'error', title: 'Error', message: 'Image upload failed' });
    }
    setLoading(false);
  };

  return (
    <Field label={field.label} required={field.required} error={field.error} className="bx-custom-field bx-custom-field--image">
      {field.value ? (
        <div className="bx-upload-preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- shopper upload preview, not a catalog image */}
          <img src={field.value} alt="" />
          <button type="button" className="bx-upload-remove" aria-label="Remove image" onClick={() => onChange('')}>
            ×
          </button>
        </div>
      ) : (
        <button type="button" className="bx-upload" disabled={loading} onClick={() => inputRef.current?.click()}>
          {loading ? <span className="bx-spinner" aria-hidden="true" /> : null}
          {loading ? 'Uploading…' : 'Click here to upload'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Field>
  );
}

/** The product's custom fields (text, extra-charge text, textarea, image upload, date, time, single, multi). */
export function CustomFields({ selection, className }: { selection: ProductSelection; className?: string }) {
  const fields = sortCustomFields(selection.customFields);
  if (!fields.length) return null;
  const today = todayISODate();
  return (
    <div className={cx('bx-custom-fields', className)}>
      {fields.map((f) => {
        const set = (v: any) => selection.setCustomField(f.id, v);
        const common = { label: f.label, required: f.required, error: f.error, fieldClassName: `bx-custom-field bx-custom-field--${f.type}` };
        switch (f.type) {
          case 'text':
            return <TextInput key={f.id} {...common} placeholder={f.placeholder} value={f.value} onChange={(e) => set(e.target.value)} />;
          case 'text_dp':
            return (
              <TextInput
                key={f.id}
                {...common}
                label={
                  <>
                    {f.label}
                    {f.price ? <span className="bx-custom-price"> +{formatCurrency(Number(f.price))}</span> : null}
                  </>
                }
                placeholder={f.placeholder}
                value={f.value}
                onChange={(e) => set(e.target.value)}
              />
            );
          case 'textarea':
            return <TextArea key={f.id} {...common} rows={5} placeholder={f.placeholder} value={f.value} onChange={(e) => set(e.target.value)} />;
          case 'date':
            return <TextInput key={f.id} {...common} type="date" min={today} value={f.value} onChange={(e) => set(e.target.value)} />;
          case 'time':
            return (
              <SelectInput
                key={f.id}
                {...common}
                value={f.value}
                onChange={(e) => set(e.target.value)}
                options={[{ label: f.placeholder || 'Please choose time', value: '' }, ...TIME_SLOTS.map((t) => ({ label: t, value: t }))]}
              />
            );
          case 'image':
            return (
              <ImageField
                key={f.id}
                field={f}
                onChange={set}
                productId={selection.product._id}
                csrfToken={selection.product.csrf_token || ''}
              />
            );
          case 'single': {
            const options = (f.options || []).map((opt) => ({ label: optionLabel(opt), value: optionValue(opt) }));
            if (options.length < 8) {
              return (
                <Field key={f.id} label={f.label} required={f.required} error={f.error} className={common.fieldClassName}>
                  <div className="bx-chips" role="radiogroup">
                    {options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={f.value === opt.value}
                        className={cx('bx-chip', f.value === opt.value && 'bx-chip--active')}
                        onClick={() => set(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </Field>
              );
            }
            return (
              <SelectInput
                key={f.id}
                {...common}
                value={f.value}
                onChange={(e) => set(e.target.value)}
                options={[{ label: f.placeholder || 'Please select', value: '' }, ...options]}
              />
            );
          }
          case 'multi':
          case 'checkbox': {
            const values: string[] = Array.isArray(f.value) ? f.value : [];
            return (
              <Field key={f.id} label={f.label} required={f.required} error={f.error} className={common.fieldClassName}>
                <div className="bx-checks">
                  {(f.options || []).map((opt) => {
                    const v = optionValue(opt);
                    return (
                      <label key={v} className="bx-check">
                        <input
                          type="checkbox"
                          checked={values.includes(v)}
                          onChange={(e) => set(e.target.checked ? [...values, v] : values.filter((x) => x !== v))}
                        />
                        <span>{optionLabel(opt)}</span>
                      </label>
                    );
                  })}
                </div>
              </Field>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

export function QuantityPicker({ selection, className }: { selection: ProductSelection; className?: string }) {
  const s = selection;
  const disabled = s.outOfStock || s.comingSoon;
  return (
    <div className={cx('bx-qty', className)} role="group" aria-label="Quantity">
      <button type="button" className="bx-qty-btn" aria-label="Decrease quantity" disabled={disabled} onClick={() => s.setQuantity(s.quantity - 1)}>
        −
      </button>
      <span className="bx-qty-value" aria-live="polite">
        {s.quantity}
      </span>
      <button
        type="button"
        className="bx-qty-btn"
        aria-label="Increase quantity"
        disabled={disabled || (!!s.maxPerOrder && s.quantity >= s.maxPerOrder)}
        onClick={() => s.setQuantity(s.quantity + 1)}
      >
        +
      </button>
    </div>
  );
}

export interface AddToCartLabels {
  add: string;
  checkout: string;
  outOfStock: string;
  comingSoon: string;
  added: string;
}

const DEFAULT_ATC_LABELS: AddToCartLabels = {
  add: 'Add to cart',
  checkout: 'Checkout',
  outOfStock: 'Out of stock',
  comingSoon: 'Coming soon',
  added: 'Added to cart',
};

export interface AddToCartProps {
  product: Product;
  /** Use an existing selection (when you render VariantPicker etc. yourself). */
  selection?: ProductSelection;
  showPrice?: boolean;
  showVariants?: boolean;
  showCustomFields?: boolean;
  showQuantity?: boolean;
  showFlashSale?: boolean;
  showStockAlert?: boolean;
  /** Where the "Checkout" button goes once the line is in the cart. Default `/checkout`. */
  checkoutHref?: string;
  labels?: Partial<AddToCartLabels>;
  onAdded?: (line: CartItem) => void;
  className?: string;
  /** Rendered between the options and the buttons. */
  children?: ReactNode;
}

/** Price + flash-sale strip + variants + custom fields + quantity + add/checkout + back-in-stock. */
export function AddToCart({
  product,
  selection: external,
  showPrice = true,
  showVariants = true,
  showCustomFields = true,
  showQuantity = true,
  showFlashSale = true,
  showStockAlert = true,
  checkoutHref = '/checkout',
  labels,
  onAdded,
  className,
  children,
}: AddToCartProps) {
  const internal = useProductSelection(product);
  const s = external || internal;
  const { store, notify } = useBlanxer();
  const money = useMoney();
  const router = useRouter();
  const l = { ...DEFAULT_ATC_LABELS, ...labels };

  const viewed = useRef('');
  useEffect(() => {
    if (!product?._id || viewed.current === product._id) return;
    viewed.current = product._id;
    trackEvent('ViewContent', {
      content_ids: [product._id],
      content_name: product.name,
      content_type: 'product',
      value: product.price,
      currency: 'NPR',
    });
  }, [product?._id]);

  const onAdd = () => {
    const line = s.addToCart();
    if (!line) return;
    notify({ type: 'success', title: l.added, message: product.name });
    onAdded?.(line);
  };

  return (
    <div className={cx('bx-add-to-cart', className)}>
      {showPrice && !s.noPrice ? (
        <div className="bx-price">
          <span className="bx-price-current">{money(s.price)}</span>
          {s.compareAtPrice > s.price ? <s className="bx-price-compare">{money(s.compareAtPrice)}</s> : null}
          {s.discountPercent > 0 ? <span className="bx-price-badge">{s.discountPercent}% off</span> : null}
        </div>
      ) : null}
      {showFlashSale ? (
        <FlashSaleStrip productId={product._id} productName={product.name} onRules={(r) => s.setMaxPerOrder(r?.max_per_order || 0)} />
      ) : null}
      {showVariants ? <VariantPicker selection={s} /> : null}
      {showCustomFields ? <CustomFields selection={s} /> : null}
      {s.stock != null ? (
        <p className={cx('bx-stock', s.lowStock && 'bx-stock--low')}>{s.stock > 0 ? `${s.stock} in stock` : 'Out of stock'}</p>
      ) : null}
      {children}
      <div className="bx-buy-row">
        {showQuantity ? <QuantityPicker selection={s} /> : null}
        {s.redirect ? (
          <Link href={s.redirect.link} target="_blank" rel="noopener noreferrer" className="bx-button bx-button--primary bx-buy-button">
            {s.redirect.label}
          </Link>
        ) : s.cartLine ? (
          <Button className="bx-buy-button" onClick={() => router.push(checkoutHref)}>
            {l.checkout}
          </Button>
        ) : (
          <Button className="bx-buy-button" disabled={s.outOfStock || s.comingSoon} onClick={onAdd}>
            {s.comingSoon ? l.comingSoon : s.outOfStock ? l.outOfStock : l.add}
          </Button>
        )}
      </div>
      {showStockAlert && s.outOfStock && !s.comingSoon && backInStockEnabled(store) ? (
        <StockAlertForm product={product} variantId={s.variantId} />
      ) : null}
      {s.secondaryRedirect ? (
        <Link href={s.secondaryRedirect.link} target="_blank" rel="noopener noreferrer" className="bx-button bx-button--secondary bx-buy-secondary">
          {s.secondaryRedirect.label}
        </Link>
      ) : null}
    </div>
  );
}
