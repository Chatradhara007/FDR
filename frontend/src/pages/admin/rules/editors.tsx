import { Plus, Trash2 } from 'lucide-react';
import {
  ALERT_KINDS, ALERT_KIND_LABELS, REMINDER_RECIPIENT_ROLES, ROLE_LABELS, amountInWords,
  type AlertKind, type ApprovalLevelConfig, type ApprovalLevelsConfig, type EscalationConfig, type ReleaseLevelAction,
  type ReminderConfig, type Role,
} from '@fdr/shared';
import { Button, FieldError } from '@/components';
import { inputCls } from '@/pages/institution/wizard/form';

/** Friendly editors (reduced scope, Phase 8): reminders, escalation ladder, approval levels. Every other rule is edited
 *  as JSON; the server validates both the same way. Errors are keyed by the server's field path (`config.offsets.0.days`). */

export type Errors = Record<string, string>;

export interface EditorProps<T> { value: T; onChange: (next: T) => void; errors: Errors; idBase: string }

const LEVEL_ROLES: Role[] = ['officer', 'approver', 'admin'];
const LEVEL_ACTIONS: ReleaseLevelAction[] = ['RECOMMEND', 'DECIDE'];
const ACTION_LABELS: Record<ReleaseLevelAction, string> = { RECOMMEND: 'Recommends', DECIDE: 'Decides' };
const smallInput = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm aria-[invalid=true]:border-danger-600';

function Err({ errors, path, id }: { errors: Errors; path: string; id: string }) {
  return <FieldError id={id} message={errors[path]} />;
}

function toInt(v: string): number {
  return v.trim() === '' ? Number.NaN : Number(v);
}

/** Days are sent as typed; the server rejects anything that is not a whole number and says why. */
function intValue(n: number): string {
  return Number.isFinite(n) ? String(n) : '';
}

