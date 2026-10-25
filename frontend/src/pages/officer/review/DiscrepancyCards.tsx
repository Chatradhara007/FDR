import { AlertTriangle, CheckCircle2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { FIELD_LABELS, type Discrepancy } from '@fdr/shared';
import { useResolveDiscrepancy } from '@/api/scrutiny';
import { Button, useToast } from '@/components';
import { fieldValue } from '@/lib/display';
import { NoteModal } from '@/components/NoteModal';

/** Institution claimed vs bank confirmed, side by side, the differing value highlighted. */
export function DiscrepancyCards({ discrepancies, canAct, canReturn, onReturn }: {
  discrepancies: Discrepancy[];
  canAct: boolean;
  canReturn: boolean;
  onReturn: (suggested: string) => void;
}) {
  const open = discrepancies.filter((d) => d.status === 'OPEN');
  const [resolving, setResolving] = useState<Discrepancy | null>(null);
  const resolve = useResolveDiscrepancy();
  const toast = useToast();
  if (!open.length) return null;
  return (
    <section aria-label="Open discrepancies" className="mb-4 space-y-3">
      {open.map((d) => (
        <article key={d.id} className="rounded-lg border border-danger-600/30 bg-surface shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-danger-600/20 bg-danger-50 px-4 py-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger-700">
              <AlertTriangle className="size-4" aria-hidden />
              {d.reason} · {FIELD_LABELS[d.fieldName]}
            </p>
            <span className="text-xs text-danger-700">Open discrepancy</span>
          </header>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
            <div className="bg-surface px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Institution claimed</p>
              <p className="mt-1 inline-block rounded bg-warning-50 px-1.5 text-lg font-semibold text-warning-700 tabular-nums">
                {fieldValue(d.fieldName, d.claimedValue)}
              </p>
            </div>
            <div className="bg-surface px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Bank confirmed</p>
              <p className="mt-1 inline-block rounded bg-success-50 px-1.5 text-lg font-semibold text-success-700 tabular-nums">
                {d.confirmedValue === null ? 'No record at bank' : fieldValue(d.fieldName, d.confirmedValue)}
              </p>
            </div>
          </div>
          {canAct && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-2">
              <Button size="sm" variant="secondary" icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => { resolve.reset(); setResolving(d); }}>
                Resolve with note
              </Button>
              {canReturn && (
                <Button size="sm" variant="danger" icon={<Undo2 className="size-4" aria-hidden />}
                  onClick={() => onReturn(`${FIELD_LABELS[d.fieldName]} does not match the bank record (${d.reason.toLowerCase()}).`)}>
                  Return to institution
                </Button>
              )}
            </footer>
          )}
        </article>
      ))}
      <NoteModal
        open={!!resolving}
        title="Resolve discrepancy"
        label="Resolution note"
        submitLabel="Resolve"
        intro="Resolving records your explanation. It does not make the instrument bank-confirmed: accepting still needs a fresh bank confirmation or an override note."
        pending={resolve.isPending}
        error={resolve.error}
        onClose={() => setResolving(null)}
        onSubmit={(note) => resolving && resolve.mutate({ id: resolving.id, note }, {
          onSuccess: () => { setResolving(null); toast.success('Discrepancy resolved'); },
        })}
      />
    </section>
  );
}
