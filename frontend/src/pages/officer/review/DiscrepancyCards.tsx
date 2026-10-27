import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { FIELD_LABELS, type Discrepancy } from '@fdr/shared';
import { useResolveDiscrepancy } from '@/api/scrutiny';
import { Button, useToast } from '@/components';
import { fieldValue } from '@/lib/display';
import { NoteModal } from '@/components/NoteModal';

/** Institution claimed vs bank confirmed, side by side, the differing value highlighted. */
export function DiscrepancyCards({ discrepancies, canAct }: { discrepancies: Discrepancy[]; canAct: boolean }) {
  const open = discrepancies.filter((d) => d.status === 'OPEN');
  const [resolving, setResolving] = useState<Discrepancy | null>(null);
  const resolve = useResolveDiscrepancy();
  const toast = useToast();
  if (!open.length) return null;
  return (
    <section aria-label="Open discrepancies" className="space-y-3">
      {open.map((d) => (
        <article key={d.id} className="rounded-[14px] border border-danger-600/30 bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-danger-600/20 bg-danger-tint px-5 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger-700">
              <AlertTriangle className="size-4" aria-hidden />
              {d.reason} · {FIELD_LABELS[d.fieldName]}
            </p>
            <span className="text-xs text-danger-700">Open discrepancy</span>
          </header>
          <div className="grid gap-px bg-hairline sm:grid-cols-2">
            <div className="bg-surface px-5 py-3">
              <p className="kicker text-muted">Institution claimed</p>
              <p className="mt-1 inline-block rounded bg-warning-50 px-1.5 text-lg font-semibold text-warning-700 tabular-nums">
                {fieldValue(d.fieldName, d.claimedValue)}
              </p>
            </div>
            <div className="bg-surface px-5 py-3">
              <p className="kicker text-muted">Bank confirmed</p>
              <p className="mt-1 inline-block rounded bg-success-50 px-1.5 text-lg font-semibold text-success-700 tabular-nums">
                {d.confirmedValue === null ? 'No record at bank' : fieldValue(d.fieldName, d.confirmedValue)}
              </p>
            </div>
          </div>
          {canAct && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-5 py-3">
              <Button size="sm" variant="secondary" icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => { resolve.reset(); setResolving(d); }}>
                Resolve with note
              </Button>
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
