import type { ReactNode } from 'react';
import { FieldError } from './FieldError';

/** Label above the input, red asterisk when mandatory, helper text, inline error. */
export function FormField({ id, label, required, help, error, children }: {
  id: string; label: ReactNode; required?: boolean; help?: ReactNode; error?: string | null; children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger-600" aria-hidden>*</span>}
        {required && <span className="sr-only"> (mandatory)</span>}
      </label>
      {children}
      {help && <p id={`${id}-help`} className="mt-1.5 text-[0.8125rem] text-muted">{help}</p>}
      <FieldError id={`${id}-error`} message={error ?? undefined} />
    </div>
  );
}

export function MandatoryNote() {
  return <p className="text-[0.8125rem] text-muted">Fields marked <span className="text-danger-600">*</span> are mandatory.</p>;
}
