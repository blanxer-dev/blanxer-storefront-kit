// Shapes of the Blanxer public API that the package relies on. They are loose
// on purpose (`[key: string]: any`): the API returns more than we type, and a
// new backend field must never break a merchant's build.
import type { OrderOffers } from './offers.js';

export type Loose = { [key: string]: any };

export interface StoreCategory extends Loose {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  seo_title?: string;
  seo_description?: string;
  seo_image?: string;
}

export interface StoreCheckoutSettings extends Loose {
  receiver_info?: boolean;
  pan?: boolean;
  company_name?: boolean;
  estimated_delivery?: boolean;
  extras?: {
    checkout_note?: string;
    email_required?: boolean;
    sender_email_required?: boolean;
    allow_customer_cancellation?: boolean;
    [key: string]: any;
  };
}

export interface StorePlugin {
  name: string;
  details: any;
  _id?: string;
}

export interface Store extends Loose {
  _id: string;
  name: string;
  description?: string;
  sub_domain: string;
  custom_domain?: string;
  storefront_url?: string;
  plan?: string;
  checkout?: StoreCheckoutSettings;
  customization?: Loose & {
    brand_name?: string;
    brand_logo?: string;
    favicon?: string;
    theme?: string;
    font?: string;
    currency_indicator?: string;
    top_bar_text?: string;
    top_bar_goto?: string;
    popup_image?: string;
    popup_goto?: string;
    hero_images?: string[];
    hero_taglines?: string[];
    hero_links?: string[];
  };
  navigation?: Loose;
  footer?: Loose;
  categories?: StoreCategory[];
  social?: Loose;
  addons?: Loose;
  setting?: Loose;
  plugins?: StorePlugin[];
  customer_program?: Loose;
  use_advanced_inventory?: boolean;
  blog_categories?: Array<{ name: string; slug: string; _id?: string }>;
  compliance?: Loose;
}

export interface ProductVariant extends Loose {
  _id: string;
  option_name: string;
  price?: number;
  compare_at_price?: number;
  quantity?: number;
  weight?: number;
  sku?: string;
  image_url?: string;
}

export interface Product extends Loose {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  long_description?: string;
  price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  compare_at_price?: number;
  image_urls?: string[];
  colors?: string[];
  sizes?: string[];
  color_name?: string;
  size_name?: string;
  variants?: ProductVariant[];
  quantity?: number;
  weight?: number;
  sku?: string;
  barcode?: string;
  continue_selling?: boolean;
  custom_fields?: any[];
  tags?: string[];
  status?: string;
  channel?: number;
  categories?: string[];
  brand?: Loose | string;
  total_rating?: number;
  review_count?: number;
  reviews?: Loose[];
  seo_title?: string;
  seo_description?: string;
  seo_image?: string;
  csrf_token?: string;
  in_stock?: boolean;
}

export interface ProductsPage {
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    sort_by: string;
    sort_order: string;
  };
  products: Product[];
}

/** `GET /public/delivery_charge/:store_id`. `places` rows are
 * `[name, cod, ≤1kg, ≤2kg, ≤3kg, ≤5kg, ≤10kg, >10kg]`; `-1` means "use the default". */
export interface DeliveryTable {
  defaults: number[];
  places: Array<[string, boolean | string, ...number[]]> | any[][];
}

export interface Coupon extends Loose {
  _id: string;
  code: string;
  coupon_type: 1 | 2 | 3 | number;
  coupon_value: number;
  max_discount_amount: number;
  min_order_value: number;
  total_applicable_amount: number;
  only_for_cod_payment?: boolean;
  only_for_online_payment?: boolean;
  places?: string[];
}

/** One cart line. Same shape the Blanxer storefront keeps in localStorage `cart_items`. */
export interface CartItem {
  id: string;
  product: string;
  product_name: string;
  price: number;
  compare_at_price: number;
  quantity: number;
  weight: number;
  variant: string;
  variant_name: string;
  image_url: string;
  custom_fields: string[];
  customization_charge?: number;
  delivery_charge?: number;
  sku?: string;
  slug?: string;
  print?: { id: string; name: string; image_url: string; area: any };
}

export type PaymentMethodName =
  | 'COD'
  | 'QR'
  | 'QR_Dynamic'
  | 'QR_Static'
  | 'FonepayCheckout'
  | 'Esewa'
  | 'FonePay'
  | 'Khalti'
  | 'NPX'
  | 'nbank_card'
  | 'Card';

export interface PaymentMethod {
  name: PaymentMethodName;
  display_name: string;
}

/** Meta Purchase payload returned by create-order: the browser pixel fires
 * Purchase with exactly these values; the server sends its own with the same id. */
export interface OrderPurchaseMeta {
  purchase_event_id: string;
  value: number;
  currency: string;
  content_type?: string;
  content_ids: string[];
  contents: { id: string; quantity: number; item_price: number }[];
  num_items: number;
  order_id: string;
}

export interface OrderResponse extends Loose {
  _id?: string;
  /** Meta Purchase payload (backends from 2026-10). */
  meta?: OrderPurchaseMeta;
  order_number?: number | string;
  total_price?: number;
  delivery_charge?: number;
  hold_seconds?: number;
  hold_expires_at?: string;
  /** What the offers did (stores on Offers): applications, the code result, totals. */
  offers?: OrderOffers;
  /** Present (and `_id` absent) when the backend accepted a test order
   * (phone `0000000000` / mailinator email) without creating it. */
  success?: boolean;
}

export interface FlashSale {
  _id: string;
  name: string;
  status: 'live' | 'upcoming';
  start_at: string;
  end_at: string;
  max_per_order: number;
  show_countdown: boolean;
  show_stock_left: boolean;
  sold_out: boolean;
  offer_price_from?: number | null;
}

export interface FlashSaleForProduct {
  server_time: string;
  sale: FlashSale | null;
  units: { available: number; in_checkout: number } | null;
}
