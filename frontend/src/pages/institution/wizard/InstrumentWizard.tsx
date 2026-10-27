import { ArrowLeft, ArrowRight, Check, RotateCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { InstrumentDetail } from '@fdr/shared';
import { ApiError, missingDocumentsOf } from '@/api/client';
import {
  useCreateInstrument, useDeleteDraft, useInstrument, useMeta, usePatchInstrument, useSubmitInstrument,
} from '@/api/instruments';
import { Button, Card, EmptyState, Modal, Notice, ObservationItem, PageHeader, StatusChip, useToast } from '@/components';
import { ReturnBanner } from '../ReturnBanner';
import { ReplacementBanner } from './ReplacementBanner';
import { cn } from '@/lib/cn';
import { DetailsStep } from './DetailsStep';
import { DocumentsStep } from './DocumentsStep';
import { EMPTY_FORM, fromDetail, toBody, type FormValues } from './form';
import { ReviewStep } from './ReviewStep';

const STEPS = ['Details', 'Documents', 'Review and submit'] as const;

/** Calm step indicator: done = filled teal circle with a tick, current = ringed, later = plain; thin connectors. */
function Stepper({ step, onSelect, canLeaveDetails }: { step: number; onSelect: (s: number) => void; canLeaveDetails: boolean }) {
  return (
    <ol className="mb-6 flex items-start" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex flex-1 items-start last:flex-none">
            <button
              type="button"
              onClick={() => onSelect(i)}
              disabled={i > 0 && !canLeaveDetails}
              aria-current={current ? 'step' : undefined}
              className="group flex flex-col items-center gap-1.5 rounded-[10px] px-1 text-center disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:gap-2.5 sm:text-left"
            >
              <span className={cn('box-border flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                done && 'bg-teal text-white',
                current && 'border-[3px] border-teal bg-white text-teal',
                !done && !current && 'border-2 border-border bg-white text-muted')}>
                {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className={cn('text-sm', current ? 'font-bold text-ink' : 'font-medium text-muted group-hover:text-ink')}>
                <span className="sr-only">Step {i + 1}: </span>{label}<span className="sr-only">{done ? ' (done)' : current ? ' (current step)' : ''}</span>
              </span>
            </button>
            {i < STEPS.length - 1 && <span aria-hidden className={cn('mx-2 mt-4 h-[2px] min-w-4 flex-1 rounded-sm', done ? 'bg-teal' : 'bg-border')} />}
          </li>
        );
      })}
    </ol>
  );
}

