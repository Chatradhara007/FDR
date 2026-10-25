import { AlertCircle } from 'lucide-react';

/** Render under an input; give the input aria-describedby={id} and aria-invalid. */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 flex items-center gap-1 text-xs text-danger-700">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}
