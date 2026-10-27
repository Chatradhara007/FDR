import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; kind: ToastKind; message: string }

const ToastContext = createContext<((kind: ToastKind, message: string) => void) | null>(null);

const STYLE: Record<ToastKind, { cls: string; icon: typeof Info; label: string }> = {
  success: { cls: 'border-success-600/30 bg-success-50 text-success-700', icon: CheckCircle2, label: 'Success' },
  error: { cls: 'border-danger-600/30 bg-danger-50 text-danger-700', icon: XCircle, label: 'Error' },
  warning: { cls: 'border-warning-600/30 bg-warning-50 text-warning-700', icon: AlertTriangle, label: 'Warning' },
  info: { cls: 'border-info-600/30 bg-info-50 text-info-700', icon: Info, label: 'Info' },
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2 print:hidden" role="status" aria-live="polite">
        {items.map((t) => {
          const s = STYLE[t.kind];
          const Icon = s.icon;
          return (
            <div key={t.id} className={cn('flex items-start gap-2 border border-l-4 px-3 py-2 text-sm', s.cls)}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="flex-1"><span className="sr-only">{s.label}: </span>{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5">
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return useMemo(() => ({
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    warning: (m: string) => push('warning', m),
    info: (m: string) => push('info', m),
  }), [push]);
}
