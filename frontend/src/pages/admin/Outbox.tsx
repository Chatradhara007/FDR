import { Mail } from 'lucide-react';
import { useState } from 'react';
import { ROLE_LABELS, formatDateTime, type OutboxItem } from '@fdr/shared';
import { useOutbox } from '@/api/alerts';
import { Button, Modal, PageHeader, Table, type Column } from '@/components';

function recipient(o: OutboxItem): string {
  if (o.toInstitutionName) return `${o.toInstitutionName} (institution)`;
  if (o.toUserName) return `${o.toUserName} (${o.toRole ? ROLE_LABELS[o.toRole] : 'user'})`;
  return o.toRole ? `${ROLE_LABELS[o.toRole]} pool` : '—';
}

/** Simulated emails: what a real mailer would have sent for every new alert. */
export function Outbox() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<OutboxItem | null>(null);
  const outbox = useOutbox(page);
  const pages = outbox.data ? Math.max(1, Math.ceil(outbox.data.total / outbox.data.pageSize)) : 1;
  const columns: Column<OutboxItem>[] = [
    { key: 'when', header: 'Sent (app clock)', className: 'whitespace-nowrap', cell: (o) => formatDateTime(o.createdAt) },
    { key: 'to', header: 'To', cell: recipient },
    { key: 'subject', header: 'Subject', cell: (o) => <span className="font-medium text-slate-800">{o.subject}</span> },
  ];
  return (
    <div>
      <PageHeader
        title="Outbox"
        subtitle={`Simulated emails — nothing is actually sent. ${outbox.data ? `${outbox.data.total} message${outbox.data.total === 1 ? '' : 's'}.` : ''}`}
      />
      <Table
        caption="Simulated emails, newest first"
        columns={columns}
        rows={outbox.data?.items}
        rowKey={(o) => String(o.id)}
        loading={outbox.isLoading}
        emptyTitle="No emails yet"
        emptyDescription="Alerts created by the daily evaluation appear here as emails."
        onRowClick={setOpen}
      />
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <Modal open={!!open} title={open?.subject ?? ''} onClose={() => setOpen(null)} footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
        {open && (
          <div className="space-y-2">
            <p className="flex items-center gap-1 text-xs text-slate-500"><Mail className="size-3.5" aria-hidden /> To {recipient(open)} · {formatDateTime(open.createdAt)}</p>
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{open.body}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
