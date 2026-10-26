import { Braces, Info, PlayCircle, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { formatDateTime, type RuleView } from '@fdr/shared';
import { useEvaluateNow, useRestoreRule, useRules, useSaveRule } from '@/api/admin';
import { ApiError } from '@/api/client';
import { Badge, Button, Card, FieldError, PageHeader, useToast } from '@/components';
import { summaryText } from '@/components/ClockBadge';
import { useAuth } from '@/auth/AuthContext';
import { ApprovalLevelsEditor, EscalationEditor, ReminderEditor, type EditorProps, type Errors } from './editors';

// Friendly editors exist for these three rules only (reduced Phase 8 scope); every rule can be edited as JSON.
// The draft is untyped JSON until the server validates it, so the editors are stored with an `unknown` value type.
type AnyEditor = ComponentType<EditorProps<unknown>>;
const FRIENDLY: Record<string, AnyEditor> = {
  reminder: ReminderEditor as unknown as AnyEditor,
  escalation: EscalationEditor as unknown as AnyEditor,
  approval_levels: ApprovalLevelsEditor as unknown as AnyEditor,
};
const DESCRIPTIONS: Record<string, string> = {
  required_docs: 'Documents each instrument type must carry before it can be submitted and accepted.',
  lien_required: 'Whether a lien in favour of AICTE is required, per instrument type.',
  reminder: 'Maturity reminders: how many days before maturity, and who gets them.',
  pending_verification: 'Alert when a submitted instrument waits this long for verification.',
  discrepancy_open: 'Alert when a discrepancy stays open this long.',
  overdue_renewal: 'Grace period after maturity before an instrument that was not renewed lapses.',
  release_pending: 'Alert when a release request waits this long at one level. It goes to whoever must act at that level.',
  escalation: 'Who an unresolved alert climbs to, and when.',
  renewal_checks: 'Checks applied when a replacement instrument is submitted and accepted.',
  release_conditions: 'Conditions copied into every new release request.',
  approval_levels: 'The release approval chain and the extra level for large amounts.',
  risk_weights: 'How My day ranks work. The weights must add up to 1.00.',
  improvement_baseline: 'Assumed figures for the manual process, shown on the improvement page.',
};

function serverErrors(err: unknown): Errors {
  if (!(err instanceof ApiError)) return {};
  if (err.code === 'STALE_VERSION') return { form: err.message };
  const fields = err.fieldErrors();
  return Object.keys(fields).length ? fields : { form: err.message };
}

function RuleCard({ rule, canEdit }: { rule: RuleView; canEdit: boolean }) {
  const toast = useToast();
  const save = useSaveRule();
  const restore = useRestoreRule();
  const evaluate = useEvaluateNow();
  const Friendly: AnyEditor | undefined = FRIENDLY[rule.key];
  const friendly = !!Friendly;
  const [json, setJson] = useState(!friendly);
  const [draft, setDraft] = useState<unknown>(rule.config);
  const [text, setText] = useState(() => JSON.stringify(rule.config, null, 2));
  const [active, setActive] = useState(rule.active);
  const [errors, setErrors] = useState<Errors>({});
  const [runHint, setRunHint] = useState(false);

  // A fresh server copy (after save, restore or a clock change) replaces the draft.
  useEffect(() => {
    setDraft(rule.config);
    setText(JSON.stringify(rule.config, null, 2));
    setActive(rule.active);
  }, [rule.config, rule.active, rule.version]);

  const switchMode = (toJson: boolean) => {
    if (toJson) setText(JSON.stringify(draft, null, 2));
    else {
      try { setDraft(JSON.parse(text)); } catch { setErrors({ json: 'Fix the JSON before switching back' }); return; }
    }
    setErrors({});
    setJson(toJson);
  };

  const onSaved = (saved: RuleView, message: string) => {
    setErrors({});
    toast.success(message);
    setRunHint(saved.key === 'reminder');
  };

  const submit = () => {
    let config: unknown = draft;
    if (json) {
      try { config = JSON.parse(text); } catch { setErrors({ json: 'Not valid JSON' }); return; }
    }
    save.mutate({ key: rule.key, config, active, version: rule.version }, {
      onSuccess: (saved) => onSaved(saved, `${rule.name} saved`),
      onError: (err) => setErrors(serverErrors(err)),
    });
  };

  const jsonErrors = Object.entries(errors).filter(([k]) => k.startsWith('config'));
  const idBase = `rule-${rule.key}`;
  return (
    <Card
      title={<span className="inline-flex items-center gap-2">{rule.name}{!rule.active && <Badge tone="warning">Inactive — default applies</Badge>}</span>}
      actions={canEdit && friendly && (
        <Button size="sm" variant="ghost" icon={json ? <SlidersHorizontal className="size-4" aria-hidden /> : <Braces className="size-4" aria-hidden />} onClick={() => switchMode(!json)}>
          {json ? 'Simple editor' : 'Advanced (JSON)'}
        </Button>
      )}
    >
      <div className="space-y-3" data-testid={`rule-${rule.key}`}>
        <p className="text-sm text-slate-600">{DESCRIPTIONS[rule.key] ?? ''}</p>
        {!canEdit ? (
          <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(rule.config, null, 2)}</pre>
        ) : json ? (
          <div>
            <label className="sr-only" htmlFor={`${idBase}-json`}>{rule.name} configuration (JSON)</label>
            <textarea id={`${idBase}-json`} className="h-56 w-full rounded-md border border-slate-300 p-2 font-mono text-xs aria-[invalid=true]:border-danger-600"
              spellCheck={false} value={text} aria-invalid={!!errors.json || jsonErrors.length > 0} aria-describedby={`${idBase}-json-err`}
              onChange={(e) => setText(e.target.value)} />
            <FieldError id={`${idBase}-json-err`} message={errors.json} />
            {jsonErrors.length > 0 && (
              <ul className="mt-1 space-y-0.5" aria-label="Problems in the configuration">
                {jsonErrors.map(([path, message]) => (
                  <li key={path}><FieldError id={`${idBase}-${path}`} message={`${path.replace(/^config\.?/, '') || 'config'}: ${message}`} /></li>
                ))}
              </ul>
            )}
          </div>
        ) : Friendly ? (
          <Friendly value={draft} onChange={(next: unknown) => setDraft(next)} errors={errors} idBase={idBase} />
        ) : null}
        <FieldError id={`${idBase}-form-err`} message={errors.form} />
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (when off, the built-in default applies)
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} loading={restore.isPending}
                onClick={() => restore.mutate(rule.key, { onSuccess: (r) => onSaved(r, `${rule.name} restored to default`), onError: (e) => setErrors(serverErrors(e)) })}>
                Restore default
              </Button>
              <Button icon={<Save className="size-4" aria-hidden />} loading={save.isPending} onClick={submit}>Save</Button>
            </div>
          </div>
        )}
        {rule.updatedAt && <p className="text-xs text-slate-500">Last changed {formatDateTime(rule.updatedAt)}{rule.updatedByName ? ` by ${rule.updatedByName}` : ''}</p>}
        {runHint && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-info-50 px-3 py-2 text-sm text-info-700" role="status">
            <Info className="size-4" aria-hidden />
            Takes effect on the next evaluation — run now?
            <Button size="sm" icon={<PlayCircle className="size-4" aria-hidden />} loading={evaluate.isPending}
              onClick={() => evaluate.mutate(undefined, {
                onSuccess: (s) => { toast.success(`Evaluation run: ${summaryText(s)}`); setRunHint(false); },
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Evaluation failed'),
              })}>
              Run evaluation now
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** /admin/rules: every rule the system reads, edited and validated by the server. Auditors see the same page read-only. */
export function RulesPage() {
  const { user } = useAuth();
  const rules = useRules();
  const canEdit = user?.role === 'admin';
  return (
    <div>
      <PageHeader title="Rules" subtitle="Reminder offsets, escalation, required documents, release conditions, approval levels and risk weights. Changes take effect on the next operation or evaluation run." />
      {rules.isLoading && <p className="text-sm text-slate-500">Loading rules…</p>}
      {rules.error && <p className="text-sm text-danger-700">{rules.error.message}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {rules.data?.map((r) => <RuleCard key={r.key} rule={r} canEdit={canEdit} />)}
      </div>
    </div>
  );
}
