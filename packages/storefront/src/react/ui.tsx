'use client';
import { useEffect, useId, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  className,
  children,
}: {
  label?: ReactNode;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('bx-field', !!error && 'bx-field--error', className)}>
      {label ? (
        <label className="bx-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="bx-required" aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <p className="bx-hint">{hint}</p> : null}
      {error ? (
        <p className="bx-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string | null; hint?: ReactNode; fieldClassName?: string };
export function TextInput({ label, error, hint, required, fieldClassName, className, id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id || auto;
  return (
    <Field label={label} required={required} error={error} hint={hint} htmlFor={fid} className={fieldClassName}>
      <input id={fid} required={required} aria-invalid={!!error || undefined} className={cx('bx-input', className)} {...rest} />
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string | null; fieldClassName?: string };
export function TextArea({ label, error, required, fieldClassName, className, id, ...rest }: TextareaProps) {
  const auto = useId();
  const fid = id || auto;
  return (
    <Field label={label} required={required} error={error} htmlFor={fid} className={fieldClassName}>
      <textarea id={fid} required={required} aria-invalid={!!error || undefined} className={cx('bx-input bx-textarea', className)} {...rest} />
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  error?: string | null;
  options: { label: string; value: string }[];
  fieldClassName?: string;
};
export function SelectInput({ label, error, required, options, fieldClassName, className, id, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id || auto;
  return (
    <Field label={label} required={required} error={error} htmlFor={fid} className={fieldClassName}>
      <select id={fid} required={required} aria-invalid={!!error || undefined} className={cx('bx-input bx-select', className)} {...rest}>
        {options.map((o) => (
          <option key={`${o.value}::${o.label}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Button({
  loading,
  variant = 'primary',
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('bx-button', `bx-button--${variant}`, loading && 'bx-button--loading', className)}
      {...rest}
    >
      {loading ? <span className="bx-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Minimal accessible modal. Backdrop clicks and Escape do nothing unless allowed. */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  dismissible = false,
  showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Close on backdrop click / Escape. */
  dismissible?: boolean;
  showClose?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, dismissible, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="bx-modal-backdrop" onClick={dismissible ? onClose : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cx('bx-modal', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showClose) && (
          <div className="bx-modal-header">
            <div id={titleId} className="bx-modal-title">
              {title}
            </div>
            {showClose ? (
              <button type="button" className="bx-modal-close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            ) : null}
          </div>
        )}
        <div className="bx-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
