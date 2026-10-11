let formatter: Intl.NumberFormat | null = null;

/** Same as the storefront: `en-IN` grouping, no currency symbol (prefix optional). */
export const formatCurrency = (amount: number, prefix = ''): string => {
  if (!formatter) formatter = new Intl.NumberFormat('en-IN');
  return prefix + formatter.format(Number.isFinite(amount) ? amount : 0);
};

export const ensureNumber = (val: any, baseValue = 0): number => {
  if (val === undefined || val === null || val === '') return baseValue;
  if (typeof val === 'string' && val.trim() === '') return baseValue;
  const num = Number(val);
  return Number.isNaN(num) ? baseValue : num;
};

/** "% OFF" badge value; 0 when there is no real discount. */
export const discountPercent = (price: any, compareAtPrice: any): number => {
  const p = ensureNumber(price);
  const c = ensureNumber(compareAtPrice);
  if (c <= 0 || p >= c) return 0;
  return Math.round(((c - p) * 100) / c);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-11` → `Oct 11, 2026` (dayjs `MMM DD, YYYY`, as the storefront sends it). */
export const formatDateLabel = (value: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return String(value || '');
  return `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]}`;
};

/** Today's date as `YYYY-MM-DD` in local time (min= for date inputs). */
export const todayISODate = (now: Date = new Date()): string => {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const initials = (name = ''): string =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
