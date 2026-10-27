import { useState, type FormEvent } from 'react';
import { OBSERVATION_SEVERITIES, OBSERVATION_SEVERITY_LABELS, type Observation, type ObservationSeverity, type ReviewPayload } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useAddObservation, useResolveObservation } from '@/api/scrutiny';
import { Button, EmptyState, FieldError, ObservationItem, useToast } from '@/components';
import { NoteModal } from '@/components/NoteModal';

export function ObservationsTab({ review, canAct }: { review: ReviewPayload; canAct: boolean }) {
  const toast = useToast();
  const add = useAddObservation(review.instrument.id);
  const resolve = useResolveObservation();
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<ObservationSeverity>('INFO');
  const [visible, setVisible] = useState(false);
  const [resolving, setResolving] = useState<Observation | null>(null);
  const errors = add.error instanceof ApiError ? add.error.fieldErrors() : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ text, severity, visibleToInstitution: visible }, {
      onSuccess: () => { setText(''); setSeverity('INFO'); setVisible(false); toast.success('Observation recorded'); },
    });
  };

  return (
    <div className="space-y-4">
      {canAct && (
        <form onSubmit={submit} className="space-y-3 rounded-[14px] border border-border bg-subtle p-5" aria-label="Add observation">
          <label htmlFor="obs-text" className="block text-sm font-semibold text-ink">New observation</label>
          <textarea id="obs-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!errors.text} aria-describedby="obs-text-error"
            className="w-full rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-[0.9375rem] aria-[invalid=true]:border-danger" />
          <FieldError id="obs-text-error" message={errors.text} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-ink">Severity{' '}
              <select value={severity} onChange={(e) => setSeverity(e.target.value as ObservationSeverity)} className="gov-input ml-1 h-9 w-auto">
                {OBSERVATION_SEVERITIES.map((s) => <option key={s} value={s}>{OBSERVATION_SEVERITY_LABELS[s]}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-teal" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to institution
            </label>
            <Button type="submit" variant="dark" size="sm" className="ml-auto" loading={add.isPending}>Add observation</Button>
          </div>
          {severity === 'BLOCKING' && <p className="text-xs text-danger-700">A blocking observation stops acceptance until it is resolved.</p>}
        </form>
      )}
      {review.observations.length === 0 ? (
        <EmptyState title="No observations recorded" description="Observations you add here stay on the record; mark them visible to tell the institution." />
      ) : (
        <ul className="space-y-2">
          {review.observations.map((o) => <ObservationItem key={o.id} o={o} onResolve={canAct ? () => { resolve.reset(); setResolving(o); } : undefined} />)}
        </ul>
      )}
      <NoteModal
        open={!!resolving}
        title="Resolve observation"
        label="Resolution note"
        submitLabel="Resolve"
        pending={resolve.isPending}
        error={resolve.error}
        onClose={() => setResolving(null)}
        onSubmit={(note) => resolving && resolve.mutate({ id: resolving.id, note }, { onSuccess: () => { setResolving(null); toast.success('Observation resolved'); } })}
      />
    </div>
  );
}
