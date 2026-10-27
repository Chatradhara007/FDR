import { CheckCircle2, SearchX } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { formatDate } from '@fdr/shared';
import { useVerifyRelease } from '@/api/verify';
import { ErrorState, Kicker, LoadingState } from '@/components';

/** Public page behind a release order's QR code. No sign-in, no navigation: it shows only what the server returns
 * (order number, status, instrument reference, approved date, approver designation, audit hash). */
export function VerifyPage() {
  const orderNo = decodeURIComponent(useParams()['*'] ?? '');
  const q = useVerifyRelease(orderNo);
  const r = q.data;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 py-6">
      <header>
        <Kicker>Release order check</Kicker>
        <h1 className="mt-1 text-[1.875rem] leading-tight font-bold tracking-[-0.02em] text-ink">Is this release order genuine?</h1>
        <p className="mt-1.5 text-base text-muted">The portal looks up the order number from the QR code and shows what its records hold.</p>
      </header>
      <section aria-live="polite" className="rounded-[14px] border border-border bg-surface p-6">
        {q.isPending && <LoadingState rows={3} label="Checking the order…" />}
        {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} title="The check could not be completed right now" />}
        {r && (r.valid ? (
          <>
            <p className="flex items-center gap-3 text-2xl font-bold text-teal" data-testid="verify-verdict">
              <CheckCircle2 className="size-8" aria-hidden /> Valid
            </p>
            <p className="mt-1 text-sm text-muted">An approved release order with this number exists in the portal.</p>
            <dl className="mt-5 border-t border-hairline text-[0.9375rem]">
              <Row k="Order number" v={r.orderNumber} mono />
              <Row k="Status" v={r.status} />
              <Row k="Instrument reference" v={r.instrumentReference ?? '—'} mono />
              <Row k="Approved on" v={formatDate(r.approvedDate)} />
              <Row k="Approved by (designation)" v={r.approverDesignation} />
              <Row k="Audit record hash" v={r.eventHash} mono small />
            </dl>
            <p className="mt-4 text-[0.8125rem] text-muted">
              The hash identifies the “release approved” entry in the portal’s tamper-evident audit log. No amounts or personal details are shown here.
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-3 text-2xl font-bold text-danger-700" data-testid="verify-verdict">
              <SearchX className="size-8" aria-hidden /> Not found
            </p>
            <p className="mt-2 text-[0.9375rem] text-ink">
              No approved release order matches this number. Check the number on the order, or ask the issuing office.
            </p>
          </>
        ))}
      </section>
    </div>
  );
}

function Row({ k, v, mono, small }: { k: string; v: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-hairline py-3 sm:grid-cols-3 sm:gap-3">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className={`break-all text-ink sm:col-span-2 ${mono ? 'mono' : 'font-medium'} ${small ? 'text-[0.8125rem]' : ''}`}>{v}</dd>
    </div>
  );
}
