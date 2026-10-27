import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
type Size = 'sm' | 'md';

/** Primary: solid ink. Secondary: white with a hairline border. One primary action per screen. */
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white border border-ink hover:bg-primary-800 disabled:bg-slate-300 disabled:border-slate-300',
  secondary: 'bg-white text-ink border border-[#d6d0c4] hover:bg-strip disabled:text-slate-500',
  danger: 'bg-danger-600 text-white border border-danger-600 hover:bg-danger-700 disabled:bg-slate-300 disabled:border-slate-300',
  ghost: 'text-ink border border-transparent hover:bg-strip disabled:text-slate-500',
  link: 'text-ink border border-transparent underline-offset-4 hover:underline disabled:text-slate-500 px-0!',
};
const sizes: Record<Size, string> = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-[0.9375rem]' };

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
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
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

/** Button row under a form: primary action first, then secondary ones. */
export function ButtonBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3 pt-4', className)}>{children}</div>;
}
