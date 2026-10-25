import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import { DOC_TYPE_LABELS, INSTRUMENT_TYPE_LABELS, type InstrumentDetail, type Meta } from '@fdr/shared';
import { Button, DateText, DocChecklist, KeyValue, Money } from '@/components';
import { FIELD_LABELS, REQUIRED_FIELDS, type FormValues } from './form';

export function ReviewStep({ values, detail, meta, errors, serverMissingDocs, onSubmit, submitting, onEditDetails, dirty }: {
  values: FormValues;
  detail: InstrumentDetail;
  meta: Meta | undefined;
  errors: Record<string, string>;
  serverMissingDocs: string[];
  onSubmit: () => void;
  submitting: boolean;
  onEditDetails: () => void;
  dirty: boolean;
}) {
  const required = meta?.requiredDocs[values.type] ?? detail.requiredDocs;
  const present = detail.documents.map((d) => d.docType);
  const missingDocs = [...new Set([...required.filter((d) => !present.includes(d)), ...serverMissingDocs])];
  const emptyFields = REQUIRED_FIELDS.filter((f) => !String(values[f.key]).trim()).map((f) => f.key as string);
  const fieldProblems = [...new Set([...emptyFields, ...Object.keys(errors)])];
  const ready = !fieldProblems.length && !missingDocs.length;

  return (
    <div className="space-y-6">
      <KeyValue
        columns={3}
        items={[
          { label: 'Type', value: INSTRUMENT_TYPE_LABELS[values.type] },
          { label: 'Reference number', value: values.referenceNo || '—' },
          { label: 'Issuing bank', value: [values.issuingBank, values.branch].filter(Boolean).join(', ') || '—' },
          { label: 'Amount', value: <Money amount={detail.amount} /> },
          { label: 'Issue date', value: <DateText value={values.issueDate} /> },
          { label: 'Maturity date', value: <DateText value={values.maturityDate} /> },
          { label: 'Beneficiary', value: values.beneficiaryName || '—' },
          { label: 'Lien in favour of AICTE', value: values.lienMarked ? 'Marked' : 'Not marked' },
          { label: 'Purpose', value: values.purpose || '—' },
        ]}
      />

      <section aria-labelledby="checklist-heading">
        <h3 id="checklist-heading" className="mb-2 text-sm font-semibold text-slate-800">Before you submit</h3>
        {ready ? (
          <p className="flex items-center gap-2 text-sm text-success-700"><CheckCircle2 className="size-4" aria-hidden /> Everything required is in place.</p>
        ) : (
          <ul className="space-y-1 text-sm text-danger-700">
            {fieldProblems.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {FIELD_LABELS[f] ?? f}: {errors[f] ?? 'required'}{' '}
                  <button type="button" className="font-medium underline" onClick={onEditDetails}>Fix</button>
                </span>
              </li>
            ))}
            {missingDocs.map((d) => (
              <li key={d} className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" aria-hidden /> {DOC_TYPE_LABELS[d as keyof typeof DOC_TYPE_LABELS] ?? d}: not uploaded
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><DocChecklist required={required} present={present} /></div>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <Button onClick={onSubmit} loading={submitting} icon={<Send className="size-4" aria-hidden />}>Submit for scrutiny</Button>
        <p className="text-xs text-slate-500">
          {dirty ? 'Unsaved changes are saved first. ' : ''}
          After submission the record is locked; an AICTE officer will verify it with the bank.
        </p>
      </div>
    </div>
  );
}