export function InstrumentWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const step = Math.min(Math.max(Number(params.get('step') ?? 0) || 0, 0), 2);
  const setStep = (s: number) => setParams({ step: String(s) }, { replace: true });

  const meta = useMeta();
  const detailQuery = useInstrument(id);
  const detail = detailQuery.data;
  const create = useCreateInstrument();
  const patch = usePatchInstrument(id);
  const submit = useSubmitInstrument(id);
  const del = useDeleteDraft();

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missingDocs, setMissingDocs] = useState<string[]>([]);
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load the record into the form once per id (and again after an explicit reload).
  useEffect(() => {
    if (detail && loadedId !== detail.id) {
      setValues(fromDetail(detail));
      setLoadedId(detail.id);
      setDirty(false);
    }
  }, [detail, loadedId]);

  const onChange = (p: Partial<FormValues>) => {
    setValues((v) => ({ ...v, ...p }));
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(p)) delete next[k];
      return next;
    });
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'STALE_VERSION') {
      setStale(true);
      return;
    }
    if (err instanceof ApiError) {
      const fe = err.fieldErrors();
      setErrors(fe);
      setMissingDocs(missingDocumentsOf(err));
      if (Object.keys(fe).length && step !== 2) setStep(0);
      if (!Object.keys(fe).length && !missingDocumentsOf(err).length) toast.error(err.message);
      else if (step !== 2) toast.error('Some fields need attention');
      return;
    }
    toast.error(err instanceof Error ? err.message : 'Something went wrong');
  };

  /** Creates on first save, PATCHes (with version) afterwards. Resolves to the saved record or null on error. */
  const save = async (): Promise<InstrumentDetail | null> => {
    try {
      let saved: InstrumentDetail;
      if (!id) {
        saved = await create.mutateAsync({ type: values.type, ...toBody(values) });
        setLoadedId(saved.id);
      } else {
        if (!dirty && detail) return detail;
        saved = await patch.mutateAsync({
          ...toBody(values),
          ...(detail?.status === 'DRAFT' ? { type: values.type } : {}),
          version: detail!.version,
        });
      }
      setValues(fromDetail(saved));
      setDirty(false);
      setErrors({});
      return saved;
    } catch (err) {
      handleError(err);
      return null;
    }
  };

  const saveAndGo = async (next: number | null) => {
    const saved = await save();
    if (!saved) return;
    if (!id) {
      navigate(`/institution/instruments/${saved.id}/edit?step=${next ?? 0}`, { replace: true });
      toast.success('Draft saved');
      return;
    }
    if (next === null) toast.success('Draft saved');
    else setStep(next);
  };

  const onSubmit = async () => {
    const saved = await save();
    if (!saved) return;
    setMissingDocs([]);
    submit.mutate(undefined, {
      onSuccess: () => {
        toast.success('Submitted for scrutiny');
        navigate(`/instruments/${saved.id}`);
      },
      onError: handleError,
    });
  };

  const reload = async () => {
    setStale(false);
    const fresh = await detailQuery.refetch();
    if (fresh.data) {
      setValues(fromDetail(fresh.data));
      setDirty(false);
      setErrors({});
    }
  };

  if (id && detailQuery.isError) {
    return <EmptyState title="Instrument not found" description="It may have been deleted, or it belongs to another institution." />;
  }
  if (id && !detail) return <p className="text-sm text-muted">Loading…</p>;
  if (detail && detail.status !== 'DRAFT' && detail.status !== 'RETURNED') {
    return <Navigate to={`/instruments/${detail.id}`} replace />;
  }

  const saving = create.isPending || patch.isPending;

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        back={{ to: id ? `/instruments/${id}` : '/institution', label: id ? 'the deposit' : 'Home' }}
        title={id ? `Edit ${detail?.referenceNo ?? 'draft'}` : 'New instrument'}
        subtitle="Save a draft at any time; submit when the details and documents are complete."
        actions={detail && <StatusChip status={detail.status} />}
      />

      {detail?.parentInstrumentId && <ReplacementBanner parentId={detail.parentInstrumentId} />}

      {detail?.status === 'RETURNED' && (
        <>
          <ReturnBanner reason={detail.returns[0]?.reason ?? 'See the officer\'s observations'} />
          {detail.observations.length > 0 && (
            <ul className="mb-4 space-y-2">{detail.observations.map((o) => <ObservationItem key={o.id} o={o} />)}</ul>
          )}
        </>
      )}

      {stale && (
        <Notice kind="error" role="alert" className="mb-4">
          <p>This record changed in another tab — reload to see the latest version (your unsaved changes here will be discarded).</p>
          <Button size="sm" variant="secondary" className="mt-2" icon={<RotateCw className="size-4" aria-hidden />} onClick={() => void reload()}>Reload</Button>
        </Notice>
      )}

      <Stepper step={step} canLeaveDetails={!!id} onSelect={(s) => (s === step ? undefined : void saveAndGo(s))} />

      <Card>
        {step === 0 && (
          <DetailsStep values={values} onChange={onChange} errors={errors} meta={meta.data} typeLocked={detail?.status === 'RETURNED'} />
        )}
        {step === 1 && detail && <DocumentsStep detail={detail} meta={meta.data} type={values.type} />}
        {step === 2 && detail && (
          <ReviewStep
            values={values}
            detail={detail}
            meta={meta.data}
            errors={errors}
            serverMissingDocs={missingDocs}
            onSubmit={() => void onSubmit()}
            submitting={submit.isPending || saving}
            onEditDetails={() => setStep(0)}
            dirty={dirty}
          />
        )}
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {step > 0 && (
          <Button variant="secondary" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => void saveAndGo(step - 1)}>Back</Button>
        )}
        <Button variant="secondary" loading={saving} icon={<Save className="size-4" aria-hidden />} onClick={() => void saveAndGo(null)}>
          Save draft
        </Button>
        {step < 2 && (
          <Button size="lg" loading={saving} icon={<ArrowRight className="size-4" aria-hidden />} onClick={() => void saveAndGo(step + 1)}>
            Next
          </Button>
        )}
        <span className="flex-1" />
        {detail?.status === 'DRAFT' && (
          <Button variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirmDelete(true)}>Delete draft</Button>
        )}
      </div>

      <Modal
        open={confirmDelete}
        title="Delete this draft?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() => del.mutate(detail!.id, {
                onSuccess: () => { toast.info('Draft deleted'); navigate('/institution'); },
                onError: (err) => { setConfirmDelete(false); toast.error(err.message); },
              })}
            >
              Delete draft
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">The draft and its document list are removed. This is recorded in the audit trail.</p>
      </Modal>
    </div>
  );
}
