import { ArrowLeft, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { FIELD_LABELS, INSTRUMENT_TYPE_LABELS, TRACKED_FIELDS, formatDate, formatINR, type ProvenanceRow, type TrackedField } from '@fdr/shared';
import { useInstrument } from '@/api/instruments';
import {
  Button, Card, DateText, DocChecklist, DocumentList, EmptyState, KeyValue, Money, PageHeader, StatusChip, TrustChip, VerificationChip,
} from '@/components';
import { DaysLeft } from './InstitutionHome';

function displayValue(field: TrackedField, value: string): string {
  if (!value) return '—';
  if (field === 'amount') return formatINR(value);
  if (field === 'issue_date' || field === 'maturity_date') return formatDate(value);
  if (field === 'lien_marked') return value === 'true' ? 'Marked' : 'Not marked';
  return value;
}

/** Simple instrument page (becomes the passport in Phase 5). */
export function InstrumentView() {
  const { id } = useParams();
  const q = useInstrument(id);
  const d = q.data;
  if (q.isError) return <EmptyState title="Instrument not found" description="It may have been deleted, or it belongs to another institution." />;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const editable = d.status === 'DRAFT' || d.status === 'RETURNED';
  const prov = new Map<string, ProvenanceRow>(d.provenance.map((p) => [p.fieldName, p]));

  return (
    <>
      <Link to="/institution" className="mb-3 inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> My institution
      </Link>
      <PageHeader
        title={d.referenceNo ?? 'Draft instrument'}
        subtitle={`${INSTRUMENT_TYPE_LABELS[d.type]} · ${d.institutionName}`}
        actions={
          <>
            <StatusChip status={d.status} />
            {d.status !== 'DRAFT' && <VerificationChip state={d.verificationState} />}
            {editable && (
              <Link to={`/institution/instruments/${d.id}/edit`}>
                <Button size="sm" icon={<Pencil className="size-4" aria-hidden />}>{d.status === 'RETURNED' ? 'Correct and resubmit' : 'Continue editing'}</Button>
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <KeyValue
            items={[
              { label: 'Issuing bank', value: [d.issuingBank, d.branch].filter(Boolean).join(', ') || '—' },
              { label: 'Amount', value: <Money amount={d.amount} /> },
              { label: 'Issue date', value: <DateText value={d.issueDate} /> },
              { label: 'Maturity date', value: <><DateText value={d.maturityDate} /> {d.daysToMaturity !== null && <span className="text-slate-500">(<DaysLeft days={d.daysToMaturity} />)</span>}</> },
              { label: 'Beneficiary', value: d.beneficiaryName ?? '—' },
              { label: 'Lien in favour of AICTE', value: d.lienMarked ? 'Marked' : 'Not marked' },
              { label: 'Purpose', value: d.purpose ?? '—' },
              { label: 'Submitted', value: <DateText value={d.submittedAt} /> },
            ]}
          />
        </Card>
        <Card title="Required documents">
          <DocChecklist required={d.requiredDocs} present={d.documents.map((x) => x.docType)} />
        </Card>
        <Card title="What is proven" className="lg:col-span-3">
          {d.provenance.length === 0 ? (
            <p className="text-sm text-slate-500">Trust levels are recorded when the instrument is submitted.</p>
          ) : (
            <table className="min-w-full text-sm">
              <caption className="sr-only">Trust level of each field</caption>
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="py-1 pr-4 font-semibold">Field</th>
                  <th scope="col" className="py-1 pr-4 font-semibold">Recorded value</th>
                  <th scope="col" className="py-1 font-semibold">Trust level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {TRACKED_FIELDS.map((f) => {
                  const p = prov.get(f);
                  return (
                    <tr key={f}>
                      <td className="py-2 pr-4 text-slate-600">{FIELD_LABELS[f]}</td>
                      <td className="py-2 pr-4 tabular-nums">{p ? displayValue(f, p.value) : '—'}</td>
                      <td className="py-2">{p ? <TrustChip tier={p.tier} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Documents" className="lg:col-span-3">
          <DocumentList documents={d.documents} />
        </Card>
      </div>
    </>
  );
}
