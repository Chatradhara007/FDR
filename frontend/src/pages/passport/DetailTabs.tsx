import { CircleCheck, CircleX } from 'lucide-react';
import { ALERT_RESOLUTION_LABELS, ALERT_STATUS_LABELS, FIELD_LABELS, TRACKED_FIELDS, type Alert, type Passport } from '@fdr/shared';
import { AlertKindChip, AlertLevelChip, DateText, TrustBadge } from '@/components';
import { ResultChip } from '@/pages/officer/review/VerificationHistory';
import { fieldValue, sourceLabel } from '@/lib/display';

const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** The seven tracked fields with trust tier, where it came from, and when it last changed. */
export function FieldsTab({ p }: { p: Passport }) {
  return (
    <table className="min-w-full text-sm">
      <caption className="sr-only">Trust level of each field</caption>
      <thead>
        <tr className="text-left text-xs text-slate-500">
          <th scope="col" className="py-1 pr-4 font-semibold">Field</th>
          <th scope="col" className="py-1 pr-4 font-semibold">Recorded value</th>
          <th scope="col" className="py-1 pr-4 font-semibold">Trust level</th>
          <th scope="col" className="py-1 pr-4 font-semibold">Source</th>
          <th scope="col" className="py-1 font-semibold">Last updated</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {p.fields.map((f) => (
          <tr key={f.fieldName}>
            <td className="py-2 pr-4 text-slate-600">{FIELD_LABELS[f.fieldName]}</td>
            <td className="py-2 pr-4 tabular-nums">{fieldValue(f.fieldName, f.value)}</td>
            <td className="py-2 pr-4"><TrustBadge tier={f.tier} /></td>
            <td className="py-2 pr-4 text-xs text-slate-600">{f.source ? sourceLabel(f.source, p.documents, p.verifications) : 'Not submitted yet'}</td>
            <td className="py-2 text-xs text-slate-600">{f.updatedAt ? time(f.updatedAt) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Bank verification outcomes; AICTE roles can also open the raw request and response. */
export function VerificationTab({ p }: { p: Passport }) {
  if (!p.verifications.length) return <p className="text-sm text-slate-500">The bank has not been asked yet.</p>;
  return (
    <ol className="space-y-3">
      {p.verifications.map((v) => (
        <li key={v.id} className="rounded-md border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ResultChip result={v.result} />
            <span className="text-xs text-slate-500">{time(v.requestedAt)}{v.requestedByName ? ` · ${v.requestedByName}` : ''}</span>
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
              <summary className="cursor-pointer text-xs text-primary-700">Raw request and response</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify({ request: v.requestPayload, response: v.responsePayload }, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function AlertRow({ a }: { a: Alert }) {
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AlertKindChip kind={a.kind} />
        <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
        <span className="text-xs text-slate-500">{ALERT_STATUS_LABELS[a.status]}{a.resolution ? ` · ${ALERT_RESOLUTION_LABELS[a.resolution]}` : ''}</span>
        <span className="ml-auto text-xs text-slate-500">Due <DateText value={a.dueDate} /></span>
      </div>
      <p className="mt-1 text-slate-700">{a.message}</p>
    </li>
  );
}

export function AlertsTab({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-sm text-slate-500">No alerts for this instrument.</p>;
  const live = alerts.filter((a) => a.status !== 'RESOLVED');
  const done = alerts.filter((a) => a.status === 'RESOLVED');
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Open ({live.length})</h3>
        {live.length ? <ul className="space-y-2">{live.map((a) => <AlertRow key={a.id} a={a} />)}</ul> : <p className="text-sm text-slate-500">Nothing open.</p>}
      </section>
      {done.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Resolved ({done.length})</h3>
          <ul className="space-y-2">{done.map((a) => <AlertRow key={a.id} a={a} />)}</ul>
        </section>
      )}
    </div>
  );
}
