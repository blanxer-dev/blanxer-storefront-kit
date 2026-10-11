'use client';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../core/http.js';
import { validation } from '../core/validation.js';
import { submitForm } from '../client/index.js';
import { useBlanxer } from './context.js';
import { Button, Field, SelectInput, TextArea, TextInput, cx } from './ui.js';

export interface BlanxerFormField {
  key: string;
  type: string;
  label?: string;
  placeholder?: string;
  help_text?: string;
  required?: boolean;
  width?: 'full' | 'half';
  options?: string[];
  multiple?: boolean;
  sub_fields?: { key: string; label?: string; placeholder?: string }[];
  min?: number | null;
  max?: number | null;
  step?: number | null;
}

const DISPLAY = ['heading', 'divider'];
const bounds = (f: BlanxerFormField) => ({ min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1 });

const initialValue = (f: BlanxerFormField): any => {
  if (f.type === 'checkbox') return false;
  if (f.type === 'checkbox_group' || f.type === 'tags') return [];
  if (f.type === 'slider') return bounds(f).min;
  if (f.type === 'badges' && f.multiple) return [];
  if (f.type === 'multi_text') return Object.fromEntries((f.sub_fields || []).map((s) => [s.key, '']));
  return '';
};

const isEmpty = (v: any): boolean => {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.length === 0;
  if (v && typeof v === 'object') return !Object.values(v).some((x) => String(x || '').trim());
  const s = String(v ?? '');
  if (/<[a-z][\s\S]*>/i.test(s)) return !s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return !s.trim();
};

/** A Blanxer form (`getForm(slug)` on the server), with the storefront's validation and submit rules. */
export function BlanxerForm({ form, className, onSubmitted }: { form: { slug: string; fields: BlanxerFormField[]; submit_label?: string; [k: string]: any }; className?: string; onSubmitted?: (message: string) => void }) {
  const { storeId, notify } = useBlanxer();
  const fields = form?.fields || [];
  const init = () => Object.fromEntries(fields.map((f) => [f.key, initialValue(f)]));
  const [values, setValues] = useState<Record<string, any>>(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState('');

  const setValue = (k: string, v: any) => {
    setValues((p) => ({ ...p, [k]: v }));
    setErrors((p) => (p[k] ? { ...p, [k]: '' } : p));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const value = values[f.key];
      if (f.key === 'phone') {
        const e = validation.phone(value, 'Phone number must be of 10 digit');
        if (e) next[f.key] = e;
        continue;
      }
      if (f.key === 'email') {
        if (f.required || !isEmpty(value)) {
          const e = validation.email(value);
          if (e) next[f.key] = e;
        }
        continue;
      }
      if (DISPLAY.includes(f.type)) continue;
      if (f.required && isEmpty(value)) {
        next[f.key] = f.type === 'checkbox' ? 'Please tick this box' : 'This field is required';
        continue;
      }
      if (isEmpty(value)) continue;
      const str = String(value).trim();
      if (f.type === 'email') {
        const e = validation.email(str);
        if (e) next[f.key] = e;
      } else if (f.type === 'phone' && !/^\+?[\d\s-]{6,20}$/.test(str)) next[f.key] = 'Enter a valid phone number';
      else if (f.type === 'url') {
        try {
          new URL(str);
        } catch {
          next[f.key] = 'Enter a full link, e.g. https://example.com';
        }
      } else if (f.type === 'number') {
        const n = Number(str);
        if (!Number.isFinite(n)) next[f.key] = 'Enter a number';
        else if (f.min != null && n < f.min) next[f.key] = `Must be at least ${f.min}`;
        else if (f.max != null && n > f.max) next[f.key] = `Must be at most ${f.max}`;
      }
    }
    setErrors(next);
    return !Object.keys(next).length;
  };

  const payload = () => {
    const data: Record<string, any> = {};
    for (const f of fields) {
      if (DISPLAY.includes(f.type)) continue;
      const v = values[f.key];
      if (!f.required && isEmpty(v)) continue;
      data[f.key] = f.type === 'number' ? Number(v) : v;
    }
    return data;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await submitForm(storeId, form.slug, payload());
      const msg = res?.message || 'Submitted successfully';
      setDone(msg);
      onSubmitted?.(msg);
    } catch (err: any) {
      if (err?.fields && Object.keys(err.fields).length) {
        const next: Record<string, string> = {};
        Object.entries(err.fields).forEach(([k, m]) => (next[k.split('.')[0]!] = String(m)));
        setErrors(next);
      } else {
        notify({ type: 'error', title: 'Error', message: errorMessage(err, 'Too many attempts or something went wrong. Please try again later.') });
      }
    }
    setLoading(false);
  };

  if (done) {
    return (
      <div className={cx('bx-form bx-form--done', className)}>
        <p className="bx-result-title">Thank you!</p>
        <p className="bx-muted">{done}</p>
        <Button variant="ghost" onClick={() => { setValues(init()); setErrors({}); setDone(''); }}>
          Submit another response
        </Button>
      </div>
    );
  }

  return (
    <form className={cx('bx-form', className)} onSubmit={submit} noValidate>
      {fields.map((f) => (
        <div key={f.key} className={cx('bx-form-cell', f.width === 'half' ? 'bx-form-cell--half' : 'bx-form-cell--full')}>
          <FormField field={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => setValue(f.key, v)} />
        </div>
      ))}
      <div className="bx-form-cell bx-form-cell--full">
        <Button type="submit" loading={loading} className="bx-form-submit">
          {form?.submit_label || 'Submit'}
        </Button>
      </div>
    </form>
  );
}

