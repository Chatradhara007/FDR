import { Download, FlaskConical, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { formatDate, type ImprovementMetric } from '@fdr/shared';
import { downloadImprovement, useImprovement } from '@/api/reporting';
import { Button, EmptyState, PageHeader, useToast } from '@/components';

function SimulatedTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700 ring-1 ring-inset ring-warning-600/20">
      <FlaskConical className="size-3.5" aria-hidden />{label}
    </span>
  );
}

function MetricCard({ m }: { m: ImprovementMetric }) {
  const Better = m.better === 'lower' ? TrendingDown : TrendingUp;
  return (
    <article className="flex flex-col rounded-lg border border-slate-200 bg-surface p-4 shadow-sm" data-testid="improvement-card">
      <h2 className="font-semibold text-slate-900">{m.title}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Manual (baseline)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-700">{m.manual.display}</div>
        </div>
        <div className="rounded-md bg-primary-50 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-primary-700">Portal</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-primary-800">{m.portal.display}</div>
        </div>
      </div>
      <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500"><Better className="size-3.5" aria-hidden />{m.better === 'lower' ? 'Lower is better' : 'Higher is better'}{m.sampleSize !== null && ` · ${m.sampleSize} case(s)`}</p>
      <p className="mt-2 flex-1 text-sm text-slate-700">{m.explanation}</p>
      <div className="mt-3"><SimulatedTag label={m.label} /></div>
    </article>
  );
}

/** /reports/improvement: manual vs portal, every card labelled "Simulated on demo data" (D26). */
export function Improvement() {
  const q = useImprovement();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try { await downloadImprovement(); } catch (err) { toast.error((err as Error).message); } finally { setDownloading(false); }
  };
  return (
    <>
      <PageHeader back={{ to: '/reports', label: 'Reports' }} title="Improvement metrics" subtitle="The portal's own figures next to the assumed manual process."
        actions={<Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void download()}>Download CSV</Button>} />
      {q.isError && <EmptyState title="Could not load the metrics" description={q.error.message} />}
      {q.data && (
        <>
          <div className="mb-4 rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-800" role="note">
            <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" aria-hidden />{q.data.label}</p>
            <p className="mt-1">Baseline: {q.data.baselineNote} The baseline is set in the rules (improvement_baseline). As of {formatDate(q.data.asOf)}.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {q.data.metrics.map((m) => <MetricCard key={m.key} m={m} />)}
          </div>
        </>
      )}
    </>
  );
}
