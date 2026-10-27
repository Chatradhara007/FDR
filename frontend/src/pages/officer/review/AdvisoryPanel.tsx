import { CheckCircle2, FileSearch, Flag, HelpCircle, XCircle } from 'lucide-react';
import { DOC_TYPE_LABELS, FIELD_LABELS, type DocumentFinding, type MetadataSignal, type ReviewPayload, type TextCheck } from '@fdr/shared';
import { Badge } from '@/components';
import { fieldValue } from '@/lib/display';

const RESULT: Record<TextCheck['result'], { icon: typeof CheckCircle2; text: string; cls: string }> = {
  MATCH: { icon: CheckCircle2, text: 'Matches', cls: 'text-teal-hover' },
  DIFFERENT: { icon: XCircle, text: 'Differs', cls: 'text-danger-700' },
  NOT_FOUND: { icon: HelpCircle, text: 'Not found in the text', cls: 'text-muted' },
};

function metadataText(m: MetadataSignal): string {
  const parts: string[] = [];
  if (m.reasons.includes('MODIFIED_AFTER_CREATED')) parts.push('the file was modified after it was created');
  if (m.reasons.includes('IMAGE_EDITOR')) parts.push(`it was produced by an image editor (${m.producer ?? m.creator ?? 'unknown tool'})`);
  return parts.join('; ');
}

function Finding({ f }: { f: DocumentFinding }) {
  return (
    <li className="rounded-[10px] border border-hairline p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <FileSearch className="size-4 text-muted" aria-hidden />
        {DOC_TYPE_LABELS[f.docType]} <span className="font-normal break-all text-muted">{f.filename}</span>
        <Badge tone="neutral">Advisory only</Badge>
      </p>
      {f.status === 'UNREADABLE' ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-ink-2">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
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
        <p className="mt-2 flex items-start gap-2 rounded-[8px] bg-attn-tint px-3 py-2 text-sm text-attn-text">
          <Flag className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><strong>Needs closer look, not proof:</strong> {metadataText(f.metadataSignal)}.</span>
        </p>
      )}
    </li>
  );
}

/** "Worth a closer look: advisory only": pattern flags and what the PDF text check noticed. Never blocks, never
 * changes a tier, and the server sends none of it to institutions. */
export function AdvisoryPanel({ review }: { review: ReviewPayload }) {
  const flags = review.advisoryFlags;
  // A readable document with nothing to compare and nothing to note (e.g. the bank letter) adds only noise.
  const findings = review.documentFindings.items.filter((f) => f.status === 'UNREADABLE' || f.checks.length > 0 || f.metadataSignal);
  if (!flags.length && !findings.length) return null;
  return (
    <section aria-label="Advisory signals" className="rounded-[14px] border border-attn-border bg-surface">
      <header className="border-b border-attn-border/60 bg-attn-tint px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-base font-bold text-attn-text"><Flag className="size-4" aria-hidden /> Worth a closer look: advisory only</h2>
        <p className="mt-0.5 text-[0.8125rem] text-attn-text">Nothing here blocks acceptance or changes a tier. Institutions do not see it.</p>
      </header>
      <div className="space-y-3 p-4">
        {flags.length > 0 && (
          <ul className="space-y-2 text-[0.9375rem]">
            {flags.map((f) => <li key={f.id} className="flex items-start gap-2"><Flag className="mt-0.5 size-4 shrink-0 text-attn" aria-hidden />{f.reason}</li>)}
          </ul>
        )}
        {findings.length > 0 && (
          <>
            <p className="kicker text-muted">Document text check</p>
            <ul className="space-y-2">{findings.map((f) => <Finding key={f.documentId} f={f} />)}</ul>
          </>
        )}
      </div>
    </section>
  );
}
