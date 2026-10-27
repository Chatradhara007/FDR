import { Database, Download, FastForward, Landmark, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BANKS, formatDate, formatINR, type DemoAnchor } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { downloadSample, type SampleName, useAnchors, useBankCorrection, useResetDemo, useTamper, useUndoTamper } from '@/api/demo';
import { Badge, Button, Card, FieldError, Modal, PageHeader, StatusChip, Table, VerificationChip, summaryText, useToast, type Column } from '@/components';
import { useClock, useClockMutation } from '@/hooks/useClock';

const A5_CORRECTION = { bank: 'Punjab National Bank', referenceNo: 'PUNB/FDR/2024/77015', fields: { amount: '1500000.00' } };

/** Admin → Demo tools (DEMO_MODE only): reset, clock presets, bank correction, tamper, and the demo anchors. */
export function DemoTools() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        title="Demo tools"
        subtitle="Tools for running the judged demo on synthetic data. They exist only while the portal runs in demo mode."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <ResetCard />
        <JumpCard />
        <BankCorrectionCard />
        <TamperCard />
      </div>
      <AnchorsCard />
    </div>
  );
}

function ResetCard() {
  const toast = useToast();
  const reset = useResetDemo();
  const [confirm, setConfirm] = useState(false);
  const run = () =>
    reset.mutate(undefined, {
      onSuccess: (r) => {
        setConfirm(false);
        toast.success(`Demo data reset in ${(r.durationMs / 1000).toFixed(1)} s: ${r.instruments} instruments, ${r.events} events, ${r.alerts} alerts. App date ${formatDate(r.d0)} (simulated).`);
      },
      onError: (err) => {
        setConfirm(false);
        toast.error(err instanceof Error ? err.message : 'Reset failed');
      },
    });
  return (
    <Card title="Reset demo data">
      <p className="mb-4 text-[0.9375rem] text-muted">
        Wipes everything and replays the demo dataset (60 instruments with their history) through the real services.
        The app clock ends <strong>simulated at today's date</strong>. Takes about 15 seconds; you stay signed in.
      </p>
      <Button icon={<Database className="size-4" aria-hidden />} loading={reset.isPending} onClick={() => setConfirm(true)}>
        Reset demo data
      </Button>
      <Modal
        open={confirm}
        title="Reset the demo data?"
        onClose={() => !reset.isPending && setConfirm(false)}
        footer={
          <>
            <Button variant="secondary" disabled={reset.isPending} onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" loading={reset.isPending} onClick={run}>Reset everything</Button>
          </>
        }
      >
        <p>Every instrument, alert, release request, user change and audit event is deleted and the demo dataset is rebuilt. This cannot be undone.</p>
      </Modal>
    </Card>
  );
}

function JumpCard() {
  const toast = useToast();
  const clock = useClock();
  const mutation = useClockMutation();
  const anchors = useAnchors();
  const a2 = anchors.data?.find((a) => a.code === 'A2');
  const today = clock.data?.today;
  const notify = {
    onSuccess: ({ clock: c, summary }: { clock: { today: string }; summary: Parameters<typeof summaryText>[0] }) =>
      toast.success(`App date ${formatDate(c.today)} (simulated): ${summaryText(summary)}`),
    onError: (err: Error) => toast.error(err.message),
  };
  return (
    <Card title="Jump the clock">
      <p className="mb-4 text-[0.9375rem] text-muted">
        Same as the clock controls in the header: the daily evaluation runs for the new date at once.
        {today && <> App date now: <strong>{formatDate(today)}</strong>.</>}
      </p>
      <div className="flex flex-wrap gap-2">
        {[7, 30, 45].map((days) => (
          <Button key={days} variant="secondary" icon={<FastForward className="size-4" aria-hidden />} disabled={mutation.isPending}
            onClick={() => mutation.mutate({ kind: 'advance', days }, notify)}>
            +{days} days
          </Button>
        ))}
        <Button
          variant="secondary"
          disabled={mutation.isPending || !a2?.maturityDate || (!!today && a2.maturityDate <= today)}
          onClick={() => a2?.maturityDate && mutation.mutate({ kind: 'set', date: a2.maturityDate }, notify)}
        >
          To maturity of A2{a2?.maturityDate ? ` (${formatDate(a2.maturityDate)})` : ''}
        </Button>
      </div>
    </Card>
  );
}

