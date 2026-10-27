import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Kind = 'info' | 'warning' | 'error' | 'success';
const KIND: Record<Kind, { icon: LucideIcon; cls: string; iconCls: string; label: string }> = {
  info: { icon: Info, cls: 'bg-primary-50 text-slate-800', iconCls: 'text-ink', label: 'Note' },
  warning: { icon: AlertTriangle, cls: 'bg-warning-50 text-slate-800', iconCls: 'text-warning-700', label: 'Attention' },
  error: { icon: AlertCircle, cls: 'bg-danger-50 text-slate-800', iconCls: 'text-danger-700', label: 'Error' },
  success: { icon: CheckCircle2, cls: 'bg-success-50 text-slate-800', iconCls: 'text-success-700', label: 'Done' },
};

/** Soft tinted note with an icon and a hidden label (never colour alone). */
export function Notice({ kind = 'info', title, children, className, role }: { kind?: Kind; title?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <div role={role} className={cn('flex gap-3 rounded-xl px-4 py-3 text-sm', k.cls, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', k.iconCls)} aria-hidden />
      <div className="min-w-0">
        <span className="sr-only">{k.label}: </span>
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
