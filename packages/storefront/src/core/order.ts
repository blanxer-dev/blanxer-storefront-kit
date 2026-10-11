import type { CartItem, Store } from './types.js';

/** The checkout form values (same keys the storefront form uses). */
export interface CheckoutFormValues {
  sender_full_name?: string;
  sender_email?: string;
  sender_phone_number?: string;
  pan?: string;
  company_name?: string;
  delivery_date?: string;
  customer_full_name: string;
  customer_email: string;
  customer_phone_number: string;
  customer_alt_phone_number: string;
  customer_address: string;
  customer_address_landmark: string;
  customer_address_city: string;
  order_note: string;
  [key: string]: string | undefined;
}

export interface OrderMeta {
  event_id: string;
  fbp?: string;
  fbc?: string;
  event_source_url?: string;
}

/** A cart line's custom fields count only if at least one entry is non-empty. */
export const hasCustomFields = (cf: string[] = []): boolean => cf.some((el) => !!el && el.length > 0);

/** Initial form values for a store (optional sections only when the store turns them on). */
export const initialCheckoutValues = (store?: Partial<Store> | null): CheckoutFormValues => ({
  ...(store?.checkout?.receiver_info && { sender_email: '', sender_full_name: '', sender_phone_number: '' }),
  ...(store?.checkout?.pan && { pan: '' }),
  ...(store?.checkout?.company_name && { company_name: '' }),
  ...(store?.checkout?.estimated_delivery && { delivery_date: '' }),
  customer_email: '',
  customer_full_name: '',
  customer_phone_number: '',
  customer_alt_phone_number: '',
  customer_address: '',
  customer_address_landmark: '',
  customer_address_city: '',
  order_note: '',
});

export interface BuildOrderInput {
  store: Partial<Store>;
  lines: CartItem[];
  values: CheckoutFormValues;
  paymentMethod: string;
  /** The site's own origin (`window.location.origin`). Gateways return to `<url>/payment/success|failed`. */
  url: string;
  /** Coupon `_id` when the applied coupon is currently valid, else ''. Never the code. */
  couponId?: string;
  meta?: OrderMeta;
}

/**
 * `POST /order/:store_id` body, field for field as the Blanxer storefront
 * (`src/features/checkout/index.tsx` on main cabd695) sends it.
 */
export const buildOrderPayload = ({ store, lines, values, paymentMethod, url, couponId, meta }: BuildOrderInput) => {
  const payload: Record<string, any> = {
    products: lines.map((el) => ({
      product: el.product,
      variant: el.variant,
      quantity: el.quantity,
      ...(el.customization_charge ? { customization_charge: el.customization_charge } : {}),
      ...(hasCustomFields(el.custom_fields) ? { custom_fields: el.custom_fields } : {}),
      ...(el.print?.id ? { print_id: el.print.id } : {}),
    })),
    ...(meta ? { meta } : {}),
    ...(store?.checkout?.receiver_info && {
      sender_email: values.sender_email,
      sender_full_name: values.sender_full_name,
      sender_phone_number: values.sender_phone_number,
    }),
    customer_email: values.customer_email,
    customer_full_name: values.customer_full_name,
    customer_phone_number: values.customer_phone_number,
    customer_alt_phone_number: values.customer_alt_phone_number,
    customer_address: values.customer_address,
    customer_address_landmark: values.customer_address_landmark,
    customer_address_city: values.customer_address_city,
    order_note: values.order_note,
    delivery_date: values.delivery_date,
    pan: values.pan,
    company_name: values.company_name,
    paymentMethod,
    url,
    coupon: couponId || '',
  };
  // JSON.stringify drops undefined; do it here too so the object equals what goes on the wire.
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return payload;
};

/** Meta catalog content id: `${product}_${variant}` for variant lines, else the product id. */
export const contentId = (line: { product: string; variant?: string }): string =>
  line.variant ? `${line.product}_${line.variant}` : line.product;
