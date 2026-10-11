/** Error thrown for any non-2xx Blanxer API response. `fields` carries zod
 * field errors (`{ customer_phone_number: 'Phone number must be of 10 digit' }`). */
export class BlanxerApiError extends Error {
  status: number;
  fields: Record<string, string>;
  body: any;

  constructor(status: number, body: any, url: string) {
    const message =
      (body && typeof body === 'object' && typeof body.message === 'string' && body.message) ||
      (typeof body === 'string' && body.slice(0, 200)) ||
      `Blanxer API ${status} for ${url}`;
    super(message);
    this.name = 'BlanxerApiError';
    this.status = status;
    this.body = body;
    this.fields = (body && typeof body === 'object' && body.fields) || {};
  }
}

/** Message for one form field, or '' (mirrors the storefront's decodeErrorMessage). */
export const fieldError = (err: unknown, field: string): string => {
  const fields = (err as any)?.fields || (err as any)?.body?.fields;
  if (fields && typeof fields === 'object' && field in fields) return String(fields[field] || '');
  return '';
};

/** Generic message for a failed call: the API's `message`, else the first field error. */
export const errorMessage = (err: unknown, fallback = 'Something went wrong. Please try again.'): string => {
  const e = err as any;
  if (!e) return fallback;
  const fields = e.fields || e.body?.fields;
  if (e.body?.message) return String(e.body.message);
  if (e instanceof BlanxerApiError && e.message && !/^Blanxer API \d+/.test(e.message)) return e.message;
  if (fields && typeof fields === 'object') {
    const first = Object.values(fields)[0];
    if (first) return String(first);
  }
  if (typeof e.message === 'string' && e.message) return e.message;
  return fallback;
};

export const readBody = async (res: Response): Promise<any> => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