function FormField({ field: f, value, error, onChange }: { field: BlanxerFormField; value: any; error?: string; onChange: (v: any) => void }) {
  const common = { label: f.label, required: !!f.required, error: error || '', placeholder: f.placeholder, hint: f.help_text };
  const options = (f.options || []).filter(Boolean);
  switch (f.type) {
    case 'heading':
      return (
        <div className="bx-form-heading">
          <h3>{f.label}</h3>
          {f.help_text ? <p className="bx-muted">{f.help_text}</p> : null}
        </div>
      );
    case 'divider':
      return <hr className="bx-form-divider" />;
    case 'checkbox':
      return (
        <Field error={error} hint={f.help_text}>
          <label className="bx-check">
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
            <span>
              {f.label}
              {f.required ? ' *' : ''}
            </span>
          </label>
        </Field>
      );
    case 'checkbox_group':
    case 'badges': {
      const multi = f.type === 'checkbox_group' || !!f.multiple;
      const arr: string[] = Array.isArray(value) ? value : [];
      return (
        <Field label={f.label} required={f.required} error={error} hint={f.help_text}>
          <div className={f.type === 'badges' ? 'bx-chips' : 'bx-checks'}>
            {options.map((o) =>
              f.type === 'badges' ? (
                <button
                  key={o}
                  type="button"
                  aria-pressed={multi ? arr.includes(o) : value === o}
                  className={cx('bx-chip', (multi ? arr.includes(o) : value === o) && 'bx-chip--active')}
                  onClick={() => (multi ? onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]) : onChange(value === o ? '' : o))}
                >
                  {o}
                </button>
              ) : (
                <label key={o} className="bx-check">
                  <input type="checkbox" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
                  <span>{o}</span>
                </label>
              ),
            )}
          </div>
        </Field>
      );
    }
    case 'radio':
      return (
        <Field label={f.label} required={f.required} error={error} hint={f.help_text}>
          <div className="bx-checks">
            {options.map((o) => (
              <label key={o} className="bx-check">
                <input type="radio" name={f.key} checked={value === o} onChange={() => onChange(o)} />
                <span>{o}</span>
              </label>
            ))}
          </div>
        </Field>
      );
    case 'slider': {
      const b = bounds(f);
      return (
        <Field label={`${f.label || ''}: ${value}`} required={f.required} error={error} hint={f.help_text}>
          <input type="range" className="bx-range" min={b.min} max={b.max} step={b.step} value={typeof value === 'number' ? value : b.min} onChange={(e) => onChange(Number(e.target.value))} />
        </Field>
      );
    }
    case 'color':
      return (
        <Field label={f.label} required={f.required} error={error} hint={f.help_text}>
          <input type="color" className="bx-color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'number':
      return <TextInput {...common} type="number" min={f.min ?? undefined} max={f.max ?? undefined} step={f.step ?? 'any'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
    case 'phone':
    case 'url':
    case 'date':
    case 'time':
    case 'datetime': {
      const t = ({ email: 'email', phone: 'tel', url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' } as Record<string, string>)[f.type];
      return <TextInput {...common} type={t} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    }
    case 'textarea':
    case 'richtext':
      // Rich text is collected as plain text here.
      return <TextArea {...common} rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <SelectInput
          {...common}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          options={[{ value: '', label: f.placeholder || 'Select an option' }, ...options.map((o) => ({ value: o, label: o }))]}
        />
      );
    case 'tags': {
      const arr: string[] = Array.isArray(value) ? value : [];
      return (
        <TextInput
          {...common}
          hint={f.help_text || 'Separate with commas'}
          value={arr.join(', ')}
          onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
      );
    }
    case 'multi_text':
      return (
        <Field label={f.label} required={f.required} error={error} hint={f.help_text}>
          <div className="bx-grid-2">
            {(f.sub_fields || []).map((sf) => (
              <input key={sf.key} className="bx-input" aria-label={sf.label || sf.key} placeholder={sf.placeholder || sf.label} value={value?.[sf.key] || ''} onChange={(e) => onChange({ ...(value || {}), [sf.key]: e.target.value })} />
            ))}
          </div>
        </Field>
      );
    default: {
      const t = f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'text';
      return <TextInput {...common} type={t} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    }
  }
}
