import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export const card =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900';

export const primaryButton =
  'inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-700';

export const secondaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
}

/** Labelled input with an associated error message (WCAG: label + aria-describedby + aria-invalid). */
export function Field({ label, error, hint, id, ...input }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errId = `${inputId}-err`;
  const hintId = `${inputId}-hint`;
  const describedBy =
    [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-500 aria-[invalid=true]:border-red-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-400 dark:aria-[invalid=true]:border-red-400"
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-slate-600 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
      {label}
    </p>
  );
}
