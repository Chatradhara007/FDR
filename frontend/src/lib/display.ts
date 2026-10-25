import { DOC_TYPE_LABELS, formatDate, formatINR, type DocumentInfo, type TrackedField, type Verification } from '@fdr/shared';

/** Human form of a canonical tracked-field value ('2500000.00' → ₹25,00,000.00). */
export function fieldValue(field: TrackedField, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'amount') return formatINR(value);
  if (field === 'issue_date' || field === 'maturity_date') return formatDate(value);
  if (field === 'lien_marked') return value === 'true' ? 'Marked in favour of AICTE' : 'Not marked';
  return value;
}

/** "Bank response rsp_8f3a · 26 Oct 2026", "Checked against FDR copy", "Claimed by institution". */
export function sourceLabel(source: string | null, documents: DocumentInfo[], verifications: Verification[]): string {
  if (!source || source === 'institution') return 'Claimed by institution';
  if (source.startsWith('document:')) {
    const doc = documents.find((d) => d.id === source.slice('document:'.length));
    return `Checked against ${doc ? DOC_TYPE_LABELS[doc.docType] : 'a document'}`;
  }
  if (source.startsWith('bank:')) {
    const id = source.slice('bank:'.length);
    const v = verifications.find((x) => x.responsePayload?.response_id === id);
    return `Bank response ${id.slice(0, 8)}${v ? ` · ${formatDate(v.requestedAt)}` : ''}`;
  }
  return source;
}
