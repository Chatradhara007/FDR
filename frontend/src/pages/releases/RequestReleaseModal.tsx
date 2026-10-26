import { useEffect, useState } from 'react';
import { DOC_TYPE_LABELS, RELEASE_DOC_TYPES, type DocType } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useCreateRelease, useUploadReleaseDocument } from '@/api/releases';
import { Button, FieldError, Modal } from '@/components';

const selectCls = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm';

/** Release document picker shared by the request modal and the Release tab. */
export function ReleaseDocFields({ docType, onDocType, onFile, error }: {
  docType: DocType; onDocType: (d: DocType) => void; onFile: (f: File | null) => void; error?: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <label htmlFor="release-doc-type" className="mb-1 block text-xs font-medium text-slate-600">Document type</label>
        <select id="release-doc-type" className={selectCls} value={docType} onChange={(e) => onDocType(e.target.value as DocType)}>
          {RELEASE_DOC_TYPES.map((d) => <option key={d} value={d}>{DOC_TYPE_LABELS[d]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="release-doc-file" className="mb-1 block text-xs font-medium text-slate-600">File (PDF, PNG or JPEG, up to 10 MB)</label>
        <input id="release-doc-file" type="file" accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm"
          aria-invalid={!!error} aria-describedby={error ? 'release-doc-err' : undefined}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <FieldError id="release-doc-err" message={error} />
      </div>
    </div>
  );
}

/** Institution: ask AICTE to release the instrument, with the first release document. */
export function RequestReleaseModal({ open, instrumentId, onClose, onDone }: {
  open: boolean; instrumentId: string; onClose: () => void; onDone: () => void;
}) {
  const create = useCreateRelease();
  const upload = useUploadReleaseDocument();
  const [reason, setReason] = useState('');
  const [docType, setDocType] = useState<DocType>('RELEASE_LETTER');
  const [file, setFile] = useState<File | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  useEffect(() => {
    if (open) { setReason(''); setFile(null); setLocal(null); setFileError(undefined); create.reset(); upload.reset(); }
  }, [open]);
  const fields = create.error instanceof ApiError ? create.error.fieldErrors() : {};
  const general = create.error instanceof ApiError && create.error.status !== 422 ? create.error.message : null;

  const submit = () => {
    if (!reason.trim()) return setLocal('Enter the reason for the release');
    setLocal(null);
    create.mutate({ instrumentId, reason: reason.trim() }, {
      onSuccess: (view) => {
        if (!file) return onDone();
        upload.mutate({ requestId: view.request.id, file, docType }, {
          onSuccess: onDone,
          // The request exists; the document can be added again from the Release tab.
          onError: (e) => setFileError(e instanceof ApiError ? (e.fieldErrors().file ?? e.message) : 'Upload failed'),
        });
      },
    });
  };

  return (
    <Modal open={open} title="Request release" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{fileError ? 'Close' : 'Cancel'}</Button>
        {!fileError && <Button loading={create.isPending || upload.isPending} onClick={submit}>Send request</Button>}
      </>}>
      {fileError ? (
        <p className="text-warning-700">The request was sent, but the document could not be uploaded: {fileError}. Add it from the Release tab.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-slate-700">
            AICTE checks the release conditions (no open problems, bank-confirmed, documents on file), then an officer recommends
            and the competent authority decides. You can cancel until the officer recommends.
          </p>
          <div>
            <label htmlFor="release-reason" className="mb-1 block text-xs font-medium text-slate-600">Reason for the release</label>
            <textarea id="release-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              aria-invalid={!!(local ?? fields.reason)} aria-describedby="release-reason-err"
              placeholder="e.g. The approval period is over and every obligation has been fulfilled."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <FieldError id="release-reason-err" message={local ?? fields.reason} />
          </div>
          <ReleaseDocFields docType={docType} onDocType={setDocType} onFile={setFile} />
          <p className="text-xs text-slate-500">At least one release document (e.g. the release letter or the bank’s lien-removal request) is needed before the officer can recommend.</p>
          {general && <p role="alert" className="text-sm text-danger-700">{general}</p>}
        </div>
      )}
    </Modal>
  );
}
