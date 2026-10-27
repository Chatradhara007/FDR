import { Eye, FileCheck2, FileText } from 'lucide-react';
import { useState } from 'react';
import { DOC_TYPE_LABELS, FIELD_LABELS, TRACKED_FIELDS, type DocumentInfo, type ReviewPayload, type TrackedField } from '@fdr/shared';
import { apiOpenInTab } from '@/api/client';
import { documentPath } from '@/api/instruments';
import { useCheckDocument } from '@/api/scrutiny';
import { Button, DateText, EmptyState, useToast } from '@/components';
import { formatSize } from '@/components/DocumentList';

function DocumentRow({ doc, review, canCheck }: { doc: DocumentInfo; review: ReviewPayload; canCheck: boolean }) {
  const toast = useToast();
  const check = useCheckDocument(review.instrument.id);
  const claimed = review.fields.filter((f) => f.tier === 'CLAIMED').map((f) => f.fieldName);
  const [field, setField] = useState<TrackedField | ''>('');
  const checkedHere = review.fields.filter((f) => f.source === `document:${doc.id}`);

  const onCheck = () => {
    if (!field) return;
    check.mutate({ field, documentId: doc.id }, {
      onSuccess: (r) => {
        toast[r.unchanged ? 'info' : 'success'](
          r.unchanged ? `${FIELD_LABELS[field]} already has a stronger proof; nothing changed` : `${FIELD_LABELS[field]} marked as checked against ${DOC_TYPE_LABELS[doc.docType]}`,
        );
        setField('');
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <li className="space-y-2 border-b border-hairline px-5 py-4 text-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{DOC_TYPE_LABELS[doc.docType]}</p>
          <p className="truncate text-xs text-muted">{doc.filename} · {formatSize(doc.sizeBytes)} · <DateText value={doc.uploadedAt} /></p>
        </div>
        <Button size="sm" variant="ghost" icon={<Eye className="size-4" aria-hidden />}
          onClick={() => apiOpenInTab(documentPath(doc.instrumentId, doc.id, 'preview')).catch((e: Error) => toast.error(e.message))}>
          Preview
        </Button>
      </div>
      {checkedHere.length > 0 && (
        <p className="flex items-center gap-1 text-[0.8125rem] text-ink-2">
          <FileCheck2 className="size-3.5" aria-hidden /> Checked against this document: {checkedHere.map((f) => FIELD_LABELS[f.fieldName]).join(', ')}
        </p>
      )}
      {canCheck && claimed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`check-${doc.id}`}>Field checked against this document</label>
          <select id={`check-${doc.id}`} value={field} onChange={(e) => setField(e.target.value as TrackedField)} className="gov-input h-9 w-auto">
            <option value="">Choose a claimed field…</option>
            {TRACKED_FIELDS.filter((f) => claimed.includes(f)).map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={!field} loading={check.isPending} icon={<FileCheck2 className="size-4" aria-hidden />} onClick={onCheck}>
            Checked against this document
          </Button>
        </div>
      )}
    </li>
  );
}

export function DocumentsTab({ review, canCheck }: { review: ReviewPayload; canCheck: boolean }) {
  const docs = review.instrument.documents;
  if (!docs.length) return <EmptyState icon={FileText} title="No documents attached" description="The institution has not uploaded any document yet." />;
  return (
    <>
      {canCheck && <p className="mb-2 text-xs text-muted">Open a document, compare it with a claimed value, then record the check. Bank-confirmed fields are never lowered.</p>}
      <ul className="overflow-hidden rounded-[14px] border border-border bg-surface">
        {docs.map((d) => <DocumentRow key={d.id} doc={d} review={review} canCheck={canCheck} />)}
      </ul>
    </>
  );
}
