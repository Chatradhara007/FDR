import { CircleCheck, CircleX } from 'lucide-react';
import { ALERT_RESOLUTION_LABELS, ALERT_STATUS_LABELS, FIELD_LABELS, TRACKED_FIELDS, type Alert, type Passport } from '@fdr/shared';
import { AlertKindChip, AlertLevelChip, DateText, TierSquare, TrustBadge } from '@/components';
import { ResultChip } from '@/pages/officer/review/VerificationHistory';
import { fieldValue, sourceLabel } from '@/lib/display';

const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** The seven tracked fields as cards: value, trust tier (shape + label), where it came from and when it last changed. */
export function FieldsTab({ p }: { p: Passport }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Trust level of each field">
      {p.fields.map((f) => (
        <li key={f.fieldName} className="rounded-[12px] border border-border p-4">
          <div className="flex items-center gap-2">
            <TierSquare tier={f.tier} />
            <span className="kicker text-muted">{FIELD_LABELS[f.fieldName]}</span>
          </div>
          <p className="mt-2 text-base font-semibold break-words tabular-nums">{fieldValue(f.fieldName, f.value)}</p>
          <div className="mt-2"><TrustBadge tier={f.tier} /></div>
          <p className="mt-2 text-[0.8125rem] text-muted">
            {f.source ? sourceLabel(f.source, p.documents, p.verifications) : 'Not submitted yet'}
            {f.updatedAt && <> · {time(f.updatedAt)}</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Bank verification outcomes; AICTE roles can also open the raw request and response. */
export function VerificationTab({ p }: { p: Passport }) {
  if (!p.verifications.length) return <p className="text-sm text-muted">The bank has not been asked yet.</p>;
  return (
    <ol className="space-y-3">
      {p.verifications.map((v) => (
        <li key={v.id} className="rounded-[10px] border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ResultChip result={v.result} />
            <span className="text-xs text-muted">{time(v.requestedAt)}{v.requestedByName ? ` · ${v.requestedByName}` : ''}</span>
          </div>
          {Object.keys(v.fieldMatches).length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
              {TRACKED_FIELDS.filter((f) => v.fieldMatches[f] !== undefined).map((f) => (
                <li key={f} className="flex items-center gap-1">
                  {v.fieldMatches[f]
                    ? <><CircleCheck className="size-3.5 text-success-700" aria-hidden /> {FIELD_LABELS[f]}: matches</>
                    : <><CircleX className="size-3.5 text-danger-700" aria-hidden /> <span className="font-medium text-danger-700">{FIELD_LABELS[f]}: does not match</span></>}
                </li>
              ))}
            </ul>
          )}
          {v.responsePayload !== undefined && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-teal">Raw request and response</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-subtle p-2 text-xs">{JSON.stringify({ request: v.requestPayload, response: v.responsePayload }, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function AlertRow({ a }: { a: Alert }) {
  return (
    <li className="rounded-[10px] border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AlertKindChip kind={a.kind} />
        <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
        <span className="text-xs text-muted">{ALERT_STATUS_LABELS[a.status]}{a.resolution ? ` · ${ALERT_RESOLUTION_LABELS[a.resolution]}` : ''}</span>
        <span className="ml-auto text-xs text-muted">Due <DateText value={a.dueDate} /></span>
      </div>
      <p className="mt-1 text-ink-2">{a.message}</p>
    </li>
  );
}

export function AlertsTab({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-sm text-muted">No alerts for this instrument.</p>;
  const live = alerts.filter((a) => a.status !== 'RESOLVED');
  const done = alerts.filter((a) => a.status === 'RESOLVED');
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink-2">Open ({live.length})</h3>
        {live.length ? <ul className="space-y-2">{live.map((a) => <AlertRow key={a.id} a={a} />)}</ul> : <p className="text-sm text-muted">Nothing open.</p>}
      </section>
      {done.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Resolved ({done.length})</h3>
          <ul className="space-y-2">{done.map((a) => <AlertRow key={a.id} a={a} />)}</ul>
        </section>
      )}
    </div>
  );
}
