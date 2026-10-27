import { CheckCircle2, FileSearch, Flag, HelpCircle, XCircle } from 'lucide-react';
import { DOC_TYPE_LABELS, FIELD_LABELS, type DocumentFinding, type MetadataSignal, type ReviewPayload, type TextCheck } from '@fdr/shared';
import { Badge } from '@/components';
import { fieldValue } from '@/lib/display';

const RESULT: Record<TextCheck['result'], { icon: typeof CheckCircle2; text: string; cls: string }> = {
  MATCH: { icon: CheckCircle2, text: 'Matches', cls: 'text-success-700' },
  DIFFERENT: { icon: XCircle, text: 'Differs', cls: 'text-danger-700' },
  NOT_FOUND: { icon: HelpCircle, text: 'Not found in the text', cls: 'text-slate-600' },
};

function metadataText(m: MetadataSignal): string {
  const parts: string[] = [];
  if (m.reasons.includes('MODIFIED_AFTER_CREATED')) parts.push('the file was modified after it was created');
  if (m.reasons.includes('IMAGE_EDITOR')) parts.push(`it was produced by an image editor (${m.producer ?? m.creator ?? 'unknown tool'})`);
  return parts.join('; ');
}

function Finding({ f }: { f: DocumentFinding }) {
  return (
    <li className="rounded-md border border-slate-200 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
        <FileSearch className="size-4 text-slate-500" aria-hidden />
        {DOC_TYPE_LABELS[f.docType]} <span className="font-normal break-all text-slate-500">{f.filename}</span>
        <Badge tone="neutral">Advisory only</Badge>
      </p>
      {f.status === 'UNREADABLE' ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-slate-700">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
          <span>Text could not be read. {f.message}</span>
        </p>
      ) : (
        f.checks.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {f.checks.map((c) => {
              const r = RESULT[c.result];
              const Icon = r.icon;
              return (
                <li key={c.field} className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${r.cls}`} aria-hidden />
                  <span>
                    <span className="font-medium">{FIELD_LABELS[c.field]}:</span>{' '}
                    {c.result === 'NOT_FOUND'
                      ? `the document text does not show it (claimed ${fieldValue(c.field, c.claimed)})`
                      : <>Document text says {fieldValue(c.field, c.found)}, claimed {fieldValue(c.field, c.claimed)}</>}
                    <span className={`ml-2 text-xs font-semibold ${r.cls}`}>{r.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )
      )}
      {f.metadataSignal && (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <Flag className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><strong>Needs closer look, not proof:</strong> {metadataText(f.metadataSignal)}.</span>
        </p>
      )}
    </li>
  );
}

/** Advisory signals for officers: pattern flags and the PDF text cross-check. Never blocks, never changes a tier,
 * and the server sends none of it to institutions. */
export function AdvisoryPanel({ review }: { review: ReviewPayload }) {
  const flags = review.advisoryFlags;
  // A readable document with nothing to compare and nothing to note (e.g. the bank letter) adds only noise.
  const findings = review.documentFindings.items.filter((f) => f.status === 'UNREADABLE' || f.checks.length > 0 || f.metadataSignal);
  if (!flags.length && !findings.length) return null;
  return (
    <section aria-label="Advisory signals" className="mb-4 space-y-3">
      {flags.length > 0 && (
        <article className="rounded-lg border border-warning-600/30 bg-surface shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-warning-600/20 bg-warning-50 px-4 py-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning-700"><Flag className="size-4" aria-hidden /> Worth a closer look</p>
            <span className="text-xs text-warning-700">Advisory only · nothing is blocked · institutions do not see this</span>
          </header>
          <ul className="space-y-2 px-4 py-3 text-sm text-slate-800">
            {flags.map((f) => <li key={f.id} className="flex items-start gap-2"><Flag className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />{f.reason}</li>)}
          </ul>
        </article>
      )}
      {findings.length > 0 && (
        <article className="rounded-lg border border-slate-200 bg-surface shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileSearch className="size-4" aria-hidden /> Document text cross-check</p>
            <span className="text-xs text-slate-500">Advisory only · trust tiers are not changed by this</span>
          </header>
          <ul className="space-y-2 p-3">{findings.map((f) => <Finding key={f.documentId} f={f} />)}</ul>
        </article>
      )}
    </section>
  );
}
