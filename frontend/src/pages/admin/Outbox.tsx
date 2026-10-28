import { Mail } from 'lucide-react';
import { useState } from 'react';
import { ROLE_LABELS, formatDateTime, type OutboxItem } from '@fdr/shared';
import { useOutbox } from '@/api/alerts';
import { Drawer, PageHeader, Pager, Table, type Column } from '@/components';

function recipient(o: OutboxItem): string {
  if (o.toInstitutionName) return `${o.toInstitutionName} (institution)`;
  if (o.toUserName) return `${o.toUserName} (${o.toRole ? ROLE_LABELS[o.toRole] : 'user'})`;
  return o.toRole ? `${ROLE_LABELS[o.toRole]} pool` : '—';
}

/** Outbox emails: what a real mailer would have sent for every new alert. */
export function Outbox() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<OutboxItem | null>(null);
  const outbox = useOutbox(page);
  const pages = outbox.data ? Math.max(1, Math.ceil(outbox.data.total / outbox.data.pageSize)) : 1;
  const columns: Column<OutboxItem>[] = [
    { key: 'when', header: 'Sent (app clock)', className: 'whitespace-nowrap', cell: (o) => formatDateTime(o.createdAt) },
    { key: 'to', header: 'To', cell: recipient },
    { key: 'subject', header: 'Subject', cell: (o) => <span className="font-medium text-ink">{o.subject}</span> },
  ];
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Outbox"
        subtitle="The emails a mailer would send for each alert. No mail server is connected; nothing leaves the portal."
      />
      <Table
        caption="Outbox emails, newest first"
        columns={columns}
        rows={outbox.data?.items}
        rowKey={(o) => String(o.id)}
        loading={outbox.isLoading}
        error={outbox.error}
        onRetry={() => void outbox.refetch()}
        emptyTitle="No emails yet"
        emptyDescription="Alerts created by the daily evaluation appear here as emails."
        onRowClick={setOpen}
      />
      <Pager page={page} pages={pages} onPage={setPage} total={outbox.data?.total} noun="messages" />
      <Drawer open={!!open} width="lg" title={open?.subject ?? ''} onClose={() => setOpen(null)}
        description={open && <span className="inline-flex items-center gap-1"><Mail className="size-4" aria-hidden /> To {recipient(open)} · {formatDateTime(open.createdAt)}</span>}>
        {open && <pre className="font-sans text-[0.9375rem] whitespace-pre-wrap text-ink">{open.body}</pre>}
      </Drawer>
    </div>
  );
}
