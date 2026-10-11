'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { STORAGE_KEYS, normalizeApiBase } from '../core/config.js';
import { pluginMap, storeThemeColor } from '../core/store.js';
import type { Store } from '../core/types.js';
import { configureClient, initMetaCapi, pingAnalytics } from '../client/index.js';
import { CartProvider } from './cart.js';
import { BlanxerContext, type Notice } from './context.js';

/** CSS variables the package's `bx-*` styles read. Anything you leave out keeps its default. */
export interface BlanxerTheme {
  /** Brand colour (buttons, selected states). Default: the store's Blanxer theme colour. */
  primary?: string;
  /** Text colour on primary. Default #fff. */
  primaryContrast?: string;
  /** Page background / text. */
  background?: string;
  foreground?: string;
  /** Secondary text. */
  muted?: string;
  border?: string;
  /** Error / success colours. */
  danger?: string;
  success?: string;
  /** Corner radius, e.g. '8px'. */
  radius?: string;
  /** Font family for package components (default: inherit). */
  fontFamily?: string;
}

const VAR: Record<keyof BlanxerTheme, string> = {
  primary: '--bx-primary',
  primaryContrast: '--bx-primary-contrast',
  background: '--bx-bg',
  foreground: '--bx-fg',
  muted: '--bx-muted',
  border: '--bx-border',
  danger: '--bx-danger',
  success: '--bx-success',
  radius: '--bx-radius',
  fontFamily: '--bx-font',
};

const cssVars = (t: BlanxerTheme) =>
  (Object.keys(t) as (keyof BlanxerTheme)[])
    .filter((k) => t[k])
    .map((k) => `${VAR[k]}:${String(t[k]).replace(/[;{}<>]/g, '')}`)
    .join(';');

export interface BlanxerProviderProps {
  /** Store from `getClientStore()` (server). Don't pass the raw `getStore()` document to the browser. */
  store: Store;
  /** API base, normally `apiBase()` from `@blanxer-dev/storefront/server`. Default https://api.blanxer.com. */
  apiBase?: string;
  /** Override the CSS variables (see BlanxerTheme). */
  theme?: BlanxerTheme;
  /** Replace the built-in toasts with your own (e.g. sonner). */
  notify?: (n: Notice) => void;
  children: ReactNode;
}

/**
 * Root client provider: store context, the cart (CartProvider), API base for
 * browser calls, `?promo=` capture, the Blanxer session ping, the Meta CAPI
 * switch, theme variables and toasts.
 */
export function BlanxerProvider({ store, apiBase, theme, notify, children }: BlanxerProviderProps) {
  const base = normalizeApiBase(apiBase);
  // Set synchronously so effects in children already use the right base.
  configureClient({ apiBase: base });
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Array<Notice & { id: number }>>([]);
  const seq = useRef(0);

  const builtInNotify = useCallback((n: Notice) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { ...n, id }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), n.type === 'error' ? 6000 : 3500);
  }, []);
  const doNotify = notify || builtInNotify;

  useEffect(() => {
    if (!store?._id) return;
    pingAnalytics(store._id);
    initMetaCapi({ enabled: pluginMap(store).has('meta_capi'), store_id: store._id });
  }, [store?._id]);

  // `?promo=CODE` anywhere on the site is remembered and auto-applied at checkout.
  useEffect(() => {
    try {
      const promo = new URLSearchParams(window.location.search).get('promo');
      if (promo) localStorage.setItem(STORAGE_KEYS.promoCode, promo);
    } catch {
      /* ignore */
    }
  }, [pathname]);

  const value = useMemo(
    () => ({ store, storeId: store?._id, apiBase: base, notify: doNotify }),
    [store, base, doNotify],
  );

  const defaults = cssVars({ primary: storeThemeColor(store) });
  const overrides = theme ? cssVars(theme) : '';

  return (
    <BlanxerContext.Provider value={value}>
      <style
        // Store colour at zero specificity (your CSS wins); `theme` prop wins over both.
        dangerouslySetInnerHTML={{
          __html: `:where(:root){${defaults}}${overrides ? `:root{${overrides}}` : ''}`,
        }}
      />
      <CartProvider>{children}</CartProvider>
      {!notify && toasts.length > 0 ? (
        <div className="bx-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`bx-toast bx-toast--${t.type}`}>
              <p className="bx-toast-title">{t.title}</p>
              {t.message ? <p className="bx-toast-message">{t.message}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </BlanxerContext.Provider>
  );
}
