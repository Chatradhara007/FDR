import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, type InstrumentDetail, type InstrumentListItem, type ReleaseListItem } from '@fdr/shared';
import { apiFetch } from '@/api/client';
import { useInstruments } from '@/api/instruments';
import { useReleaseRequests } from '@/api/releases';
import { useAuth } from '@/auth/AuthContext';
import { ActionCard, Button, DateText, EmptyState, Money, ProofLegend, ProofStrip, StatusChip, Tracker, WeakestTierBadge, type TrackerStep } from '@/components';
import { useClock } from '@/hooks/useClock';
import { formatDateGov } from '@/lib/format';
import { countWord, firstName, greeting } from '@/lib/greeting';

const LIVE = ['ACTIVE', 'EXPIRING', 'MATURED', 'RELEASE_REQUESTED'];
const OPEN_RELEASE = ['PENDING_CONDITIONS', 'PENDING_APPROVAL', 'RETURNED'];

const editLink = (r: InstrumentListItem) =>
  r.status === 'DRAFT' || r.status === 'RETURNED' ? `/institution/instruments/${r.id}/edit` : `/instruments/${r.id}`;

const dueSoon = (r: InstrumentListItem) => (r.status === 'ACTIVE' || r.status === 'EXPIRING') && r.daysToMaturity !== null && r.daysToMaturity <= 90;

function nextStep(r: InstrumentListItem, release: ReleaseListItem | undefined): string {
  if (release?.status === 'RETURNED') return 'Add what the officer asked for to the release request.';
  switch (r.status) {
    case 'DRAFT': return 'Finish and submit.';
    case 'SUBMITTED': case 'UNDER_SCRUTINY': return 'Nothing. With the officer.';
    case 'RETURNED': return 'Correct and resubmit.';
    case 'RELEASE_REQUESTED': return release && decideLevel(release) ? 'Nothing. With the approver.' : 'Nothing. With the officer.';
    case 'MATURED': case 'LAPSED': return 'Renew now, or ask for release.';
    case 'RENEWED': return 'Nothing. Replaced by its renewal.';
    case 'RELEASED': return 'Nothing. Released.';
    default: return dueSoon(r) && r.maturityDate ? `Renew or release, by ${formatDateGov(r.maturityDate)}.` : 'Nothing yet. A reminder comes before maturity.';
  }
}

const decideLevel = (r: ReleaseListItem) => r.requiredLevels[r.currentLevel - 1]?.action === 'DECIDE';

/** Parcel-style steps for one release request, from its status and current level. */
function releaseSteps(r: ReleaseListItem): { steps: TrackerStep[]; note: React.ReactNode } {
  const approved = r.status === 'APPROVED';
  const atApprover = approved || decideLevel(r);
  const state = (done: boolean, current: boolean): TrackerStep['state'] => (done ? 'done' : current ? 'current' : 'next');
  const steps: TrackerStep[] = [
    { title: 'Request sent', note: <><DateText value={r.requestedAt} />.</>, state: 'done' },
    { title: r.status === 'RETURNED' ? 'Returned to you' : 'Officer is checking', note: r.status === 'RETURNED' ? 'The officer needs something more from you.' : 'Waiting on AICTE’s scrutiny officer. Usually two working days.', state: state(atApprover, !atApprover) },
    { title: 'Approver decides', note: 'A senior officer approves or rejects.', state: state(approved, atApprover && !approved) },
    { title: 'Release order issued', note: 'You get a printable order with a QR code.', state: state(approved, false) },
  ];
  const note = approved
    ? <><strong>Released.</strong> The release order is ready to print from the deposit’s page.</>
    : r.status === 'RETURNED'
      ? <><strong>You need to act.</strong> Open the deposit, read the officer’s message and add what is missing.</>
      : r.status === 'REJECTED' || r.status === 'CANCELLED'
        ? <><strong>This request is closed.</strong> The deposit stays with AICTE.</>
        : <><strong>You do not need to do anything.</strong> {atApprover ? 'The approver is deciding.' : 'An officer is checking the conditions.'} If anything is missing, you will be asked for it here.</>;
  return { steps, note };
}

/** /institution: greeting, "Needs your action" cards, the latest release tracker, all deposits with their proof strip
 *  (docs/design/mockup-institution-home.html). */
