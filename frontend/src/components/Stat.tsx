import { Check, ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCountUp } from '@/hooks/useCountUp';
import { cn } from '@/lib/cn';

export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

/** Headline number: serif figure, short label, optional one-line note; the whole tile links on. */
export function StatTile({ label, value, note, to, tone }: { label: string; value: ReactNode; note?: ReactNode; to?: string; tone?: 'danger' | 'warning' }) {
  const body = (
    <>
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className={cn('mt-1 font-serif text-[2.25rem] leading-none font-semibold tabular-nums', tone === 'danger' ? 'text-danger-700' : tone === 'warning' ? 'text-warning-700' : 'text-slate-900')}>{value}</div>
      {note && <div className="mt-2 text-sm text-slate-600">{note}</div>}
    </>
  );
  const cls = 'block min-w-0 rounded-xl border border-line bg-surface px-5 py-4';
  return to ? <Link to={to} className={cn(cls, 'transition-colors hover:border-[#d6d0c4] hover:bg-[#fdfcfa]')}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A row of 3 or 4 headline numbers. */
export function StatRow({ children, cols = 3 }: { children: ReactNode; cols?: 3 | 4 }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>{children}</div>;
}

/** Progressive disclosure: content stays folded until asked for. */
export function ShowMore({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md py-1 font-medium text-ink hover:underline underline-offset-4">
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        {open ? `Hide ${label.toLowerCase()}` : label}
      </button>
      {open && <div id={id} className="fade-in mt-4">{children}</div>}
    </div>
  );
}

/** Calm step indicator for wizards and "what happens next" trackers. */
export function StepIndicator({ steps, current, compact }: { steps: string[]; current: number; compact?: boolean }) {
  return (
    <ol className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', compact ? 'text-xs' : 'text-sm')} aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s} className="flex items-center gap-2" aria-current={now ? 'step' : undefined}>
            <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full border', compact ? 'size-4' : 'size-6 text-xs',
              done ? 'border-ink bg-ink text-white' : now ? 'border-ink text-ink' : 'border-[#d6d0c4] text-slate-500')}>
              {done ? <Check className={compact ? 'size-2.5' : 'size-3.5'} aria-hidden /> : !compact && i + 1}
            </span>
            <span className={cn(now ? 'font-medium text-slate-900' : 'text-slate-600')}>{s}{done && <span className="sr-only"> (done)</span>}</span>
            {i < steps.length - 1 && <span className="h-px w-5 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
