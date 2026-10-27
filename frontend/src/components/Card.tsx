import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** White surface with a hairline border; optional quiet title row with actions on the right. */
export function Panel({ title, actions, children, className, bodyClassName, flush }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
  /** No body padding (a table fills the panel edge to edge). */
  flush?: boolean;
}) {
  return (
    <section className={cn('panel min-w-0 rounded-xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-4', flush ? 'pb-3' : 'pb-1')}>
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-4 text-sm">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? 'overflow-x-auto border-t border-line' : 'p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Earlier name, kept so every page picks up the panel style. */
export const Card = Panel;
