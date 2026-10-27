import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

/** Flat rectangular labels: tinted fill, 1 px border in the tone, dark text (AA on the fill). */
export const toneClasses: Record<Tone, string> = {
  success: 'bg-success-50 text-success-700 border-success-600',
  warning: 'bg-warning-50 text-warning-700 border-warning-600',
  danger: 'bg-danger-50 text-danger-700 border-danger-600',
  info: 'bg-info-50 text-info-700 border-info-600',
  neutral: 'bg-neutral-50 text-neutral-700 border-neutral-600',
  primary: 'bg-primary-50 text-primary-700 border-primary-600',
};

/** The one status/trust label. Always pass text; pair with an icon when it conveys state (never colour alone). */
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-px text-xs font-semibold whitespace-nowrap', toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