function BankCorrectionCard() {
  const toast = useToast();
  const correct = useBankCorrection();
  const [bank, setBank] = useState(A5_CORRECTION.bank);
  const [ref, setRef] = useState(A5_CORRECTION.referenceNo);
  const [amount, setAmount] = useState('15,00,000');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const send = (body: { bank: string; referenceNo: string; fields: { amount?: string } }) =>
    correct.mutate(body, {
      onSuccess: (r) => {
        setErrors({});
        toast.success(`Bank record ${r.after.referenceNo} corrected: amount ${formatINR(r.before.amount)} → ${formatINR(r.after.amount)}. Re-verify the instrument to pick it up.`);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 422) setErrors(err.fieldErrors());
        else toast.error(err instanceof Error ? err.message : 'Correction failed');
      },
    });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send({ bank, referenceNo: ref, fields: { amount } });
  };
  return (
    <Card title="Bank correction (demo step 7)">
      <p className="mb-4 text-[0.9375rem] text-muted">
        Simulates the bank correcting its own record after the institution's representation. Only the mock bank changes;
        the officer still has to <strong>re-verify</strong>.
      </p>
      <Button variant="dark" icon={<Landmark className="size-4" aria-hidden />} loading={correct.isPending} onClick={() => send(A5_CORRECTION)}>
        A5: bank confirms ₹15,00,000
      </Button>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-3" noValidate>
        <div>
          <label htmlFor="bc-bank" className="mb-1.5 block text-sm font-semibold text-ink">Bank</label>
          <select id="bc-bank" value={bank} onChange={(e) => setBank(e.target.value)} className="gov-input">
            {BANKS.map((b) => <option key={b}>{b}</option>)}
          </select>
          <FieldError id="bc-bank-error" message={errors.bank} />
        </div>
        <div>
          <label htmlFor="bc-ref" className="mb-1.5 block text-sm font-semibold text-ink">Reference number</label>
          <input id="bc-ref" value={ref} onChange={(e) => setRef(e.target.value)} className="gov-input" />
          <FieldError id="bc-ref-error" message={errors.referenceNo} />
        </div>
        <div>
          <label htmlFor="bc-amount" className="mb-1.5 block text-sm font-semibold text-ink">Bank's amount (₹)</label>
          <input id="bc-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="gov-input tabular-nums" />
          <FieldError id="bc-amount-error" message={errors['fields.amount'] ?? errors.fields} />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" loading={correct.isPending}>Correct this record</Button>
        </div>
      </form>
    </Card>
  );
}

function TamperCard() {
  const toast = useToast();
  const tamper = useTamper();
  const undo = useUndoTamper();
  return (
    <Card title="Tamper with the audit log (demo step 8)">
      <p className="mb-4 text-[0.9375rem] text-muted">
        Changes the data of one stored event (the latest submission: its amount goes up by ₹10 lakh) <em>without</em> recomputing
        its hash. The auditor's integrity check then fails at that event. Undo restores the original, and the chain verifies again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" icon={<ShieldAlert className="size-4" aria-hidden />} loading={tamper.isPending}
          onClick={() => tamper.mutate(undefined, {
            onSuccess: (r) => toast.warning(`Event #${r.eventId} altered. Open the audit log to see the integrity check fail.`),
            onError: (err) => toast.error(err.message),
          })}>
          Tamper with one event
        </Button>
        <Button variant="secondary" icon={<Undo2 className="size-4" aria-hidden />} loading={undo.isPending}
          onClick={() => undo.mutate(undefined, {
            onSuccess: (r) => toast.success(`Restored ${r.restored.length} event${r.restored.length === 1 ? '' : 's'}; the log verifies again.`),
            onError: (err) => toast.info(err.message),
          })}>
          Undo tampering
        </Button>
        <Link to="/audit" className="inline-flex items-center gap-1 self-center text-sm font-medium text-teal hover:underline">
          <ShieldCheck className="size-4" aria-hidden /> Open the audit log
        </Link>
      </div>
    </Card>
  );
}

function AnchorsCard() {
  const anchors = useAnchors();
  const toast = useToast();
  const sample = (name: SampleName) => downloadSample(name).catch((err: Error) => toast.error(err.message));
  const columns: Column<DemoAnchor>[] = [
    { key: 'code', header: 'Anchor', cell: (a) => <span className="font-semibold">{a.code}</span> },
    {
      key: 'ref', header: 'Reference', cell: (a) => (a.instrumentId
        ? <Link className="mono font-medium text-teal hover:underline" to={`/instruments/${a.instrumentId}`}>{a.reference}</Link>
        : <span className="font-medium">{a.reference}</span>),
    },
    {
      key: 'state', header: 'State now', cell: (a) => (a.status
        ? <span className="flex flex-wrap gap-1"><StatusChip status={a.status} />{a.verificationState && <VerificationChip state={a.verificationState} />}</span>
        : <Badge tone="neutral">Bank record only</Badge>),
    },
    { key: 'purpose', header: 'Used for', className: 'min-w-72', cell: (a) => <AnchorPurpose a={a} /> },
    { key: 'who', header: 'Sign in as', cell: (a) => <span className="whitespace-nowrap">{a.signInAsName ?? a.signInAs}<br /><span className="text-[0.8125rem] text-muted">{a.signInAs}</span></span> },
  ];
  return (
    <Card
      title="Demo anchors"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Download className="size-4" aria-hidden />} onClick={() => void sample('fdr-copy')}>A1 FDR copy</Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" aria-hidden />} onClick={() => void sample('fdr-copy-different-amount')}>A1 FDR copy with a different amount</Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" aria-hidden />} onClick={() => void sample('bank-letter')}>A1 bank letter</Button>
        </div>
      }
    >
      <p className="mb-4 text-[0.9375rem] text-muted">
        Stable records the demo script (<code>docs/demo-script.md</code>) uses.
        Everyone's password is <code>Demo@123</code>. The sample PDFs carry A1's values for step 1.
      </p>
      <Table caption="Demo anchors" columns={columns} rows={anchors.data} rowKey={(a) => a.code} loading={anchors.isLoading}
        emptyTitle="No anchors" emptyDescription="Reset the demo data to create them." />
    </Card>
  );
}

function AnchorPurpose({ a }: { a: DemoAnchor }) {
  const r = a.bankRecord;
  return (
    <div className="space-y-1">
      <p>{a.purpose}</p>
      {r && (
        <p className="text-[0.8125rem] text-muted">
          Bank record: <span className="mono">{r.referenceNo}</span> · <span className="tabular-nums">{formatINR(r.amount)}</span> · issued {formatDate(r.issueDate)} · matures {formatDate(r.maturityDate)} · {r.beneficiaryName}
        </p>
      )}
    </div>
  );
}
