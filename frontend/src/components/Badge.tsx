import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

export const toneClasses: Record<Tone, string> = {
  success: 'bg-success-50 text-success-700 ring-success-600/20',
  warning: 'bg-warning-50 text-warning-700 ring-warning-600/20',
  danger: 'bg-danger-50 text-danger-700 ring-danger-600/20',
  info: 'bg-info-50 text-info-700 ring-info-600/20',
  neutral: 'bg-neutral-50 text-neutral-700 ring-neutral-600/20',
  primary: 'bg-primary-50 text-primary-700 ring-primary-600/20',
};

/** Always pass text; pair with an icon when it conveys state (never colour alone). */
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
