import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** A small, calm line drawing: an open ledger. */
function Ledger() {
  return (
    <svg viewBox="0 0 96 64" className="mb-4 h-14 w-20 text-[#cfc7b8]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M8 12c12-4 26-4 40 2 14-6 28-6 40-2v42c-12-4-26-4-40 2-14-6-28-6-40-2z" />
      <path d="M48 14v42" />
      <path d="M17 24h22M17 32h18M57 24h22M57 32h14" />
    </svg>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center justify-center px-4 py-12 text-center">
      {Icon ? <Icon className="mb-3 size-8 text-[#b9b09f]" strokeWidth={1.5} aria-hidden /> : <Ledger />}
      <p className="font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
