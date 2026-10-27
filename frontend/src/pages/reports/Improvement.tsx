import { Download, FlaskConical, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { formatDate, type ImprovementMetric } from '@fdr/shared';
import { downloadImprovement, useImprovement } from '@/api/reporting';
import { Badge, Button, ErrorState, LoadingState, PageHeader, Panel, Table, useToast, type Column } from '@/components';

function SimulatedTag({ label }: { label: string }) {
  return <Badge tone="warning" icon={<FlaskConical className="size-3.5" aria-hidden />}>{label}</Badge>;
}

const columns: Column<ImprovementMetric>[] = [
  {
    key: 'metric', header: 'Measure', className: 'min-w-[16rem]',
    cell: (m) => <><span className="block font-semibold text-ink">{m.title}</span><span className="block text-[0.8125rem] text-muted">{m.explanation}</span></>,
  },
  { key: 'manual', header: 'Manual (baseline)', align: 'right', cell: (m) => <span className="text-lg font-semibold">{m.manual.display}</span> },
  { key: 'portal', header: 'Portal', align: 'right', cell: (m) => <span className="text-lg font-bold text-teal">{m.portal.display}</span> },
  {
    key: 'better', header: 'Better when', className: 'whitespace-nowrap', cell: (m) => {
      const Better = m.better === 'lower' ? TrendingDown : TrendingUp;
      return <span className="inline-flex items-center gap-1 text-muted"><Better className="size-4" aria-hidden />{m.better === 'lower' ? 'Lower' : 'Higher'}{m.sampleSize !== null && ` · ${m.sampleSize} case(s)`}</span>;
    },
  },
  { key: 'label', header: 'Source', cell: (m) => <SimulatedTag label={m.label} /> },
];

/** /reports/improvement: manual vs portal in one table, every row labelled "Simulated on demo data" (D26). */
export function Improvement() {
  const q = useImprovement();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try { await downloadImprovement(); } catch (err) { toast.error((err as Error).message); } finally { setDownloading(false); }
  };
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader back={{ to: '/reports', label: 'Reports' }} title="Improvement metrics" subtitle="The portal's own figures next to the assumed manual process."
        actions={<Button icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void download()}>Download CSV</Button>} />
      {q.isError && <Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} title="The metrics could not be loaded" /></Panel>}
      {q.isLoading && <Panel><LoadingState rows={4} label="Loading the metrics…" /></Panel>}
      {q.data && (
        <>
          <div className="mb-6 rounded-[14px] border border-attn-border border-l-[5px] border-l-attn bg-attn-tint px-5 py-4 text-sm text-attn-text" role="note">
            <p className="flex items-center gap-2 font-bold"><FlaskConical className="size-4" aria-hidden />{q.data.label}</p>
            <p className="mt-1">Baseline: {q.data.baselineNote} The baseline is set in the rules (improvement_baseline). As of {formatDate(q.data.asOf)}.</p>
          </div>
          <Table caption="Manual process compared with the portal" columns={columns} rows={q.data.metrics} rowKey={(m) => m.key} rowTestId="improvement-card"
            emptyTitle="No metrics yet" />
        </>
      )}
    </div>
  );
}
