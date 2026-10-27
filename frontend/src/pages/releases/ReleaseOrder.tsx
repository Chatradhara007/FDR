import { Printer } from 'lucide-react';
import { BackLink } from '@/components/PageHeader';
import { Link, useParams } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, RELEASE_DECISION_LABELS, formatDate, formatINR } from '@fdr/shared';
import { useReleaseRequest } from '@/api/releases';
import { Button, EmptyState, QrCode } from '@/components';

const day = (d: string | null) => (d ? formatDate(d) : '—');
const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' });
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** Printable Release / Discharge Order (browser print to PDF). Plain government-letter styling. */
export function ReleaseOrder() {
  const { id = '' } = useParams();
  const q = useReleaseRequest(id);
  if (q.isError) return <EmptyState title="Release order not found" description="Check the link." />;
  const view = q.data;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!view.orderNumber || !view.request.closedAt) {
    return <EmptyState title="No release order yet" description="An order is issued once the competent authority approves the release." />;
  }
  const inst = view.instrument;
  const r = view.request;
  const decisions = view.approvals.filter((a) => a.decision === 'RECOMMEND' || a.decision === 'APPROVE');
  const lastRound = decisions.slice(decisions.map((a) => a.decision).lastIndexOf('RECOMMEND'));
  const rows: [string, string][] = [
    ['Institution', inst.institutionName],
    ['Instrument', `${INSTRUMENT_TYPE_LABELS[inst.type]} No. ${inst.referenceNo ?? '—'}`],
    ['Issuing bank', `${inst.issuingBank ?? '—'}${inst.branch ? `, ${inst.branch}` : ''}`],
    ['Amount', inst.amount ? formatINR(inst.amount) : '—'],
    ['Issue date / maturity date', `${day(inst.issueDate)} / ${day(inst.maturityDate)}`],
    ['In favour of', inst.beneficiaryName ?? '—'],
    ['Refund reference', r.refundReference ?? 'Not recorded'],
  ];

  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <BackLink to={`/instruments/${inst.id}`} label="the deposit’s passport" />
        <Button icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>Print / save as PDF</Button>
      </div>
      <article className="mx-auto max-w-3xl bg-white p-10 font-serif text-[15px] leading-relaxed text-black shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="border-b-2 border-black pb-3 text-center">
          <p className="text-lg font-bold tracking-wide">ALL INDIA COUNCIL FOR TECHNICAL EDUCATION</p>
          <p className="text-sm">Nelson Mandela Marg, Vasant Kunj, New Delhi – 110070</p>
        </header>
        <div className="mt-4 flex items-start justify-between gap-4 text-sm">
          <div>
            <p>Order No. <span className="font-semibold">{view.orderNumber}</span></p>
            <p>Dated {istDay(view.request.closedAt ?? r.requestedAt)}</p>
          </div>
          {view.qrSvg && view.verifyUrl && (
            <figure className="flex w-32 shrink-0 flex-col items-center text-center text-[11px] leading-tight">
              <QrCode svg={view.qrSvg} label={`QR code that verifies order ${view.orderNumber}`} className="size-28" />
              <figcaption className="mt-1">Scan to verify this order<br /><span className="break-all font-mono">{view.verifyUrl}</span></figcaption>
            </figure>
          )}
        </div>
        <h1 className="mt-6 text-center text-base font-bold underline">RELEASE / DISCHARGE ORDER</h1>
        <p className="mt-4">
          With reference to the request of the institution dated {istDay(r.requestedAt)} for release of the
          security instrument described below, and on verification of the conditions prescribed for release, the competent
          authority has approved its release and discharge. The issuing bank may remove the lien marked in favour of AICTE
          and the amount may be refunded to the institution.
        </p>
        <table className="mt-4 w-full border-collapse text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><th scope="row" className="w-1/3 border border-black px-2 py-1 text-left font-semibold">{k}</th><td className="border border-black px-2 py-1">{v}</td></tr>
            ))}
          </tbody>
        </table>
        <h2 className="mt-6 font-bold">Conditions verified</h2>
        <ol className="mt-1 list-decimal pl-6 text-sm">
          {view.conditions.map((c) => <li key={c.id}>{c.description} — {c.met ? 'met' : 'not met'}</li>)}
        </ol>
        <h2 className="mt-6 font-bold">Approval chain</h2>
        <table className="mt-1 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="border border-black px-2 py-1 text-left">Level</th>
              <th scope="col" className="border border-black px-2 py-1 text-left">Name and designation</th>
              <th scope="col" className="border border-black px-2 py-1 text-left">Decision</th>
              <th scope="col" className="border border-black px-2 py-1 text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {lastRound.map((a) => (
              <tr key={a.id}>
                <td className="border border-black px-2 py-1">{a.level}. {a.label}</td>
                <td className="border border-black px-2 py-1">{a.approverName}{a.approverDesignation ? `, ${a.approverDesignation}` : ''}</td>
                <td className="border border-black px-2 py-1">{RELEASE_DECISION_LABELS[a.decision]}</td>
                <td className="border border-black px-2 py-1">{when(a.decidedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-10 text-right text-sm">(Competent Authority)<br />All India Council for Technical Education</p>
        <p className="mt-10 border-t border-black pt-2 text-center text-xs">
          Generated by FDR Portal (demo) — not a legal document. Copy to: the institution; the issuing bank; the accounts section.
        </p>
      </article>
    </>
  );
}
