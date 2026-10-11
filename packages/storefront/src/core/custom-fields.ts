import { formatDateLabel } from './format.js';

/** Custom field types a product can carry (`product.custom_fields` rows). */
export type CustomFieldType =
  | 'text'
  | 'text_dp'
  | 'textarea'
  | 'image'
  | 'date'
  | 'time'
  | 'single'
  | 'multi'
  | 'checkbox';

export interface CustomFieldDef {
  type: CustomFieldType | string;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: Array<string | { label: string; value: string }>;
  /** Extra charge for `text_dp` when filled. */
  price?: number | string;
}

export interface CustomFieldState extends CustomFieldDef {
  id: string;
  value: any;
  error: string;
}

/** Time slots for `time` fields (store-specific slots are not supported). */
export const TIME_SLOTS = ['8AM - 10AM', '10AM - 12PM', '12PM - 2PM', '2PM - 4PM', '4PM - 6PM', '6PM - 8PM', '8PM - 10PM'];
export const SELECT_TYPES = ['single', 'multi', 'checkbox'];

/** `product.custom_fields` is `[type, label, required, placeholder, options, price][]`. */
export const extractCustomFields = (product: { custom_fields?: any[] } | null | undefined): CustomFieldDef[] =>
  (product?.custom_fields || []).map((el: any) => ({
    type: el?.[0],
    label: el?.[1],
    required: !!el?.[2],
    placeholder: el?.[3],
    options: el?.[4],
    price: el?.[5],
  }));

export const optionValue = (opt: string | { label: string; value: string }): string =>
  typeof opt === 'string' ? opt : opt.value;
export const optionLabel = (opt: string | { label: string; value: string }): string =>
  typeof opt === 'string' ? opt : opt.label;

export const customFieldDefault = (f: CustomFieldDef): any => {
  if (['multi', 'checkbox'].includes(f.type)) return [];
  if (f.type === 'single' && f.options?.length) return optionValue(f.options[0]!);
  return '';
};

let seq = 0;
export const initCustomFieldState = (defs: CustomFieldDef[]): CustomFieldState[] =>
  defs.map((d) => ({ ...d, id: `cf_${++seq}`, value: customFieldDefault(d), error: '' }));

const isEmptyValue = (v: any) => (Array.isArray(v) ? v.length === 0 : !v);

/** Marks required-but-empty fields. Returns the new state and whether all are valid. */
export const validateCustomFields = (state: CustomFieldState[]): { state: CustomFieldState[]; valid: boolean } => {
  const next = state.map((el) => ({
    ...el,
    error: el.required && isEmptyValue(el.value) ? 'This field is required' : '',
  }));
  return { state: next, valid: next.every((el) => !el.error) };
};

export const formatCustomFieldValue = (f: Pick<CustomFieldState, 'type' | 'value'>): string => {
  if (Array.isArray(f.value)) return f.value.join(', ');
  if (f.type === 'date') return formatDateLabel(f.value);
  return String(f.value ?? '');
};

/** Filled fields as `label|||type|||value` strings — the format the order API stores. */
export const serializeCustomFields = (state: Pick<CustomFieldState, 'label' | 'type' | 'value'>[]): string[] =>
  state
    .filter((el) => (Array.isArray(el.value) ? el.value.length : el.value))
    .map((el) => `${el.label}|||${el.type}|||${formatCustomFieldValue(el)}`);

/** Extra per-unit charge: the price of every filled `text_dp` field. */
export const customizationCharge = (state: Pick<CustomFieldState, 'type' | 'value' | 'price'>[]): number =>
  state
    .filter((el) => el.type === 'text_dp' && el.value && el.price)
    .reduce((sum, el) => sum + Number(el.price || 0), 0);

/** Select-type fields first (stable), as the storefront renders them. */
export const sortCustomFields = <T extends { type: string }>(state: T[]): T[] =>
  [...state].sort((a, b) => {
    const as = SELECT_TYPES.includes(a.type);
    const bs = SELECT_TYPES.includes(b.type);
    return as === bs ? 0 : as ? -1 : 1;
  });
