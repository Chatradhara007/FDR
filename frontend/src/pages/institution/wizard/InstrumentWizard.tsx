import { AlertTriangle, ArrowLeft, ArrowRight, RotateCw, Save, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { InstrumentDetail } from '@fdr/shared';
import { ApiError, missingDocumentsOf } from '@/api/client';
import {
  useCreateInstrument, useDeleteDraft, useInstrument, useMeta, usePatchInstrument, useSubmitInstrument,
} from '@/api/instruments';
import { Button, Card, EmptyState, Modal, ObservationItem, PageHeader, StatusChip, useToast } from '@/components';
import { ReturnBanner } from '../ReturnBanner';
import { ReplacementBanner } from './ReplacementBanner';
import { cn } from '@/lib/cn';
import { DetailsStep } from './DetailsStep';
import { DocumentsStep } from './DocumentsStep';
import { EMPTY_FORM, fromDetail, toBody, type FormValues } from './form';
import { ReviewStep } from './ReviewStep';

const STEPS = ['Details', 'Documents', 'Review and submit'] as const;

function Stepper({ step, onSelect, canLeaveDetails }: { step: number; onSelect: (s: number) => void; canLeaveDetails: boolean }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label}>
          <button
            type="button"
            onClick={() => onSelect(i)}
            disabled={i > 0 && !canLeaveDetails}
            aria-current={i === step ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50',
              i === step ? 'border-primary-700 bg-primary-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            <span className="tabular-nums">{i + 1}.</span> {label}
          </button>
        </li>
      ))}
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
  if (id && !detail) return <p className="text-sm text-slate-500">Loading…</p>;
  if (detail && detail.status !== 'DRAFT' && detail.status !== 'RETURNED') {
    return <Navigate to={`/instruments/${detail.id}`} replace />;
  }

  const saving = create.isPending || patch.isPending;

  return (
    <>
      <PageHeader
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
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-danger-600/30 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p className="flex-1">This record changed in another tab — reload to see the latest version (your unsaved changes here will be discarded).</p>
          <Button size="sm" variant="secondary" icon={<RotateCw className="size-4" aria-hidden />} onClick={() => void reload()}>Reload</Button>
        </div>
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {step > 0 && (
          <Button variant="secondary" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => void saveAndGo(step - 1)}>Back</Button>
        )}
        <Button variant="secondary" loading={saving} icon={<Save className="size-4" aria-hidden />} onClick={() => void saveAndGo(null)}>
          Save draft
        </Button>
        {step < 2 && (
          <Button loading={saving} icon={<ArrowRight className="size-4" aria-hidden />} onClick={() => void saveAndGo(step + 1)}>
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
        <p className="text-sm text-slate-700">The draft and its document list are removed. This is recorded in the audit trail.</p>
      </Modal>
    </>
  );
}
