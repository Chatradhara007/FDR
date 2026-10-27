import { CheckCircle2, XCircle } from 'lucide-react';
import { DOC_TYPE_LABELS, type DocType } from '@fdr/shared';

/** Required documents with ✓/✗ (icon + text). */
export function DocChecklist({ required, present }: { required: DocType[]; present: string[] }) {
  if (!required.length) return <p className="text-sm text-muted">No documents are required for this type.</p>;
  return (
    <ul className="space-y-1" aria-label="Required documents">
      {required.map((d) => {
        const ok = present.includes(d);
        return (
          <li key={d} className={`flex items-center gap-2 text-sm ${ok ? 'text-teal-hover' : 'text-danger-700'}`}>
            {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {DOC_TYPE_LABELS[d]} — {ok ? 'uploaded' : 'missing'}
          </li>
        );
      })}
    </ul>
  );
}
