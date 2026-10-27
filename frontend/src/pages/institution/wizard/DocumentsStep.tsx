import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { DOC_TYPE_LABELS, type DocType, type InstrumentDetail, type Meta } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useRemoveDocument, useUploadDocument } from '@/api/instruments';
import { Button, DocChecklist, DocumentList, FieldError, Notice, useToast } from '@/components';
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
        <h3 className="mb-2 text-base font-bold">Required for this type</h3>
        <DocChecklist required={required} present={present} />
      </section>

      <section className="rounded-[12px] border border-border bg-subtle p-5">
        <h3 className="mb-4 text-base font-bold">Upload a document</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="docType" className="mb-1.5 block text-sm font-semibold text-ink">Document type</label>
            <select id="docType" className={inputCls} value={chosenType} aria-invalid={!!errors.docType} aria-describedby="docType-error"
              onChange={(e) => setDocType(e.target.value as DocType)}>
              {(meta?.docTypes ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}{required.includes(t.value) ? ' (required)' : ''}</option>)}
            </select>
            <FieldError id="docType-error" message={errors.docType} />
          </div>
          <div>
            <label htmlFor="file" className="mb-1.5 block text-sm font-semibold text-ink">File</label>
            <input id="file" ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg"
              className="block w-full rounded-[10px] border border-dashed border-border bg-white p-3 text-sm file:mr-3 file:rounded-[8px] file:border-0 file:bg-chip file:px-3 file:py-1.5 file:font-semibold file:text-ink"
              aria-invalid={!!errors.file} aria-describedby="file-error" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="mt-1.5 text-[0.8125rem] text-muted">PDF, PNG or JPEG, up to 10 MB. Uploading the same file twice is flagged.</p>
            <FieldError id="file-error" message={errors.file} />
            {progress !== null && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-track" role="progressbar" aria-label="Upload progress"
                aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-teal transition-all motion-reduce:transition-none" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
          <div>
            <Button variant="dark" onClick={onUpload} loading={upload.isPending} icon={<Upload className="size-4" aria-hidden />}>Upload</Button>
          </div>
        </div>
        {duplicate && (
          <Notice kind="warning" role="alert" title="Possible duplicate" className="mt-4">{duplicate}</Notice>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-base font-bold">Uploaded</h3>
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
