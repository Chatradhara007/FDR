import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'dark' | 'danger' | 'ghost' | 'link';
type Size = 'sm' | 'md' | 'lg';

/** Primary teal for the one main action per screen; outlined secondary; dark for secondary-important. */
const variants: Record<Variant, string> = {
  primary: 'bg-teal text-white border border-teal hover:bg-teal-hover hover:border-teal-hover disabled:bg-slate-400 disabled:border-slate-400',
  secondary: 'bg-white text-ink border border-border hover:bg-subtle hover:border-slate-400 disabled:text-slate-500',
  dark: 'bg-ink text-white border border-ink hover:bg-ink-2 disabled:bg-slate-400 disabled:border-slate-400',
  danger: 'bg-danger text-white border border-danger hover:bg-danger-700 disabled:bg-slate-400 disabled:border-slate-400',
  ghost: 'text-ink border border-transparent hover:bg-chip disabled:text-slate-500',
  link: 'text-teal border border-transparent underline-offset-2 hover:underline hover:text-teal-hover disabled:text-slate-500 px-0!',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-[8px]',
  md: 'h-11 px-5 text-[0.9375rem] rounded-[10px]',
  lg: 'h-12 px-6 text-base font-bold rounded-[10px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  /** Keyboard hint chip shown inside the button (staff screens), e.g. "R". */
  kbd?: string;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, kbd, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  const onDark = variant === 'primary' || variant === 'dark' || variant === 'danger';
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={kbd}
      className={cn('inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {kbd && <span aria-hidden className={cn('mono ml-1 text-[13px] font-medium', onDark ? 'opacity-80' : 'text-muted')}>{kbd}</span>}
    </button>
  );
}

/** Button bar under a form: primary action first, then outlined Reset/Cancel. */
export function ButtonBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3 border-t border-hairline pt-5', className)}>{children}</div>;
}
