import { useState } from 'react';
import { Ban, ExternalLink, Printer, Send, Undo2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DocType, ReleaseView } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useCancelRelease, useResubmitRelease, useUploadReleaseDocument } from '@/api/releases';
import { useAuth } from '@/auth/AuthContext';
import { Button, DateText, DocumentList, Modal, ReleaseStatusChip, useToast } from '@/components';
import { NoteModal } from '@/components/NoteModal';
import { ApprovalChain, BlockedBanner, ConditionsList, ReleaseTracker } from '@/pages/releases/parts';
import { releasePath } from '@/pages/releases/ReleaseList';
import { ReleaseDocFields } from '@/pages/releases/RequestReleaseModal';

function AddDocument({ requestId }: { requestId: string }) {
  const toast = useToast();
  const upload = useUploadReleaseDocument();
  const [docType, setDocType] = useState<DocType>('RELEASE_LETTER');
  const [file, setFile] = useState<File | null>(null);
  const error = upload.error instanceof ApiError ? (upload.error.fieldErrors().file ?? upload.error.message) : undefined;
  return (
    <div className="mt-3 space-y-2 rounded-[10px] bg-subtle p-3">
      <ReleaseDocFields docType={docType} onDocType={setDocType} onFile={setFile} error={error} />
      <Button size="sm" variant="secondary" icon={<Upload className="size-4" aria-hidden />} disabled={!file} loading={upload.isPending}
        onClick={() => file && upload.mutate({ requestId, file, docType }, { onSuccess: () => { setFile(null); toast.success('Document added to the release request'); } })}>
        Upload
      </Button>
    </div>
  );
}

function RequestCard({ view }: { view: ReleaseView }) {
  const { user } = useAuth();
  const toast = useToast();
  const r = view.request;
  const internal = user?.role !== 'institution';
  const resubmit = useResubmitRelease(r.id);
  const cancel = useCancelRelease(r.id);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const level = view.currentLevelInfo;
  return (
    <article className="rounded-[14px] border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ReleaseStatusChip status={r.status} />
            {level && <span className="text-xs text-muted">Level {level.level} of {r.requiredLevels.length}: {level.label}</span>}
          </div>
          <p className="mt-1 text-xs text-muted">Requested by {r.requestedByName} on <DateText value={r.requestedAt} /></p>
          <p className="mt-2 text-sm text-ink">“{r.reason}”</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {internal && (
            <Link to={releasePath(user?.role, r.id)}><Button size="sm" variant="secondary" icon={<ExternalLink className="size-4" aria-hidden />}>Open release review</Button></Link>
          )}
          {view.orderNumber && (
            <Link to={`/releases/${r.id}/order`}><Button size="sm" variant="secondary" icon={<Printer className="size-4" aria-hidden />}>Release order {view.orderNumber}</Button></Link>
          )}
          {view.canResubmit && <Button size="sm" icon={<Send className="size-4" aria-hidden />} onClick={() => { resubmit.reset(); setResubmitOpen(true); }}>Resubmit</Button>}
          {view.canCancel && <Button size="sm" variant="secondary" icon={<Ban className="size-4" aria-hidden />} onClick={() => setCancelOpen(true)}>Cancel request</Button>}
        </div>
      </div>
      {r.status === 'RETURNED' && r.returnMessage && (
        <p className="mt-3 flex items-start gap-2 rounded-[10px] bg-attn-tint px-4 py-3 text-sm text-attn-text">
          <Undo2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><span className="font-semibold">Returned by AICTE:</span> “{r.returnMessage}”. Add what is asked for, then resubmit.</span>
        </p>
      )}
      {r.status === 'APPROVED' && <p className="mt-3 text-sm text-teal-hover">Released on <DateText value={r.closedAt} />{r.refundReference ? ` · refund reference ${r.refundReference}` : ''}.</p>}
      {r.status !== 'APPROVED' && <ReleaseTracker view={view} />}
      <div className="mt-5"><BlockedBanner view={view} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-1 text-sm font-semibold text-ink-2">Conditions for release</h3>
          <ConditionsList view={view} internal={internal} />
        </section>
        <section className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">Release documents ({view.documents.length})</h3>
            <DocumentList documents={view.documents} />
            {view.canUploadDocuments && <AddDocument requestId={r.id} />}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">Decisions</h3>
            <ApprovalChain view={view} />
          </div>
        </section>
      </div>

      <NoteModal open={resubmitOpen} title="Resubmit release request" label="Note for AICTE" submitLabel="Resubmit"
        intro="Say what you added or changed. The request goes back to the scrutiny officer; earlier decisions stay on record."
        pending={resubmit.isPending} error={resubmit.error} onClose={() => setResubmitOpen(false)}
        onSubmit={(note) => resubmit.mutate(note, { onSuccess: () => { setResubmitOpen(false); toast.success('Release request resubmitted'); } })} />
      <Modal open={cancelOpen} title="Cancel the release request?" onClose={() => setCancelOpen(false)}
        footer={<>
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep it</Button>
          <Button variant="danger" loading={cancel.isPending}
            onClick={() => cancel.mutate(undefined, {
              onSuccess: () => { setCancelOpen(false); toast.success('Release request cancelled'); },
              onError: (e) => { setCancelOpen(false); toast.error(e.message); },
            })}>
            Cancel request
          </Button>
        </>}>
        <p>The instrument goes back to the status it had before the request. You can make a new request later.</p>
      </Modal>
    </article>
  );
}

/** The passport's Release tab: every release request for the instrument, newest first. */
export function ReleaseTab({ requests }: { requests: ReleaseView[] }) {
  if (!requests.length) return <p className="text-sm text-muted">No release request has been made for this instrument.</p>;
  return <div className="space-y-4">{requests.map((v) => <RequestCard key={v.request.id} view={v} />)}</div>;
}
