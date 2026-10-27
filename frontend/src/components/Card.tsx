import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** White card, 1 px border, radius 14; optional title row with right-side actions. */
export function Panel({ title, actions, children, className, bodyClassName, flush }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
  /** No body padding (a table fills the card edge to edge). */
  flush?: boolean;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-[14px] border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline px-6 py-4">
          {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-3 text-sm">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? 'overflow-x-auto' : 'p-6', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Earlier name, kept so every page picks up the card style. */
export const Card = Panel;
