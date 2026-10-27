import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

/** Small flat labels: tinted fill, dark text (AA on the fill). */
export const toneClasses: Record<Tone, string> = {
  success: 'bg-teal-tint text-teal-hover',
  warning: 'bg-attn-tint text-attn-text',
  danger: 'bg-danger-tint text-danger-700',
  info: 'bg-subtle text-ink-2',
  neutral: 'bg-chip text-ink-2',
  primary: 'bg-teal-tint text-teal-hover',
};

/** The one status/trust label. Always pass text; pair with an icon when it conveys state (never colour alone). */
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-[8px] px-2 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap', toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
