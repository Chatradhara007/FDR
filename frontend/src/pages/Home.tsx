import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { apiFetch } from '@/api/client';
import { Badge, Button, Card, KeyValue, PageHeader } from '@/components';

interface Health {
  status: 'ok';
  db: 'up' | 'down';
  mockBank: 'up' | 'down';
  time: string;
}

function UpDown({ label, value }: { label: string; value: 'up' | 'down' | undefined }) {
  if (!value) return <Badge icon={<Loader2 className="size-3.5 animate-spin" aria-hidden />}>{label}: checking</Badge>;
  return value === 'up' ? (
    <Badge tone="success" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>{label}: up</Badge>
  ) : (
    <Badge tone="danger" icon={<XCircle className="size-3.5" aria-hidden />}>{label}: down</Badge>
  );
}

export function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiFetch<Health>('/health'), refetchInterval: 15_000 });
  const apiDown = health.isError;

  return (
    <>
      <PageHeader
        title="Home"
        subtitle="System status. Role-specific work queues appear here once sign-in is available."
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => health.refetch()} loading={health.isFetching}>
            Refresh
          </Button>
        }
      />
      <Card title="System status" className="max-w-xl">
        <div className="mb-4 flex flex-wrap gap-2" data-testid="health">
          {apiDown ? (
            <Badge tone="danger" icon={<XCircle className="size-3.5" aria-hidden />}>API: unreachable</Badge>
          ) : (
            <Badge tone={health.data ? 'success' : 'neutral'} icon={health.data ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Loader2 className="size-3.5 animate-spin" aria-hidden />}>
              API: {health.data ? 'up' : 'checking'}
            </Badge>
          )}
          <UpDown label="Database" value={apiDown ? 'down' : health.data?.db} />
          <UpDown label="Mock bank" value={apiDown ? 'down' : health.data?.mockBank} />
        </div>
        <KeyValue items={[{ label: 'Checked at (server time)', value: health.data ? new Date(health.data.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—' }]} />
      </Card>
    </>
  );
}
