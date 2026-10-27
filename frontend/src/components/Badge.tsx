import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

/** Soft tinted fill, dark text (AA on the fill). Inside tables the fill drops away and the coloured icon acts as the dot. */
export const toneClasses: Record<Tone, string> = {
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
  neutral: 'bg-neutral-50 text-neutral-700',
  primary: 'bg-primary-50 text-primary-700',
};

/** The one status/trust label: small, flat, rounded, icon + text (never colour alone). */
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
