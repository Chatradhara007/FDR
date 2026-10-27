import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Kind = 'info' | 'warning' | 'error' | 'success';
const KIND: Record<Kind, { icon: LucideIcon; cls: string; label: string }> = {
  info: { icon: Info, cls: 'bg-teal-tint text-ink', label: 'Note' },
  warning: { icon: AlertTriangle, cls: 'bg-attn-tint text-attn-text', label: 'Attention' },
  error: { icon: AlertCircle, cls: 'bg-danger-tint text-danger-700', label: 'Error' },
  success: { icon: CheckCircle2, cls: 'bg-teal-tint text-teal-hover', label: 'Done' },
};

/** Tinted notice with an icon and a hidden label (never colour alone). */
export function Notice({ kind = 'info', title, children, className, role }: { kind?: Kind; title?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <div role={role} className={cn('flex gap-2.5 rounded-[10px] px-4 py-3 text-[0.9375rem] leading-normal', k.cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <span className="sr-only">{k.label}: </span>
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
