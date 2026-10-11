// Same rules and messages as the storefront's validation helper.
const PHONE_RE = /^[0-9]{10}$/;
const EMAIL_RE =
  /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

export const isValidPhone = (val: unknown): boolean => PHONE_RE.test(String(val ?? ''));
export const isValidEmail = (val: unknown): boolean => EMAIL_RE.test(String(val ?? ''));

/** Each returns `null` when valid, else the error message. */
export const validation = {
  required: (val: any, msg?: string) => (val?.length > 0 ? null : msg ?? 'This field is required'),
  phone: (val: any, msg?: string) => (isValidPhone(val) ? null : msg ?? 'Invalid phone number'),
  /** Empty passes; anything typed must be a valid 10-digit number. */
  optionalPhone: (val: any, msg?: string) => {
    if (!String(val ?? '').trim()) return null;
    return isValidPhone(val) ? null : msg ?? 'Invalid phone number';
  },
  email: (val: any, msg?: string) => (isValidEmail(val) ? null : msg ?? 'Invalid email address'),
  /** Empty passes; anything typed must be a valid email. */
  optionalEmail: (val: any, msg?: string) => {
    if (!String(val ?? '').trim()) return null;
    return isValidEmail(val) ? null : msg ?? 'Invalid email address';
  },
};
