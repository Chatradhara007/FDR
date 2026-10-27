import { useState } from 'react';
import { AlertTriangle, ArrowLeft, ClipboardCheck, HandCoins, Pencil, Printer, RefreshCcw } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  INSTRUMENT_TYPE_LABELS, OPEN_RELEASE_REQUEST_STATUSES, RELEASABLE_STATUSES, RENEWABLE_STATUSES, TERMINAL_STATUSES, type Passport,
} from '@fdr/shared';
import { usePassport, useRenew } from '@/api/instruments';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Button, Card, DateText, DocChecklist, DocumentList, EmptyState, Money, ObservationItem, StatusChip, Tabs, VerificationChip,
  WeakestTierBadge, WorstAlertChip, useToast,
} from '@/components';
import { ROLE_HOME } from '@/lib/roles';
import { ReturnBanner } from '@/pages/institution/ReturnBanner';
import { RequestReleaseModal } from '@/pages/releases/RequestReleaseModal';
import { ChainTab } from './ChainTab';
import { AlertsTab, FieldsTab, VerificationTab } from './DetailTabs';
import { ReleaseTab } from './ReleaseTab';
import { TimelineTab } from './TimelineTab';

function MaturityText({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days < 0) return <span className="font-semibold text-danger-700">matured {Math.abs(days)} d ago</span>;
  if (days === 0) return <span className="font-semibold text-danger-700">matures today</span>;
  return <span className={days <= 90 ? 'font-medium text-warning-700' : 'text-slate-600'}>{days} d to maturity</span>;
}

