import { amountInWords, normAmount, type Meta } from '@fdr/shared';
import type { ReactNode } from 'react';
import { FieldError } from '@/components';
import { BENEFICIARY_HINT, groupAmountInput, inputCls, type FormValues } from './form';

function Field({ id, label, error, hint, children, required }: {
  id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-xs font-normal text-slate-500">(required to submit)</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function words(amount: string): string | null {
  try {
    return amount ? amountInWords(normAmount(amount)) : null;
  } catch {
    return null;
  }
}

export function DetailsStep({ values, onChange, errors, meta, typeLocked }: {
  values: FormValues;
  onChange: (patch: Partial<FormValues>) => void;
  errors: Record<string, string>;
  meta: Meta | undefined;
  typeLocked: boolean;
}) {
  const a = (field: string) => ({ 'aria-invalid': !!errors[field], 'aria-describedby': `${field}-error` });
  const lienRequired = meta?.lienRequired[values.type];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="type" label="Instrument type" error={errors.type} hint={typeLocked ? 'The type can only be changed while the instrument is a draft.' : undefined}>
        <select id="type" className={inputCls} value={values.type} disabled={typeLocked} {...a('type')}
          onChange={(e) => onChange({ type: e.target.value as FormValues['type'] })}>
          {(meta?.instrumentTypes ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field id="referenceNo" label="Reference number" required error={errors.referenceNo} hint="As printed on the receipt, e.g. SBIN/FDR/2026/00731">
        <input id="referenceNo" className={inputCls} value={values.referenceNo} {...a('referenceNo')} autoComplete="off"
          onChange={(e) => onChange({ referenceNo: e.target.value })} />
      </Field>
      <Field id="issuingBank" label="Issuing bank" required error={errors.issuingBank} hint="Start typing to search the list">
        <input id="issuingBank" list="bank-options" className={inputCls} value={values.issuingBank} {...a('issuingBank')} autoComplete="off"
          onChange={(e) => onChange({ issuingBank: e.target.value })} />
        <datalist id="bank-options">
          {(meta?.banks ?? []).map((b) => <option key={b} value={b} />)}
        </datalist>
      </Field>
      <Field id="branch" label="Branch" error={errors.branch}>
        <input id="branch" className={inputCls} value={values.branch} {...a('branch')} onChange={(e) => onChange({ branch: e.target.value })} />
      </Field>
      <Field id="amount" label="Amount (₹)" required error={errors.amount} hint={words(values.amount) ?? 'Indian grouping, e.g. 25,00,000'}>
        <input id="amount" inputMode="decimal" className={`${inputCls} tabular-nums`} value={values.amount} {...a('amount')}
          onChange={(e) => onChange({ amount: groupAmountInput(e.target.value) })} />
      </Field>
      <div />
      <Field id="issueDate" label="Issue date" required error={errors.issueDate}>
        <input id="issueDate" type="date" className={inputCls} value={values.issueDate} {...a('issueDate')}
          onChange={(e) => onChange({ issueDate: e.target.value })} />
      </Field>
      <Field id="maturityDate" label="Maturity date" required error={errors.maturityDate}>
        <input id="maturityDate" type="date" className={inputCls} value={values.maturityDate} {...a('maturityDate')}
          onChange={(e) => onChange({ maturityDate: e.target.value })} />
      </Field>
      <Field
        id="beneficiaryName"
        label="Beneficiary name"
        required
        error={errors.beneficiaryName}
        hint={
          values.beneficiaryName ? undefined : (
            <>Usually “{BENEFICIARY_HINT}”.{' '}
              <button type="button" className="font-medium text-primary-700 underline" onClick={() => onChange({ beneficiaryName: BENEFICIARY_HINT })}>
                Use this
              </button>
            </>
          )
        }
      >
        <input id="beneficiaryName" className={inputCls} placeholder={BENEFICIARY_HINT} value={values.beneficiaryName} {...a('beneficiaryName')}
          onChange={(e) => onChange({ beneficiaryName: e.target.value })} />
      </Field>
      <div className="flex flex-col justify-end">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4" checked={values.lienMarked} {...a('lienMarked')} onChange={(e) => onChange({ lienMarked: e.target.checked })} />
          Lien marked in favour of AICTE
        </label>
        {lienRequired && !values.lienMarked && (
          <p className="mt-1 text-xs text-warning-700">AICTE requires a lien on FDRs; the officer will check this before acceptance.</p>
        )}
        <FieldError id="lienMarked-error" message={errors.lienMarked} />
      </div>
      <div className="sm:col-span-2">
        <Field id="purpose" label="Purpose" error={errors.purpose} hint="Optional, up to 200 characters">
          <input id="purpose" className={inputCls} value={values.purpose} maxLength={200} {...a('purpose')}
            onChange={(e) => onChange({ purpose: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
