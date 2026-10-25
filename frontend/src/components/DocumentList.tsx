import { Download, Eye, FileText, Trash2 } from 'lucide-react';
import { DOC_TYPE_LABELS, type DocumentInfo } from '@fdr/shared';
import { apiDownload, apiOpenInTab } from '@/api/client';
import { documentPath } from '@/api/instruments';
import { Button } from './Button';
import { DateText } from './DateText';
import { useToast } from './Toast';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Live documents with authorised download / preview; remove only when `onRemove` is given. */
export function DocumentList({ documents, onRemove, removingId }: {
  documents: DocumentInfo[];
  onRemove?: (doc: DocumentInfo) => void;
  removingId?: string | null;
}) {
  const toast = useToast();
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not open the file');
  if (!documents.length) return <p className="text-sm text-slate-500">No documents uploaded yet.</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {documents.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-slate-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-800">{DOC_TYPE_LABELS[d.docType] ?? d.docType}</p>
            <p className="truncate text-xs text-slate-500">
              {d.filename} · {formatSize(d.sizeBytes)} · SHA-256 <code title={d.sha256}>{d.sha256.slice(0, 12)}…</code> · <DateText value={d.uploadedAt} />
            </p>
          </div>
          <Button size="sm" variant="ghost" icon={<Eye className="size-4" aria-hidden />}
            onClick={() => apiOpenInTab(documentPath(d.instrumentId, d.id, 'preview')).catch(fail)}>
            Preview
          </Button>
          <Button size="sm" variant="ghost" icon={<Download className="size-4" aria-hidden />}
            onClick={() => apiDownload(documentPath(d.instrumentId, d.id, 'download'), d.filename).catch(fail)}>
            Download
          </Button>
          {onRemove && (
            <Button size="sm" variant="ghost" loading={removingId === d.id} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => onRemove(d)}>
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
