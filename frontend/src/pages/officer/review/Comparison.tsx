import { CheckCircle2, CircleDashed, FileCheck2, XCircle, type LucideIcon } from 'lucide-react';
import { FIELD_LABELS, type DocumentFinding, type ReviewPayload, type TextCheckField, type TrackedField, type Verification } from '@fdr/shared';
import { Badge, Panel, TrustBadge, type Tone } from '@/components';
import { fieldValue, sourceLabel } from '@/lib/display';

const TEXT_FIELDS: readonly TrackedField[] = ['reference_no', 'amount', 'issue_date', 'maturity_date'] satisfies TextCheckField[];

/** The newest bank answer that carries field values (the list may hold pending or unavailable attempts). */
function latestBankAnswer(verifications: Verification[]): Verification | null {
  const answered = verifications.filter((v) => v.responsePayload && (v.responsePayload.fields || v.responsePayload.result === 'NOT_FOUND'));
  return answered.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
}

/** The main document's text check (FDR copy or deposit confirmation carry `checks`); unreadable when nothing could be read. */
function mainFinding(items: DocumentFinding[]): DocumentFinding | null {
  return items.find((f) => f.checks.length > 0) ?? items.find((f) => f.status === 'UNREADABLE') ?? null;
}

/** "The document says": advisory text read from the PDF. Never changes a tier or a blocker. */
function documentSays(field: TrackedField, finding: DocumentFinding | null): { text: string; note?: string } {
  if (!TEXT_FIELDS.includes(field)) return { text: '—', note: 'Not compared' };
  if (!finding) return { text: '—', note: 'No document read' };
  if (finding.status === 'UNREADABLE') return { text: 'Not read', note: finding.message ?? undefined };
  const check = finding.checks.find((c) => c.field === field);
  if (!check || check.result === 'NOT_FOUND' || check.found === null) return { text: 'Not read', note: 'Not found in the text' };
  return { text: fieldValue(field, check.found), note: check.result === 'MATCH' ? 'Same as claimed' : 'Differs from the claim' };
}

const RESULT: Record<'match' | 'mismatch' | 'document' | 'open', { icon: LucideIcon; text: string; tone: Tone }> = {
  match: { icon: CheckCircle2, text: 'Matches bank', tone: 'success' },
  mismatch: { icon: XCircle, text: 'Mismatch', tone: 'danger' },
  document: { icon: FileCheck2, text: 'Document-checked', tone: 'info' },
  open: { icon: CircleDashed, text: 'Not proven yet', tone: 'neutral' },
};

/** Three sources side by side, per tracked field; the Result follows the trust tier and the bank only. */
export function Comparison({ review, onReturn }: { review: ReviewPayload; onReturn?: (suggested: string) => void }) {
  const bank = latestBankAnswer(review.verifications);
  const finding = mainFinding(review.documentFindings.items);
  const disputed = new Map(review.discrepancies.filter((d) => d.status === 'OPEN').map((d) => [d.fieldName, d]));
  const cell = 'px-4 py-3 align-top max-md:flex max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1.5 max-md:text-right max-md:before:text-left max-md:before:text-[0.8125rem] max-md:before:font-semibold max-md:before:text-muted max-md:before:content-[attr(data-label)]';

  return (
    <Panel title="What each source says" flush
      actions={<span className="text-[0.8125rem] text-muted">The document column is read from the PDF text: advisory only, it never changes a tier.</span>}>
      <table className="w-full text-[0.9375rem] max-md:block">
        <thead className="max-md:hidden">
          <tr className="border-b border-hairline text-left text-[0.75rem] font-bold tracking-[0.05em] text-muted uppercase">
            <th scope="col" className="px-4 py-2.5">Field</th>
            <th scope="col" className="px-4 py-2.5">The institution says</th>
            <th scope="col" className="px-4 py-2.5">The document says <span className="font-semibold normal-case tracking-normal">(advisory)</span></th>
            <th scope="col" className="px-4 py-2.5">The bank holds</th>
            <th scope="col" className="px-4 py-2.5">Result</th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {review.fields.map((f) => {
            const d = disputed.get(f.fieldName);
            const bf = bank?.responsePayload?.fields?.[f.fieldName];
            const doc = documentSays(f.fieldName, finding);
            const kind = d || (bf && !bf.match) ? 'mismatch' : f.tier === 'BANK_CONFIRMED' ? 'match' : f.tier === 'DOCUMENT' ? 'document' : 'open';
            const r = RESULT[kind];
            const Icon = r.icon;
            const bankText = d ? (d.confirmedValue === null ? 'No record at bank' : fieldValue(f.fieldName, d.confirmedValue))
              : bf ? fieldValue(f.fieldName, bf.confirmed)
              : bank?.responsePayload?.result === 'NOT_FOUND' ? 'No record at bank' : 'Not asked yet';
            return (
              <tr key={f.fieldName} className={`border-b border-hairline last:border-0 max-md:block max-md:px-4 max-md:py-3 ${kind === 'mismatch' ? 'bg-danger-tint/50' : ''}`}>
                <th scope="row" className="px-4 py-3 text-left align-top font-semibold max-md:block max-md:px-0 max-md:pb-1">{FIELD_LABELS[f.fieldName]}</th>
                <td data-label="The institution says" className={cell}>
                  <div>
                    <p className="font-medium break-words tabular-nums">{fieldValue(f.fieldName, f.value)}</p>
                    <div className="mt-1"><TrustBadge tier={f.tier} /></div>
                    {f.tier !== 'CLAIMED' && <p className="mt-1 text-[0.8125rem] text-muted">{sourceLabel(f.source, review.instrument.documents, review.verifications)}</p>}
                  </div>
                </td>
                <td data-label="The document says" className={cell}>
                  <div>
                    <p className={doc.text === 'Not read' || doc.text === '—' ? 'text-muted' : 'break-words tabular-nums'}>{doc.text}</p>
                    {doc.note && <p className="mt-0.5 text-[0.8125rem] text-muted">{doc.note}</p>}
                  </div>
                </td>
                <td data-label="The bank holds" className={cell}>
                  <p className={bf || d ? 'font-medium break-words tabular-nums' : 'text-muted'}>{bankText}</p>
                </td>
                <td data-label="Result" className={cell}>
                  <div className="max-md:text-right">
                    <Badge tone={r.tone} icon={<Icon className="size-3.5" aria-hidden />}>{r.text}</Badge>
                    {d && onReturn && (
                      <button type="button" className="gov-link mt-1.5 block text-[0.8125rem] font-semibold max-md:ml-auto"
                        onClick={() => onReturn(`${FIELD_LABELS[f.fieldName]} does not match the bank record (${d.reason.toLowerCase()}).`)}>
                        Return with this reason
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
