import { ensureNumber } from './format.js';
import type { Product, ProductVariant } from './types.js';

export const COLOR_CODE_SEPARATOR = '|';

/** `["Red:#f00", "Blue"]` → names `["Red","Blue"]`, codes `["#f00",""]` (positional). */
export const splitColorCodeFromColor = (colors: string[] = []) => {
  const names: string[] = [];
  const codes: string[] = [];
  for (const c of colors || []) {
    const idx = String(c).indexOf(':');
    names.push(idx === -1 ? c : c.slice(0, idx));
    codes.push(idx === -1 ? '' : c.slice(idx + 1));
  }
  return { colors: names, codes };
};

/** `#3b3b32|#e8a200` → `{ primary, secondary }`. */
export const parseColorCode = (code = '') => {
  const [primary = '', secondary = ''] = String(code || '')
    .split(COLOR_CODE_SEPARATOR)
    .map((p) => p.trim());
  return { primary, secondary };
};

/** Resolve `<color>/<size>` against the known lists (both halves may contain `/`). */
export const splitVariantOptionName = (
  optionName: string,
  colors: string[] = [],
  sizes: string[] = [],
): { color: string; size: string } | null => {
  const name = String(optionName || '');
  if (!name) return null;
  const byLongest = [...colors].sort((a, b) => b.length - a.length);
  for (const c of byLongest) {
    if (!c || !name.startsWith(`${c}/`)) continue;
    const rest = name.slice(c.length + 1);
    if (sizes.includes(rest)) return { color: c, size: rest };
  }
  const idx = name.indexOf('/');
  if (idx > 0) return { color: name.slice(0, idx), size: name.slice(idx + 1) };
  return null;
};

/** Variant `option_name` for a colour/size pick. */
export const variantName = (hasColors: boolean, hasSizes: boolean, color: string, size: string): string => {
  if (hasColors && hasSizes) return `${color}/${size}`;
  if (hasSizes) return `${size}`;
  if (hasColors) return `${color}`;
  return '';
};

export interface ProductOptions {
  colors: string[];
  colorCodes: string[];
  sizes: string[];
  hasColors: boolean;
  hasSizes: boolean;
}

export const productOptions = (product?: Partial<Product> | null): ProductOptions => {
  const { colors, codes } = splitColorCodeFromColor(product?.colors || []);
  // Detail responses already blank colours/sizes for products without variants.
  const sizes = product?.sizes || [];
  return { colors, colorCodes: codes, sizes, hasColors: colors.length > 0, hasSizes: sizes.length > 0 };
};

export const findVariant = (
  product: Partial<Product> | null | undefined,
  color: string,
  size: string,
): ProductVariant | undefined => {
  const o = productOptions(product);
  if (!o.hasColors && !o.hasSizes) return undefined;
  const name = variantName(o.hasColors, o.hasSizes, color, size);
  return (product?.variants || []).find((v) => v?.option_name === name);
};

/** Starting colour/size: `?color=` when the product has it, else the first valid variant. */
export const initialSelection = (product: Partial<Product> | null | undefined, queryColor = ''): { color: string; size: string } => {
  const o = productOptions(product);
  const firstColor = o.hasColors ? o.colors[0]! : '';
  const firstSize = o.hasSizes ? o.sizes[0]! : '';
  const wanted = queryColor ? o.colors.find((c) => c.toLowerCase() === queryColor.toLowerCase()) || '' : '';
  const variants = product?.variants || [];

  if (!o.hasColors || !o.hasSizes || !variants.length) return { color: wanted || firstColor, size: firstSize };
  if (wanted) {
    for (const v of variants) {
      const p = splitVariantOptionName(v.option_name || '', o.colors, o.sizes);
      if (p?.color === wanted) return { color: wanted, size: p.size };
    }
    return { color: wanted, size: firstSize };
  }
  if (variants.some((v) => v.option_name === `${firstColor}/${firstSize}`)) return { color: firstColor, size: firstSize };
  for (const c of o.colors) {
    for (const v of variants) {
      const p = splitVariantOptionName(v.option_name || '', o.colors, o.sizes);
      if (p?.color === c) return { color: c, size: p.size };
    }
  }
  return { color: firstColor, size: firstSize };
};

/** Sizes that exist as a variant for the given colour. */
export const sizesForColor = (product: Partial<Product> | null | undefined, color: string): string[] => {
  const o = productOptions(product);
  if (!o.hasColors || !o.hasSizes) return o.sizes;
  const valid = new Set<string>();
  for (const v of product?.variants || []) {
    const p = splitVariantOptionName(v.option_name || '', o.colors, o.sizes);
    if (p?.color === color) valid.add(p.size);
  }
  return o.sizes.filter((s) => valid.has(s));
};

/**
 * Out of stock for the wanted quantity. Advanced inventory: stock is the
 * limit. Simple inventory: stock is the limit unless "continue selling" is on.
 */
export const isOutOfStock = (
  product: Partial<Product> | null | undefined,
  variant: Partial<ProductVariant> | undefined,
  quantity: number,
  advancedInventory: boolean,
): boolean => {
  const o = productOptions(product);
  const stock = o.hasColors || o.hasSizes ? (variant?.quantity as number) : (product?.quantity as number);
  // Same comparison as the storefront: a missing stock value never blocks.
  const short = (stock as number) < quantity;
  return advancedInventory ? short : !product?.continue_selling && short;
};

/** Price/compare price for a selection (variant values win when set). */
export const selectionPrice = (product: Partial<Product> | null | undefined, variant?: Partial<ProductVariant>) => {
  const o = productOptions(product);
  if (o.hasColors || o.hasSizes) {
    return {
      price: ensureNumber(variant?.price ? variant.price : product?.price),
      compareAtPrice: ensureNumber(variant?.compare_at_price ?? 0),
    };
  }
  return { price: ensureNumber(product?.price), compareAtPrice: ensureNumber(product?.compare_at_price) };
};

/** Price to show on a product card: `price`, or the `min_price` of a variant product. */
export const listPrice = (p: Partial<Product>): { price: number; maxPrice: number; compareAtPrice: number } => {
  const variants = p.variants || [];
  const fromVariants = variants.map((v) => ensureNumber(v.price)).filter((n) => n > 0);
  const price =
    p.price != null && ensureNumber(p.price) > 0
      ? ensureNumber(p.price)
      : ensureNumber(p.min_price, fromVariants.length ? Math.min(...fromVariants) : 0);
  const maxPrice = ensureNumber(p.max_price, fromVariants.length ? Math.max(...fromVariants) : price);
  let compareAtPrice = ensureNumber(p.compare_at_price);
  if (!compareAtPrice && variants.length) {
    const v = variants.find((x) => ensureNumber(x.price) === price);
    compareAtPrice = ensureNumber(v?.compare_at_price);
  }
  return { price, maxPrice: Math.max(maxPrice, price), compareAtPrice };
};

/** `rd_<Label>_<Link>` / `ard_<Label>_<Link>` tags (`+` = space in the label). */
export const parseRedirectTag = (tags: string[] = [], prefix: 'rd_' | 'ard_'): { label: string; link: string } | null => {
  const tag = (tags || []).find((t) => String(t || '').startsWith(prefix));
  if (!tag) return null;
  const parts = String(tag).split('_');
  const label = (parts[1] || '').replace(/\+/g, ' ');
  const link = parts.slice(2).join('_');
  return label && link ? { label, link } : null;
};

export const productTags = (p?: Partial<Product> | null) => ({
  comingSoon: !!p?.tags?.includes('coming_soon'),
  noPrice: !!p?.tags?.includes('no_price'),
});
