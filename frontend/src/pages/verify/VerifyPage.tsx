import { CheckCircle2, SearchX, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { formatDate } from '@fdr/shared';
import { useVerifyRelease } from '@/api/verify';

/** Public page behind a release order's QR code. No sign-in, no navigation: it shows only what the server returns
 * (order number, status, instrument reference, approved date, approver designation, audit hash). */
export function VerifyPage() {
  const orderNo = decodeURIComponent(useParams()['*'] ?? '');
  const q = useVerifyRelease(orderNo);
  const r = q.data;
  return (
    <div className="mx-auto flex max-w-xl flex-col justify-center gap-4 py-4">
      <header className="text-center">
        <ShieldCheck className="mx-auto size-8 text-primary-700" aria-hidden />
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Release order check</h1>
        <p className="text-sm text-slate-600">All India Council for Technical Education · FDR Portal (demo)</p>
      </header>
      {q.isPending && <p className="text-center text-sm text-slate-500">Checking…</p>}
      {q.isError && (
        <p role="alert" className="rounded-lg border border-slate-200 bg-surface p-4 text-center text-sm text-slate-700">
          The check could not be completed right now. Try again in a moment.
        </p>
      )}
      {r && (
        <section aria-live="polite" className="rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
          {r.valid ? (
            <>
              <p className="flex items-center justify-center gap-2 text-xl font-semibold text-success-700" data-testid="verify-verdict">
                <CheckCircle2 className="size-6" aria-hidden /> Valid
              </p>
              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <Row k="Order number" v={r.orderNumber} />
                <Row k="Status" v={r.status} />
                <Row k="Instrument reference" v={r.instrumentReference ?? '—'} />
                <Row k="Approved on" v={formatDate(r.approvedDate)} />
                <Row k="Approved by (designation)" v={r.approverDesignation} />
                <Row k="Audit record hash" v={r.eventHash} mono />
              </dl>
              <p className="mt-4 text-xs text-slate-500">
                The hash identifies the “release approved” entry in the portal’s tamper-evident audit log. No amounts or personal details are shown here.
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center justify-center gap-2 text-xl font-semibold text-danger-700" data-testid="verify-verdict">
                <SearchX className="size-6" aria-hidden /> Not found
              </p>
              <p className="mt-3 text-center text-sm text-slate-600">
                No approved release order matches this number. Check the number on the order, or ask the issuing office.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className={`col-span-2 break-all text-slate-900 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{v}</dd>
    </div>
  );
}
