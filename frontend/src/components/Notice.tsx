import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Kind = 'info' | 'warning' | 'error' | 'success';
const KIND: Record<Kind, { icon: LucideIcon; cls: string; label: string }> = {
  info: { icon: Info, cls: 'border-l-primary-600 bg-primary-50 text-primary-800', label: 'Note' },
  warning: { icon: AlertTriangle, cls: 'border-l-warning-600 bg-warning-50 text-warning-700', label: 'Attention' },
  error: { icon: AlertCircle, cls: 'border-l-danger-600 bg-danger-50 text-danger-700', label: 'Error' },
  success: { icon: CheckCircle2, cls: 'border-l-success-600 bg-success-50 text-success-700', label: 'Done' },
};

/** Flat notice with a thick left edge, an icon and a hidden label (never colour alone). */
export function Notice({ kind = 'info', title, children, className, role }: { kind?: Kind; title?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <div role={role} className={cn('flex gap-2 border border-line border-l-4 px-3 py-2 text-sm', k.cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <span className="sr-only">{k.label}: </span>
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