/** Role-aware actions: the institution renews, requests release or edits; AICTE roles open the review screen. */
function Actions({ p, onReleaseRequested }: { p: Passport; onReleaseRequested: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const renew = useRenew();
  const [releaseOpen, setReleaseOpen] = useState(false);
  const inst = p.instrument;
  const successor = p.chain.find((l) => l.depth === 1);
  const openRelease = p.releaseRequests.some((r) => OPEN_RELEASE_REQUEST_STATUSES.includes(r.request.status));
  // D6: no release while a replacement is in progress (the server checks again).
  const canRequestRelease = RELEASABLE_STATUSES.includes(inst.status) && !openRelease && (!successor || TERMINAL_STATUSES.includes(successor.status));
  if (user?.role !== 'institution') {
    return (
      <Link to={`/officer/review/${inst.id}`}>
        <Button size="sm" variant="secondary" icon={<ClipboardCheck className="size-4" aria-hidden />}>Open review</Button>
      </Link>
    );
  }
  return (
    <>
      {(inst.status === 'DRAFT' || inst.status === 'RETURNED') && (
        <Link to={`/institution/instruments/${inst.id}/edit`}>
          <Button size="sm" icon={<Pencil className="size-4" aria-hidden />}>{inst.status === 'RETURNED' ? 'Correct and resubmit' : 'Continue editing'}</Button>
        </Link>
      )}
      {RENEWABLE_STATUSES.includes(inst.status) && !successor && (
        <Button size="sm" icon={<RefreshCcw className="size-4" aria-hidden />} loading={renew.isPending}
          onClick={() => renew.mutate(inst.id, {
            onSuccess: (child) => { toast.success('Replacement draft created — enter the new deposit’s details'); navigate(`/institution/instruments/${child.id}/edit`); },
            onError: (e) => toast.error(e.message),
          })}>
          Renew
        </Button>
      )}
      {successor && (successor.status === 'DRAFT' || successor.status === 'RETURNED') && (
        <Link to={`/institution/instruments/${successor.id}/edit`}>
          <Button size="sm" variant="secondary" icon={<RefreshCcw className="size-4" aria-hidden />}>Continue renewal</Button>
        </Link>
      )}
      {canRequestRelease && (
        <Button size="sm" variant="secondary" icon={<HandCoins className="size-4" aria-hidden />} onClick={() => setReleaseOpen(true)}>Request release</Button>
      )}
      <RequestReleaseModal open={releaseOpen} instrumentId={inst.id} onClose={() => setReleaseOpen(false)}
        onDone={() => { setReleaseOpen(false); toast.success('Release requested — AICTE will check the conditions'); onReleaseRequested(); }} />
    </>
  );
}

/** The instrument passport: one page that tells the instrument's whole story (all roles; filtered by the server).
 * Keyed by id so moving along the chain starts on the Timeline tab again. */
export function PassportPage() {
  const { id = '' } = useParams();
  return <PassportView key={id} id={id} />;
}

function PassportView({ id }: { id: string }) {
  const { user } = useAuth();
  const q = usePassport(id);
  const [tab, setTab] = useState('timeline');
  if (q.isError) return <EmptyState title="Instrument not found" description="It may have been deleted, or it belongs to another institution." />;
  const p = q.data;
  if (!p) return <p className="text-sm text-slate-500">Loading…</p>;
  const inst = p.instrument;
  const s = p.summary;
  const parent = p.chain.find((l) => l.depth === -1);
  const successor = p.chain.find((l) => l.depth === 1);
  const blockers = s.openProblems.filter((g) => g.severity === 'blocker');
  const home = user ? ROLE_HOME[user.role] : '/';

  return (
    <>
      <Link to={home} className="mb-3 inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <header className="mb-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{INSTRUMENT_TYPE_LABELS[inst.type]} · {inst.institutionName} · Passport</p>
            <h1 className="mt-1 text-xl font-semibold break-all text-slate-900">{inst.referenceNo ?? 'Draft instrument'}</h1>
            <p className="mt-1 text-sm text-slate-700">
              {inst.issuingBank ?? 'Bank not given'}{inst.branch ? `, ${inst.branch}` : ''} · <span className="font-semibold"><Money amount={inst.amount} /></span>
              {inst.maturityDate && <> · matures <DateText value={inst.maturityDate} /> (<MaturityText days={s.daysToMaturity} />)</>}
            </p>
            {parent && (
              <p className="mt-1 text-xs text-slate-600">Replaces <Link className="text-primary-700 hover:underline" to={`/instruments/${parent.id}`}>{parent.referenceNo}</Link></p>
            )}
            {successor && (
              <p className="mt-1 text-xs text-slate-600">Replaced by <Link className="text-primary-700 hover:underline" to={`/instruments/${successor.id}`}>{successor.referenceNo ?? 'a draft replacement'}</Link></p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <StatusChip status={inst.status} />
              {inst.status !== 'DRAFT' && <VerificationChip state={inst.verificationState} />}
              {s.openAlertCount > 0 && <WorstAlertChip level={s.worstOpenAlertLevel} count={s.openAlertCount} />}
            </div>
            <WeakestTierBadge tier={s.weakestTier} />
            {s.acceptedWithOverride && (
              <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Accepted without bank confirmation</Badge>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Link to={`/instruments/${inst.id}/print`}>
                <Button size="sm" variant="secondary" icon={<Printer className="size-4" aria-hidden />}>Printable passport</Button>
              </Link>
              <Actions p={p} onReleaseRequested={() => setTab('release')} />
            </div>
          </div>
        </div>
        {s.acceptedWithOverride && s.overrideNote && <p className="mt-3 text-sm text-warning-700">Officer’s note: “{s.overrideNote}”</p>}
      </header>
      {inst.status === 'RETURNED' && p.returns[0] && <ReturnBanner reason={p.returns[0].reason} />}
      {blockers.length > 0 && inst.status !== 'DRAFT' && (
        <Card title="Open problems" className="mb-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger-700">{blockers.map((g) => <li key={g.message}>{g.message}</li>)}</ul>
        </Card>
      )}
      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'timeline', label: 'Timeline', content: <TimelineTab events={p.timeline} /> },
            { id: 'fields', label: 'Fields', content: <FieldsTab p={p} /> },
            {
              id: 'documents', label: `Documents (${p.documents.length})`,
              content: (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2"><DocumentList documents={p.documents} /></div>
                  <div><h3 className="mb-2 text-sm font-semibold text-slate-700">Required documents</h3><DocChecklist required={inst.requiredDocs} present={p.documents.map((d) => d.docType)} /></div>
                </div>
              ),
            },
            {
              id: 'verification', label: `Verification (${p.verifications.length})`,
              content: (
                <div className="space-y-4">
                  <VerificationTab p={p} />
                  {p.observations.length > 0 && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">Observations</h3>
                      <ul className="space-y-2">{p.observations.map((o) => <ObservationItem key={o.id} o={o} />)}</ul>
                    </section>
                  )}
                </div>
              ),
            },
            { id: 'chain', label: `Chain (${p.chain.length})`, content: <ChainTab chain={p.chain} /> },
            { id: 'alerts', label: `Alerts (${s.openAlertCount} open)`, content: <AlertsTab alerts={p.alerts} /> },
            { id: 'release', label: `Release (${p.releaseRequests.length})`, content: <ReleaseTab requests={p.releaseRequests} /> },
          ]}
        />
      </Card>
    </>
  );
}
