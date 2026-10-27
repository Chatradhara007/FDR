import { AlertTriangle, Inbox, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/** The one empty state: quiet icon, one title, one sentence, optional action. */
export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <Icon className="mb-3 size-8 text-muted" aria-hidden />
      <p className="text-[0.9375rem] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** The one loading state: grey bars where the content will appear (announced to screen readers). */
export function LoadingState({ rows = 3, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3 py-2" role="status">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-5 animate-pulse rounded-[6px] bg-chip" style={{ width: `${90 - i * 12}%` }} aria-hidden />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** The one error state: what went wrong in plain words, and a retry when the caller can offer one. */
export function ErrorState({ error, onRetry, title = 'This could not be loaded' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center" role="alert">
      <AlertTriangle className="mb-3 size-8 text-danger-600" aria-hidden />
      <p className="text-[0.9375rem] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{error instanceof Error ? error.message : 'Please try again.'}</p>
      {onRetry && <div className="mt-4"><Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}
