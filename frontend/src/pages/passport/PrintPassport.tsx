import { useShowcase } from '@/hooks/useShowcase';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { FIELD_LABELS, INSTRUMENT_TYPE_LABELS, formatDate } from '@fdr/shared';
import { usePassport } from '@/api/instruments';
import { Button, EmptyState, Money, QrCode, StatusChip, TrustBadge, VerificationChip, WeakestTierBadge } from '@/components';
import { fieldValue, sourceLabel } from '@/lib/display';

// Advisory signals are for officers; a printed passport can travel, so they never appear on it.
const ADVISORY_ACTIONS = new Set(['ADVISORY_FLAGS_UPDATED', 'DOCUMENT_TEXT_CHECKED']);

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** Print-friendly passport: no sidebar, header or tabs. Open it from the passport, then Print / Save as PDF. */
export function PrintPassport() {
  const { id = '' } = useParams();
  const q = usePassport(id);
  const showcase = useShowcase();
  if (q.isError) return <main className="p-6"><EmptyState title="Instrument not found" description="It may have been deleted, or it belongs to another institution." /></main>;
  const p = q.data;
  if (!p) return <main className="p-6 text-sm text-slate-500"><p>Loading…</p></main>;
  const inst = p.instrument;
  const timeline = p.timeline.filter((e) => !ADVISORY_ACTIONS.has(e.action)).slice().reverse();
  const orders = p.releaseRequests.filter((r) => r.orderNumber);

  return (
    <main className="mx-auto max-w-4xl bg-white p-6 text-slate-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={`/instruments/${inst.id}`} className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Back to passport
        </Link>
        <Button icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <header className="border-b-2 border-slate-900 pb-3">
        <p className="text-xs font-semibold tracking-wide uppercase">All India Council for Technical Education · Instrument passport</p>
        <h1 className="mt-1 text-2xl font-semibold break-all">{inst.referenceNo ?? 'Draft instrument'}</h1>
        <p className="mt-1 text-sm">
          {INSTRUMENT_TYPE_LABELS[inst.type]} · {inst.institutionName} · {inst.issuingBank ?? 'Bank not given'}{inst.branch ? `, ${inst.branch}` : ''}
        </p>
        <p className="mt-1 text-sm">
          Amount <strong><Money amount={inst.amount} /></strong> · Issued {inst.issueDate ? formatDate(inst.issueDate) : '—'} · Matures {inst.maturityDate ? formatDate(inst.maturityDate) : '—'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip status={inst.status} />
          {inst.status !== 'DRAFT' && <VerificationChip state={inst.verificationState} />}
          <WeakestTierBadge tier={p.summary.weakestTier} />
        </div>
      </header>

      <section className="mt-5 break-inside-avoid" aria-label="What is proven">
        <h2 className="text-base font-semibold">What is proven, and what is only claimed</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className="border-b border-slate-400 py-1 pr-3">Field</th>
              <th scope="col" className="border-b border-slate-400 py-1 pr-3">Value</th>
              <th scope="col" className="border-b border-slate-400 py-1 pr-3">Status</th>
              <th scope="col" className="border-b border-slate-400 py-1">Source</th>
            </tr>
          </thead>
          <tbody>
            {p.fields.map((f) => (
              <tr key={f.fieldName} className="break-inside-avoid">
                <th scope="row" className="border-b border-slate-200 py-1 pr-3 text-left font-medium">{FIELD_LABELS[f.fieldName]}</th>
                <td className="border-b border-slate-200 py-1 pr-3 break-all">{fieldValue(f.fieldName, f.value)}</td>
                <td className="border-b border-slate-200 py-1 pr-3"><TrustBadge tier={f.tier} /></td>
                <td className="border-b border-slate-200 py-1 text-xs">{sourceLabel(f.source, p.documents, p.verifications)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5" aria-label="Renewal chain">
        <h2 className="text-base font-semibold">Renewal chain</h2>
        {p.chain.length <= 1 ? (
          <p className="mt-1 text-sm">This instrument has not been renewed and does not replace an earlier one.</p>
        ) : (
          <ol className="mt-2 space-y-1 text-sm">
            {p.chain.map((l, i) => (
              <li key={l.id} className="break-inside-avoid">
                {i > 0 && l.gapKind && (
                  <span className="mr-2 text-xs text-slate-600">
                    {l.gapKind === 'gap' && l.gapDaysFromPrevious !== null ? `↳ ${l.gapDaysFromPrevious}-day gap` : l.gapKind === 'overlap' && l.gapDaysFromPrevious !== null ? `↳ ${-l.gapDaysFromPrevious}-day overlap` : '↳ continuous'}
                  </span>
                )}
                <strong className={l.isCurrent ? 'underline' : undefined}>{l.referenceNo ?? 'Draft replacement'}</strong>{' '}
                · {l.issuingBank ?? '—'} · <Money amount={l.amount} /> · {l.issueDate ? formatDate(l.issueDate) : '—'} to {l.maturityDate ? formatDate(l.maturityDate) : '—'} · {l.status.replaceAll('_', ' ').toLowerCase()}
                {l.isCurrent && ' (this instrument)'}
              </li>
            ))}
          </ol>
        )}
      </section>

      {orders.length > 0 && (
        <section className="mt-5 break-inside-avoid" aria-label="Release order">
          <h2 className="text-base font-semibold">Release order</h2>
          {orders.map((r) => (
            <div key={r.request.id} className="mt-2 flex items-start gap-4 text-sm">
              {r.qrSvg && <QrCode svg={r.qrSvg} label={`QR code that verifies order ${r.orderNumber}`} className="size-24 shrink-0" />}
              <div>
                <p>Order No. <strong>{r.orderNumber}</strong>{r.request.closedAt && <> · approved {when(r.request.closedAt)}</>}</p>
                {r.request.refundReference && <p>Refund reference: {r.request.refundReference}</p>}
                {r.verifyUrl && <p className="text-xs">Anyone can check this order at <span className="font-mono break-all">{r.verifyUrl}</span></p>}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="mt-5" aria-label="Timeline">
        <h2 className="text-base font-semibold">Timeline</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {timeline.map((e) => (
            <li key={e.id} className="break-inside-avoid">
              <span className="mr-2 inline-block w-40 text-xs text-slate-600">{when(e.at)}</span>
              {e.label} <span className="text-xs text-slate-600">— {e.actor}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-8 border-t border-slate-400 pt-2 text-xs text-slate-600">
        Printed from the FDR Portal ({showcase ? 'prototype, sample data' : 'demo, synthetic data'}). The portal supports officials; decisions rest with the competent authority.
      </footer>
    </main>
  );
}
