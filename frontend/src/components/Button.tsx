import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
type Size = 'sm' | 'md';

/** Primary: solid navy (Submit/Save). Secondary: outlined (Reset/Cancel). Square corners, no shadows. */
const variants: Record<Variant, string> = {
  primary: 'bg-navy text-white border border-navy hover:bg-primary-600 disabled:bg-slate-400 disabled:border-slate-400',
  secondary: 'bg-white text-navy border border-navy hover:bg-primary-50 disabled:text-slate-500 disabled:border-slate-400',
  danger: 'bg-danger-600 text-white border border-danger-600 hover:bg-danger-700 disabled:bg-slate-400 disabled:border-slate-400',
  ghost: 'text-navy border border-transparent hover:bg-primary-50 disabled:text-slate-500',
  link: 'text-link border border-transparent underline-offset-2 hover:underline disabled:text-slate-500 px-0!',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-5 text-sm' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[2px] font-semibold disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Formal button bar under a form: primary action first, then outlined Reset/Cancel. */
export function ButtonBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-t border-line pt-4', className)}>{children}</div>;
}
