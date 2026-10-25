import { useState, type FormEvent } from 'react';
import { OBSERVATION_SEVERITIES, OBSERVATION_SEVERITY_LABELS, type Observation, type ObservationSeverity, type ReviewPayload } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useAddObservation, useResolveObservation } from '@/api/scrutiny';
import { Button, FieldError, ObservationItem, useToast } from '@/components';
import { NoteModal } from './NoteModal';

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
        <form onSubmit={submit} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" aria-label="Add observation">
          <label htmlFor="obs-text" className="block text-xs font-medium text-slate-600">New observation</label>
          <textarea id="obs-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!errors.text} aria-describedby="obs-text-error"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
          <FieldError id="obs-text-error" message={errors.text} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Severity{' '}
              <select value={severity} onChange={(e) => setSeverity(e.target.value as ObservationSeverity)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {OBSERVATION_SEVERITIES.map((s) => <option key={s} value={s}>{OBSERVATION_SEVERITY_LABELS[s]}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to institution
            </label>
            <Button type="submit" size="sm" className="ml-auto" loading={add.isPending}>Add observation</Button>
          </div>
          {severity === 'BLOCKING' && <p className="text-xs text-danger-700">A blocking observation stops acceptance until it is resolved.</p>}
        </form>
      )}
      {review.observations.length === 0 ? (
        <p className="text-sm text-slate-500">No observations recorded.</p>
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
