import { AlertTriangle, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { DOC_TYPE_LABELS, type DocType, type InstrumentDetail, type Meta } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useRemoveDocument, useUploadDocument } from '@/api/instruments';
import { Button, DocChecklist, DocumentList, FieldError, useToast } from '@/components';
import { inputCls, type FormValues } from './form';

export function DocumentsStep({ detail, meta, type }: { detail: InstrumentDetail; meta: Meta | undefined; type: FormValues['type'] }) {
  const toast = useToast();
  const required = meta?.requiredDocs[type] ?? [];
  const present = detail.documents.map((d) => d.docType);
  const firstMissing = required.find((d) => !present.includes(d));
  const [docType, setDocType] = useState<DocType | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useUploadDocument(detail.id);
  const remove = useRemoveDocument(detail.id);
  const chosenType = docType || firstMissing || 'OTHER';

  const onUpload = () => {
    setErrors({});
    setDuplicate(null);
    if (!file) return setErrors({ file: 'Choose a file to upload' });
    setProgress(0);
    upload.mutate(
      { file, docType: chosenType, onProgress: setProgress },
      {
        onSuccess: (res) => {
          toast.success(`${DOC_TYPE_LABELS[chosenType]} uploaded`);
          if (res.duplicateOf) {
            const other = detail.documents.find((d) => d.id === res.duplicateOf);
            setDuplicate(`This file is identical to the ${other ? `${DOC_TYPE_LABELS[other.docType]} (${other.filename})` : 'document'} already uploaded. Remove one if it was a mistake.`);
          }
          setFile(null);
          setDocType('');
          if (fileInput.current) fileInput.current.value = '';
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) setErrors(err.fieldErrors());
          else setErrors({ file: err.message });
        },
        onSettled: () => setProgress(null),
      },
    );
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Required for this type</h3>
        <DocChecklist required={required} present={present} />
      </section>

      <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Upload a document</h3>
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-start">
          <div>
            <label htmlFor="docType" className="mb-1 block text-xs font-medium text-slate-600">Document type</label>
            <select id="docType" className={inputCls} value={chosenType} aria-invalid={!!errors.docType} aria-describedby="docType-error"
              onChange={(e) => setDocType(e.target.value as DocType)}>
              {(meta?.docTypes ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}{required.includes(t.value) ? ' (required)' : ''}</option>)}
            </select>
            <FieldError id="docType-error" message={errors.docType} />
          </div>
          <div>
            <label htmlFor="file" className="mb-1 block text-xs font-medium text-slate-600">File (PDF, PNG or JPEG, up to 10 MB)</label>
            <input id="file" ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm"
              aria-invalid={!!errors.file} aria-describedby="file-error" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <FieldError id="file-error" message={errors.file} />
            {progress !== null && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-label="Upload progress"
                aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-primary-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="sm:pt-5">
            <Button onClick={onUpload} loading={upload.isPending} icon={<Upload className="size-4" aria-hidden />}>Upload</Button>
          </div>
        </div>
        {duplicate && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-warning-600/30 bg-warning-50 px-3 py-2 text-sm text-warning-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {duplicate}
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Uploaded</h3>
        <DocumentList
          documents={detail.documents}
          removingId={remove.isPending ? remove.variables : null}
          onRemove={(d) => remove.mutate(d.id, {
            onSuccess: () => toast.info(`${DOC_TYPE_LABELS[d.docType]} removed`),
            onError: (err) => toast.error(err.message),
          })}
        />
      </section>
    </div>
  );
}