export function ReminderEditor({ value, onChange, errors, idBase }: EditorProps<ReminderConfig>) {
  const offsets = value.offsets ?? [];
  const set = (i: number, patch: Partial<ReminderConfig['offsets'][number]>) =>
    onChange({ offsets: offsets.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">A reminder goes out when maturity is this many days away. The largest offset also starts the Expiring status.</p>
      {offsets.map((o, i) => {
        const daysId = `${idBase}-days-${i}`;
        const p = `config.offsets.${i}`;
        return (
          <div key={i} className="rounded-md border border-slate-200 p-2" data-testid="reminder-row">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm" htmlFor={daysId}>Days before maturity</label>
              <input id={daysId} type="number" min={1} className={`${smallInput} w-24`} value={intValue(o.days)}
                aria-invalid={!!errors[`${p}.days`]} aria-describedby={`${daysId}-err`}
                onChange={(e) => set(i, { days: toInt(e.target.value) })} />
              <fieldset className="flex flex-wrap items-center gap-3" aria-describedby={`${daysId}-rcpt-err`}>
                <legend className="sr-only">Recipients for the {intValue(o.days)}-day reminder</legend>
                {REMINDER_RECIPIENT_ROLES.map((role) => (
                  <label key={role} className="inline-flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={o.recipients.includes(role)}
                      onChange={(e) => set(i, { recipients: e.target.checked ? [...o.recipients, role] : o.recipients.filter((r) => r !== role) })} />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </fieldset>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => onChange({ offsets: offsets.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            </div>
            <Err errors={errors} path={`${p}.days`} id={`${daysId}-err`} />
            <Err errors={errors} path={`${p}.recipients`} id={`${daysId}-rcpt-err`} />
          </div>
        );
      })}
      <Err errors={errors} path="config.offsets" id={`${idBase}-offsets-err`} />
      <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />}
        onClick={() => onChange({ offsets: [...offsets, { days: Number.NaN, recipients: ['institution', 'officer'] }] })}>
        Add reminder
      </Button>
    </div>
  );
}

export function EscalationEditor({ value, onChange, errors, idBase }: EditorProps<EscalationConfig>) {
  const levels = value.levels ?? [];
  const renumber = (xs: EscalationConfig['levels']) => xs.map((l, i) => ({ ...l, level: i + 1 }));
  const set = (i: number, patch: Partial<EscalationConfig['levels'][number]>) =>
    onChange({ ...value, levels: levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const toggleKind = (k: AlertKind, on: boolean) =>
    onChange({ ...value, kinds: on ? [...value.kinds, k] : value.kinds.filter((x) => x !== k) });
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Days are counted from the first alert. Each level must start later than the one before.</p>
      <ol className="space-y-2">
        {levels.map((l, i) => {
          const id = `${idBase}-lvl-${i}`;
          const p = `config.levels.${i}`;
          return (
            <li key={i} className="rounded-md border border-slate-200 p-2" data-testid="escalation-row">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">Level {i + 1}</span>
                <label className="text-sm" htmlFor={`${id}-role`}>Goes to</label>
                <select id={`${id}-role`} className={smallInput} value={l.role} aria-invalid={!!errors[`${p}.role`]}
                  onChange={(e) => set(i, { role: e.target.value as Role })}>
                  {LEVEL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                <label className="text-sm" htmlFor={`${id}-days`}>after</label>
                <input id={`${id}-days`} type="number" min={0} className={`${smallInput} w-20`} value={intValue(l.afterDays)}
                  aria-invalid={!!errors[`${p}.afterDays`]} onChange={(e) => set(i, { afterDays: toInt(e.target.value) })} />
                <span className="text-sm">days</span>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />}
                  onClick={() => onChange({ ...value, levels: renumber(levels.filter((_, j) => j !== i)) })}>Remove</Button>
              </div>
              <Err errors={errors} path={`${p}.role`} id={`${id}-role-err`} />
              <Err errors={errors} path={`${p}.afterDays`} id={`${id}-days-err`} />
            </li>
          );
        })}
      </ol>
      <Err errors={errors} path="config.levels" id={`${idBase}-levels-err`} />
      <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />}
        onClick={() => onChange({ ...value, levels: renumber([...levels, { level: 0, role: 'admin', afterDays: Number.NaN }]) })}>
        Add level
      </Button>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Alert kinds that escalate</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {ALERT_KINDS.map((k) => (
            <label key={k} className="inline-flex items-center gap-1 text-sm">
              <input type="checkbox" checked={value.kinds.includes(k)} onChange={(e) => toggleKind(k, e.target.checked)} />
              {ALERT_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        <Err errors={errors} path="config.kinds" id={`${idBase}-kinds-err`} />
      </fieldset>
    </div>
  );
}

function LevelFields({ level, onChange, errors, path, id }: {
  level: Omit<ApprovalLevelConfig, 'level'>; onChange: (patch: Partial<ApprovalLevelConfig>) => void; errors: Errors; path: string; id: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Role" className={smallInput} value={level.role} aria-invalid={!!errors[`${path}.role`]} onChange={(e) => onChange({ role: e.target.value as Role })}>
          {LEVEL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select aria-label="Action" className={smallInput} value={level.action} aria-invalid={!!errors[`${path}.action`]} onChange={(e) => onChange({ action: e.target.value as ReleaseLevelAction })}>
          {LEVEL_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
        </select>
        <input aria-label="Label" className={`${smallInput} min-w-56 flex-1`} value={level.label} aria-invalid={!!errors[`${path}.label`]}
          onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <Err errors={errors} path={`${path}.role`} id={`${id}-role-err`} />
      <Err errors={errors} path={`${path}.action`} id={`${id}-action-err`} />
      <Err errors={errors} path={`${path}.label`} id={`${id}-label-err`} />
    </>
  );
}

export function ApprovalLevelsEditor({ value, onChange, errors, idBase }: EditorProps<ApprovalLevelsConfig>) {
  const levels = value.levels ?? [];
  const renumber = (xs: ApprovalLevelConfig[]) => xs.map((l, i) => ({ ...l, level: i + 1 }));
  const set = (i: number, patch: Partial<ApprovalLevelConfig>) =>
    onChange({ ...value, levels: levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const above = value.extraApprovalAbove ?? '';
  const extra = value.extraLevel;
  const aboveId = `${idBase}-above`;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Level 1 is the scrutiny officer's recommendation; the last level decides. The same person can act at only one level of a request.</p>
      <ol className="space-y-2">
        {levels.map((l, i) => (
          <li key={i} className="rounded-md border border-slate-200 p-2" data-testid="approval-row">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Level {i + 1}</span>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />}
                onClick={() => onChange({ ...value, levels: renumber(levels.filter((_, j) => j !== i)) })}>Remove</Button>
            </div>
            <LevelFields level={l} onChange={(p) => set(i, p)} errors={errors} path={`config.levels.${i}`} id={`${idBase}-l${i}`} />
          </li>
        ))}
      </ol>
      <Err errors={errors} path="config.levels" id={`${idBase}-levels-err`} />
      <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />}
        onClick={() => onChange({ ...value, levels: renumber([...levels, { level: 0, role: 'approver', action: 'DECIDE', label: '' }]) })}>
        Add level
      </Button>
      <div className="rounded-md border border-slate-200 p-2">
        <label className="text-sm font-medium" htmlFor={aboveId}>Extra approval above (₹)</label>
        <input id={aboveId} className={`${inputCls} mt-1 max-w-xs`} inputMode="decimal" value={above} placeholder="Leave empty for no extra level"
          aria-invalid={!!errors['config.extraApprovalAbove']} aria-describedby={`${aboveId}-err`}
          onChange={(e) => onChange({ ...value, extraApprovalAbove: e.target.value === '' ? null : e.target.value })} />
        {above && /^\d+(\.\d{1,2})?$/.test(above) && <p className="mt-1 text-xs text-slate-500">{amountInWords(above)}</p>}
        <Err errors={errors} path="config.extraApprovalAbove" id={`${aboveId}-err`} />
        {extra ? (
          <div className="mt-2">
            <p className="mb-1 text-sm">Extra level added for requests above this amount</p>
            <LevelFields level={extra} onChange={(p) => onChange({ ...value, extraLevel: { ...extra, ...p } })} errors={errors} path="config.extraLevel" id={`${idBase}-extra`} />
          </div>
        ) : (
          <Button size="sm" variant="secondary" className="mt-2" icon={<Plus className="size-4" aria-hidden />}
            onClick={() => onChange({ ...value, extraLevel: { role: 'approver', action: 'DECIDE', label: '' } })}>Add extra level</Button>
        )}
      </div>
    </div>
  );
}
