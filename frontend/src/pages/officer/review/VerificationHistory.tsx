import { AlertTriangle, BadgeCheck, CircleSlash, Hourglass, SearchX, WifiOff, type LucideIcon } from 'lucide-react';
import { FIELD_LABELS, TRACKED_FIELDS, VERIFICATION_RESULT_LABELS, type Verification, type VerificationResult } from '@fdr/shared';
import { Badge, EmptyState, type Tone } from '@/components';

const RESULT: Record<VerificationResult, { tone: Tone; icon: LucideIcon }> = {
  CONFIRMED: { tone: 'success', icon: BadgeCheck },
  MISMATCH: { tone: 'danger', icon: AlertTriangle },
  NOT_FOUND: { tone: 'danger', icon: SearchX },
  PENDING: { tone: 'info', icon: Hourglass },
  UNAVAILABLE: { tone: 'warning', icon: WifiOff },
  STALE: { tone: 'neutral', icon: CircleSlash },
};

export function ResultChip({ result }: { result: VerificationResult }) {
  const r = RESULT[result];
  const Icon = r.icon;
  return <Badge tone={r.tone} icon={<Icon className="size-3.5" aria-hidden />}>{VERIFICATION_RESULT_LABELS[result]}</Badge>;
}

const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export function VerificationHistory({ verifications }: { verifications: Verification[] }) {
  if (!verifications.length) return <EmptyState title="The bank has not been asked yet" description="Use Verify with bank to ask the bank what it holds." />;
  return (
    <ol className="space-y-3">
      {verifications.map((v) => {
        const fields = v.responsePayload?.fields ?? {};
        const mismatched = TRACKED_FIELDS.filter((f) => fields[f] && !fields[f]?.match);
        return (
          <li key={v.id} className="rounded-[14px] border border-border bg-surface p-5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ResultChip result={v.result} />
              <span className="text-xs text-muted">{time(v.requestedAt)} · {v.requestedByName ?? 'officer'}</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {v.responsePayload?.response_id ? `Response ${v.responsePayload.response_id}` : v.responsePayload?.reason ?? 'No response id'}
              {v.responsePayload?.note ? ` · ${v.responsePayload.note}` : ''}
              {v.result === 'STALE' ? ' · discarded because the instrument changed while the bank was answering' : ''}
            </p>
            {mismatched.length > 0 && <p className="mt-1 text-xs font-medium text-danger-700">Mismatched: {mismatched.map((f) => FIELD_LABELS[f]).join(', ')}</p>}
            <details className="mt-2">
              <summary className="cursor-pointer text-[0.8125rem] font-medium text-teal">Raw request and response</summary>
              <pre className="mt-2 max-h-64 overflow-auto mono rounded-[10px] border border-hairline bg-subtle p-3 text-[0.8125rem]">{JSON.stringify({ request: v.requestPayload, response: v.responsePayload }, null, 2)}</pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
