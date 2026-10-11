'use client';
/**
 * Cart, ported from the Blanxer storefront `cart.context.tsx`: lines live in
 * localStorage `cart_items`, the per-line checkbox selection in
 * `cart_selection`. Checkout orders the selected lines only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../core/config.js';
import { cartTotals } from '../core/cart.js';
import { contentId } from '../core/order.js';
import type { CartItem } from '../core/types.js';
import { trackEvent } from '../client/index.js';

const readJSON = (key: string): any => {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const readStoredSelection = (): Set<string> => {
  const arr = readJSON(STORAGE_KEYS.cartSelection);
  return Array.isArray(arr) ? new Set<string>(arr) : new Set();
};

const readStoredCartIds = (): Set<string> => {
  const arr = readJSON(STORAGE_KEYS.cart);
  return Array.isArray(arr) ? new Set<string>(arr.map((el: any) => el?.id).filter(Boolean)) : new Set();
};

export interface CartContextValue {
  /** All lines. */
  items: CartItem[];
  /** Lines the shopper has ticked (what checkout orders). */
  selectedItems: CartItem[];
  selectedIds: Set<string>;
  /** True once the cart has been read from localStorage. */
  hydrated: boolean;
  /** Drawer visibility, if your design has a cart drawer. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Σ(price + customization) × qty over all lines. */
  totalPrice: number;
  /** Same, over the selected lines. */
  selectedTotalPrice: number;
  /** Number of units in the cart. */
  count: number;
  addToCart: (item: CartItem) => void;
  addManyToCart: (items: CartItem[]) => void;
  /** Decrease by one (removes the line at quantity 1). */
  removeFromCart: (item: Pick<CartItem, 'id' | 'product' | 'variant'>) => void;
  /** Remove a line whatever its quantity. */
  removeLine: (id: string) => void;
  setQuantity: (item: Pick<CartItem, 'id' | 'product' | 'variant'> & { quantity: number }) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  /** Remove the selected (just-ordered) lines; resets the cart if nothing else is left. */
  removeSelectedFromCart: () => void;
  resetCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const v = useContext(CartContext);
  if (!v) throw new Error('[@blanxer/storefront] useCart() needs <BlanxerProvider> (or <CartProvider>) above it.');
  return v;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const seenIds = useRef<Set<string>>(new Set());

  // Hydrate from localStorage after mount (SSR-safe).
  useEffect(() => {
    const stored = readJSON(STORAGE_KEYS.cart);
    seenIds.current = readStoredCartIds();
    setSelectedIds(readStoredSelection());
    if (Array.isArray(stored)) setItems(stored);
    setHydrated(true);
  }, []);

  // Other tabs: keep in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.cart) {
        const next = readJSON(STORAGE_KEYS.cart);
        setItems(Array.isArray(next) ? next : []);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const save = (lines: CartItem[]) => {
    try {
      localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(lines));
    } catch {
      /* storage full / blocked */
    }
  };

  const selectId = (id: string) => {
    if (!id) return;
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const resetCart = useCallback(() => {
    setItems([]);
    setOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEYS.cart);
      localStorage.removeItem(STORAGE_KEYS.cartSelection);
    } catch {
      /* ignore */
    }
    seenIds.current = new Set();
    setSelectedIds(new Set());
  }, []);

  const removeSelectedFromCart = () => {
    const remaining = items.filter((el) => !selectedIds.has(el.id));
    if (selectedIds.size === 0 || remaining.length === 0) {
      resetCart();
      return;
    }
    setItems(remaining);
    save(remaining);
    const remainingIds = new Set(remaining.map((el) => el.id));
    seenIds.current = remainingIds;
    setSelectedIds((prev) => new Set([...prev].filter((id) => remainingIds.has(id))));
  };

  const setQuantity: CartContextValue['setQuantity'] = (payload) => {
    const key = payload.id || `${payload.product}_${payload.variant}`;
    if (!items.find((el) => el.id === key)) return;
    let next: CartItem[];
    if (payload.quantity >= 1) {
      next = items.map((el) => (el.id === key ? { ...el, quantity: payload.quantity } : el));
      selectId(key);
    } else {
      next = items.filter((el) => el.id !== key);
    }
    setItems(next);
    save(next);
  };

  const removeFromCart: CartContextValue['removeFromCart'] = (payload) => {
    const key = payload.id || `${payload.product}_${payload.variant}`;
    const hit = items.find((el) => el.id === key);
    if (!hit) return;
    const next =
      hit.quantity > 1
        ? items.map((el) => (el.id === key ? { ...el, quantity: el.quantity - 1 } : el))
        : items.filter((el) => el.id !== key);
    if (hit.quantity > 1) selectId(key);
    setItems(next);
    save(next);
  };

  const removeLine = (id: string) => {
    const next = items.filter((el) => el.id !== id);
    setItems(next);
    save(next);
  };

  const addManyToCart = (payloads: CartItem[]) => {
    let next = [...items];
    const ts = Date.now();
    payloads.forEach((p, i) => {
      // lines with custom fields never merge
      const key = p.custom_fields?.length ? `${p.product}_${p.variant}_${ts}_${i}` : `${p.product}_${p.variant}`;
      const hit = next.find((el) => el.id === key);
      next = hit
        ? next.map((el) => (el.id === key ? { ...el, quantity: el.quantity + (p.quantity || 1) } : el))
        : [...next, { ...p, id: key, quantity: p.quantity || 1 }];
    });
    setItems(next);
    setOpen(true);
    save(next);
  };

  const addToCart = (payload: CartItem) => {
    const key = payload.id || `${payload.product}_${payload.variant}`;
    const hit = items.find((el) => el.id === key);
    trackEvent('AddToCart', {
      content_name: payload.product_name,
      content_ids: [contentId(payload)],
      content_type: 'product',
      value: payload.price,
      currency: 'NPR',
    });
    const next = hit
      ? items.map((el) => (el.id === key ? { ...el, quantity: el.quantity + (payload.quantity || 1) } : el))
      : [...items, { ...payload, id: key, quantity: payload.quantity || 1 }];
    setItems(next);
    setOpen(true);
    selectId(key);
    save(next);
  };

  // Newly added lines are auto-selected; lines restored on reload keep their state.
  useEffect(() => {
    if (!hydrated || items.length === 0) return;
    const current = new Set(items.map((el) => el.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      items.forEach((el) => {
        if (!seenIds.current.has(el.id)) next.add(el.id);
      });
      for (const id of next) if (!current.has(id)) next.delete(id);
      return next;
    });
    seenIds.current = current;
  }, [items, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEYS.cartSelection, JSON.stringify([...selectedIds]));
    } catch {
      /* ignore */
    }
  }, [selectedIds, hydrated]);

  // Opening the cart (drawer) defaults to everything selected, as on the storefront.
  useEffect(() => {
    if (open) setSelectedIds(new Set(items.map((el) => el.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectAll = useCallback(() => setSelectedIds(new Set(items.map((el) => el.id))), [items]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedItems = useMemo(() => items.filter((el) => selectedIds.has(el.id)), [items, selectedIds]);
  const totals = useMemo(() => cartTotals(items), [items]);
  const selectedTotals = useMemo(() => cartTotals(selectedItems), [selectedItems]);

  const value: CartContextValue = {
    items,
    selectedItems,
    selectedIds,
    hydrated,
    open,
    setOpen,
    totalPrice: totals.total,
    selectedTotalPrice: selectedTotals.total,
    count: totals.items,
    addToCart,
    addManyToCart,
    removeFromCart,
    removeLine,
    setQuantity,
    toggleSelection,
    selectAll,
    deselectAll,
    removeSelectedFromCart,
    resetCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
