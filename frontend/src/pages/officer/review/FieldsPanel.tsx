import { FIELD_LABELS, type ReviewPayload } from '@fdr/shared';
import { Card, TrustBadge } from '@/components';
import { fieldValue, sourceLabel } from '@/lib/display';

/** The seven tracked fields: value, trust tier and where that tier came from. */
export function FieldsPanel({ review }: { review: ReviewPayload }) {
  const open = new Set(review.discrepancies.filter((d) => d.status === 'OPEN').map((d) => d.fieldName));
  return (
    <Card title="What is proven">
      <ul className="divide-y divide-slate-100">
        {review.fields.map((f) => (
          <li key={f.fieldName} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{FIELD_LABELS[f.fieldName]}</p>
              <p className="font-medium break-words text-slate-900 tabular-nums">{fieldValue(f.fieldName, f.value)}</p>
              {open.has(f.fieldName) && <p className="text-xs font-medium text-danger-700">Disputed by the bank — see discrepancy above</p>}
            </div>
            <div className="text-right">
              <TrustBadge tier={f.tier} />
              {f.tier !== 'CLAIMED' && (
                <p className="mt-1 text-xs text-slate-500">{sourceLabel(f.source, review.instrument.documents, review.verifications)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
