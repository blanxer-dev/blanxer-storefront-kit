import type { Store, StorePlugin } from './types.js';

/** Primary colour (Mantine shade 6) for each named Blanxer theme. */
export const THEME_COLORS: Record<string, string> = {
  dark: '#2e2e2e',
  gray: '#868e96',
  red: '#fa5252',
  oliz_red: '#db272a',
  pink: '#e64980',
  baby_pink: '#ffa5c2',
  grape: '#be4bdb',
  violet: '#7950f2',
  indigo: '#4c6ef5',
  blue: '#228be6',
  cyan: '#15aabf',
  teal: '#12b886',
  green: '#40c057',
  lime: '#82c91e',
  yellow: '#fab005',
  orange: '#fd7e14',
  brown: '#816a4d',
  blanxer_purple: '#8830f7',
  blanxer_red: '#ed1520',
  blanxer_blue: '#007ace',
  blanxer_green: '#01b859',
};

/** The store's brand colour as a hex string (`custom#c26e19` → `#c26e19`; named themes mapped; default violet). */
export const storeThemeColor = (store?: Partial<Store> | null): string => {
  const theme = String(store?.customization?.theme || 'violet');
  if (theme.startsWith('custom#')) return theme.slice(6);
  return THEME_COLORS[theme] || THEME_COLORS.violet!;
};

export const storeName = (store?: Partial<Store> | null): string =>
  store?.customization?.brand_name || store?.name || '';

export const storeFont = (store?: Partial<Store> | null): string => String(store?.customization?.font || 'Poppins');

export const currencyLabel = (store?: Partial<Store> | null): string =>
  String(store?.customization?.currency_indicator || 'Rs.');

export const pluginMap = (store?: Partial<Store> | null): Map<string, any> => {
  const m = new Map<string, any>();
  for (const p of (store?.plugins || []) as StorePlugin[]) if (p?.name) m.set(p.name, p.details);
  return m;
};

const yes = (v: unknown) => (v ? 'yes' : '');

/** Plugins whose details are safe and needed in the browser. Everything else
 * (tokens for third-party integrations) stays on the server. `offers` carries only
 * `{ enabled, display }` (how offers look; never offer rules). */
const BROWSER_PLUGINS = ['fb_pixel', 'ga', 'gtm', 'meta_tags', 'meta_capi', 'clarity', 'whatsapp_chat', 'product_custom_options', 'offers'];

/** What of a plugin's details may reach the browser. */
const browserDetails = (p: StorePlugin) => {
  if (p.name === 'meta_capi') return true;
  if (p.name === 'offers') return { enabled: p.details?.enabled !== false, display: p.details?.display || {} };
  return p.details;
};

/**
 * The part of the store document the browser needs (checkout settings,
 * payment switches, branding). Drops gateway/plugin tokens and other
 * server-only fields so they never land in the page HTML. Pass this — not the
 * full store — to `<BlanxerProvider store>`.
 */
export const toClientStore = (store: Store): Store => {
  const s = store.setting || {};
  return {
    _id: store._id,
    name: store.name,
    description: store.description || '',
    sub_domain: store.sub_domain,
    custom_domain: store.custom_domain || '',
    storefront_url: store.storefront_url || '',
    plan: store.plan,
    checkout: store.checkout || {},
    customization: store.customization || {},
    categories: store.categories || [],
    social: store.social || {},
    addons: store.addons || {},
    // Only the three switches checkout reads, as 'yes' | '' (the API already masks them).
    setting: {
      esewa_secret: yes(s.esewa_secret),
      fonepay_dynamic_key: yes(s.fonepay_dynamic_key),
      fonepay_checkout_key: yes(s.fonepay_checkout_key),
    },
    plugins: (store.plugins || [])
      .filter((p) => BROWSER_PLUGINS.includes(p.name))
      .map((p) => ({ name: p.name, details: browserDetails(p) })),
    customer_program: {
      back_in_stock: { enabled: !!store.customer_program?.back_in_stock?.enabled },
    },
    use_advanced_inventory: !!store.use_advanced_inventory,
    blog_categories: store.blog_categories || [],
    navigation: store.navigation || {},
    footer: store.footer || {},
  };
};

/** Back-in-stock alerts on (Customer program → back in stock). */
export const backInStockEnabled = (store?: Partial<Store> | null): boolean =>
  !!store?.customer_program?.back_in_stock?.enabled;

/** Stock display options from the `product_custom_options` plugin. */
export const stockDisplayOptions = (store?: Partial<Store> | null) => {
  const d = pluginMap(store).get('product_custom_options') || {};
  return { showStock: !!d.showProductStock, lowStockAt: Number(d.outOfStockBaseValue) || 0 };
};