export function InstitutionHome() {
  const { user } = useAuth();
  const clock = useClock();
  const navigate = useNavigate();
  const all = useInstruments({ pageSize: 100 });
  const releases = useReleaseRequests({ pageSize: 100 });
  const items = all.data?.items;

  // Per-deposit records for the proof strip: loaded in parallel and cached under the same key as useInstrument.
  const details = useQueries({
    queries: (items ?? []).map((r) => ({
      queryKey: ['instrument', r.id],
      queryFn: () => apiFetch<InstrumentDetail>(`/instruments/${r.id}`),
      staleTime: 30_000,
      retry: 1,
    })),
  });
  const detailOf = (id: string) => details[(items ?? []).findIndex((r) => r.id === id)];

  const releaseFor = useMemo(() => {
    const m = new Map<string, ReleaseListItem>();
    for (const r of [...(releases.data?.items ?? [])].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))) m.set(r.instrumentId, r);
    return m;
  }, [releases.data]);
  const latest = useMemo(() => [...(releases.data?.items ?? [])].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0], [releases.data]);

  const actions = (items ?? []).flatMap((r) => {
    const rel = releaseFor.get(r.id);
    const ref = r.referenceNo ?? 'Draft, no reference yet';
    if (r.status === 'RETURNED') {
      const reason = detailOf(r.id)?.data?.returns[0]?.reason;
      return [{ r, kicker: 'Returned by the officer', title: 'Correct and resubmit', ref, body: reason ? `The officer wrote: “${reason.replace(/\.$/, '')}.” Fix it and send it back.` : 'The officer sent this back. Read the remarks, fix the record and send it back.', cta: 'Correct and resubmit', to: editLink(r) }];
    }
    if (rel?.status === 'RETURNED') {
      return [{ r, kicker: 'Release request returned', title: 'Add what is missing', ref, body: 'The officer needs something more before your release request can go ahead.', cta: 'Open the request', to: `/instruments/${r.id}` }];
    }
    if (r.status === 'DRAFT') {
      return [{ r, kicker: 'Not submitted yet', title: 'Finish and submit', ref, body: 'This deposit is saved as a draft. AICTE cannot see it until you submit it.', cta: 'Continue', to: editLink(r) }];
    }
    if (dueSoon(r) && !(rel && OPEN_RELEASE.includes(rel.status))) {
      return [{ r, kicker: `Matures in ${r.daysToMaturity} days`, title: 'Decide: renew or release', ref, body: `Renew before ${formatDateGov(r.maturityDate ?? '')} to avoid a gap, or ask for release. You cannot do both for the same deposit.`, cta: 'Choose what to do', to: `/instruments/${r.id}` }];
    }
    return [];
  });

  const live = items?.filter((i) => LIVE.includes(i.status)).length ?? 0;
  const returned = items?.filter((i) => i.status === 'RETURNED').length ?? 0;
  const maturing = items?.filter(dueSoon).length ?? 0;
  const tracker = latest ? releaseSteps(latest) : null;

  return (
    <div className="mx-auto max-w-[1240px] pt-2">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[2rem] leading-tight font-bold tracking-[-0.02em]">{greeting(clock.data?.now)}, {firstName(user?.name)}</h1>
          <p className="mt-2 text-[1.0625rem] text-muted">
            {items && (actions.length
              ? `${countWord(actions.length, 'deposit needs', 'deposits need', true)} something from you. Everything else is with AICTE.`
              : 'Nothing needs you right now. Everything else is with AICTE.')}
          </p>
        </div>
        <Link to="/institution/instruments/new" className="inline-flex h-[52px] items-center rounded-[12px] bg-teal px-7 text-[1.0625rem] font-bold text-white hover:bg-teal-hover">
          Submit a new deposit
        </Link>
      </div>

      {actions.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-3.5 text-lg font-bold">Needs your action</h2>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
            {actions.map((a) => (
              <ActionCard key={a.r.id} kicker={a.kicker} title={a.title} reference={a.ref}
                action={<Button variant="dark" onClick={() => navigate(a.to)}>{a.cta}</Button>}>
                {a.body}
              </ActionCard>
            ))}
          </div>
        </section>
      )}

      {latest && tracker && (
        <section className="mt-8 rounded-[14px] border border-border bg-white p-5 sm:p-[26px]" aria-label="Where your release request stands">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold">Where your release request stands</h2>
              <div className="mono mt-1 text-[0.78125rem] break-all text-muted">{latest.referenceNo} · <Money amount={latest.amount} /></div>
            </div>
            <Link to={`/instruments/${latest.instrumentId}`} className="text-sm font-medium text-teal hover:underline">Open this deposit</Link>
          </div>
          <Tracker steps={tracker.steps} note={tracker.note} />
        </section>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="mb-3.5 text-lg font-bold">All my deposits</h2>
          <span className="text-sm text-muted">{live} live · {returned} returned · {maturing} maturing within 90 days</span>
        </div>
        <div className="relative overflow-x-auto rounded-[14px] border border-border bg-white">
          <table className="gov-table min-w-[760px]">
            <caption className="sr-only">All my deposits</caption>
            <thead>
              <tr><th scope="col" className="w-[30%]">Deposit</th><th scope="col">Status</th><th scope="col">Proven</th><th scope="col">Matures</th><th scope="col" className="w-[24%]">Next step</th></tr>
            </thead>
            <tbody>
              {all.isLoading && <tr><td colSpan={5} className="text-muted">Loading…</td></tr>}
              {items?.map((r) => {
                const d = detailOf(r.id);
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => navigate(editLink(r))}>
                    <td className="py-4!">
                      <Link to={editLink(r)} onClick={(e) => e.stopPropagation()} className="mono text-[0.84375rem] font-medium break-all text-ink hover:text-teal hover:underline">
                        {r.referenceNo ?? 'Draft, no reference yet'}
                      </Link>
                      <div className="mt-0.5 text-[0.84375rem] text-muted"><Money amount={r.amount} /> · {INSTRUMENT_TYPE_LABELS[r.type]}</div>
                    </td>
                    <td className="py-4! align-middle!"><StatusChip status={r.status} /></td>
                    <td className="py-4! align-middle!">
                      {d?.data ? <ProofStrip provenance={d.data.provenance} />
                        : d?.isError ? (r.weakestTier ? <WeakestTierBadge tier={r.weakestTier} /> : <span className="text-muted">—</span>)
                        : <span className="inline-block h-[13px] w-[109px] animate-pulse rounded bg-chip" aria-label="Loading" />}
                    </td>
                    <td className="py-4! align-middle! text-sm"><DateText value={r.maturityDate} /></td>
                    <td className="py-4! align-middle! text-sm leading-snug">{nextStep(r, releaseFor.get(r.id))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items && items.length === 0 && <EmptyState title="No deposits yet" description="Use “Submit a new deposit” to lodge an FDR or a security deposit." />}
        </div>
        <div className="mt-3"><ProofLegend /></div>
        {all.data && all.data.total > all.data.items.length && <p className="mt-2 text-[0.8125rem] text-muted">Showing {all.data.items.length} of {all.data.total}.</p>}
      </section>
    </div>
  );
}
