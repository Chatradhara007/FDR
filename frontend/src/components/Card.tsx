import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Flat panel: white, 1 px border, light blue-grey title strip with a bold navy title and optional right-side links. */
export function Panel({ title, actions, children, className, bodyClassName, flush }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
  /** No body padding (a table fills the panel edge to edge). */
  flush?: boolean;
}) {
  return (
    <section className={cn('min-w-0 rounded-[3px] border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-strip px-4 py-2">
          {title && <h2 className="text-base font-bold text-navy">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-3 text-sm">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? 'overflow-x-auto' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Earlier name, kept so every page picks up the panel style. */
export const Card = Panel;
