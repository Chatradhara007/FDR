import { CheckCircle2, KeyRound, Pencil, UserPlus, UserX, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ROLES, ROLE_LABELS, type AdminUser, type Role } from '@fdr/shared';
import { useCreateUser, useResetPassword, useUpdateUser, useUsers, type NewUserInput } from '@/api/admin';
import { ApiError } from '@/api/client';
import { useInstitutions } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import { Badge, Button, FieldError, Modal, PageHeader, Table, useToast, type Column } from '@/components';
import { inputCls } from '@/pages/institution/wizard/form';

type Errors = Record<string, string>;

function errorsOf(err: unknown): Errors {
  if (!(err instanceof ApiError)) return { form: 'Something went wrong' };
  const f = err.fieldErrors();
  return Object.keys(f).length ? f : { form: err.message };
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      <FieldError id={`${id}-err`} message={error} />
    </div>
  );
}

const EMPTY: NewUserInput = { name: '', email: '', role: 'officer', institutionId: '', designation: '', password: '' };
const PASSWORD_HINT = 'At least 8 characters with a letter and a digit.';

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateUser();
  const institutions = useInstitutions({ pageSize: 100 });
  const [form, setForm] = useState<NewUserInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: keyof NewUserInput) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const close = () => { setForm(EMPTY); setErrors({}); onClose(); };
  const submit = () => {
    const body: NewUserInput = { ...form, institutionId: form.role === 'institution' ? form.institutionId || undefined : undefined };
    create.mutate(body, {
      onSuccess: (u) => { toast.success(`${u.name} can now sign in as ${ROLE_LABELS[u.role]}`); close(); },
      onError: (err) => setErrors(errorsOf(err)),
    });
  };
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': `new-${k}-err` });
  return (
    <Modal open={open} title="Create user" onClose={close}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={create.isPending} onClick={submit}>Create user</Button></>}>
      <div className="space-y-3">
        <Field id="new-name" label="Name" error={errors.name}><input id="new-name" className={inputCls} value={form.name} onChange={set('name')} {...aria('name')} /></Field>
        <Field id="new-email" label="Email" error={errors.email}><input id="new-email" type="email" className={inputCls} value={form.email} onChange={set('email')} {...aria('email')} /></Field>
        <Field id="new-role" label="Role" error={errors.role}>
          <select id="new-role" className={inputCls} value={form.role} onChange={set('role')} {...aria('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        {form.role === 'institution' && (
          <Field id="new-institutionId" label="Institution" error={errors.institutionId}>
            <select id="new-institutionId" className={inputCls} value={form.institutionId} onChange={set('institutionId')} {...aria('institutionId')}>
              <option value="">Choose…</option>
              {institutions.data?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>
        )}
        <Field id="new-designation" label="Designation (optional)" error={errors.designation}><input id="new-designation" className={inputCls} value={form.designation} onChange={set('designation')} {...aria('designation')} /></Field>
        <Field id="new-password" label="Initial password" error={errors.password}>
          <input id="new-password" type="password" autoComplete="new-password" className={inputCls} value={form.password} onChange={set('password')} {...aria('password')} />
          <p className="mt-1 text-xs text-slate-500">{PASSWORD_HINT}</p>
        </Field>
        <FieldError id="new-form-err" message={errors.form} />
      </div>
    </Modal>
  );
}

function EditUserModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateUser();
  const [name, setName] = useState(user?.name ?? '');
  const [designation, setDesignation] = useState(user?.designation ?? '');
  const [errors, setErrors] = useState<Errors>({});
  if (!user) return null;
  const submit = () =>
    update.mutate({ id: user.id, version: user.version, name, designation: designation || null }, {
      onSuccess: () => { toast.success('User updated'); onClose(); },
      onError: (err) => setErrors(errorsOf(err)),
    });
  return (
    <Modal open title={`Edit ${user.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={update.isPending} onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        <Field id="edit-name" label="Name" error={errors.name}><input id="edit-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby="edit-name-err" /></Field>
        <Field id="edit-designation" label="Designation" error={errors.designation}><input id="edit-designation" className={inputCls} value={designation} onChange={(e) => setDesignation(e.target.value)} aria-invalid={!!errors.designation} aria-describedby="edit-designation-err" /></Field>
        <FieldError id="edit-form-err" message={errors.form} />
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const toast = useToast();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  if (!user) return null;
  const submit = () =>
    reset.mutate({ id: user.id, password }, {
      onSuccess: () => { toast.success(`Password reset for ${user.name}. Give it to them securely.`); onClose(); },
      onError: (err) => setErrors(errorsOf(err)),
    });
  return (
    <Modal open title={`Reset password — ${user.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={reset.isPending} onClick={submit}>Reset password</Button></>}>
      <Field id="reset-password" label="New password" error={errors.password ?? errors.form}>
        <input id="reset-password" type="password" autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby="reset-password-err" />
        <p className="mt-1 text-xs text-slate-500">{PASSWORD_HINT} Existing sessions stay valid; deactivate the user to end them.</p>
      </Field>
    </Modal>
  );
}

/** /admin/users: create users, edit names and designations, deactivate or reactivate, reset passwords. */
export function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const users = useUsers();
  const update = useUpdateUser();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const toggleActive = (u: AdminUser) =>
    update.mutate({ id: u.id, version: u.version, active: !u.active }, {
      onSuccess: (x) => toast.success(x.active ? `${x.name} reactivated` : `${x.name} deactivated — their sessions have ended`),
      onError: (err) => toast.error(err instanceof ApiError ? Object.values(err.fieldErrors())[0] ?? err.message : 'Update failed'),
    });
  const columns: Column<AdminUser>[] = [
    { key: 'name', header: 'Name', sortValue: (u) => u.name.toLowerCase(), cell: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'email', header: 'Email', sortValue: (u) => u.email, cell: (u) => u.email },
    { key: 'role', header: 'Role', sortValue: (u) => u.role, cell: (u) => ROLE_LABELS[u.role as Role] },
    { key: 'org', header: 'Institution / designation', cell: (u) => u.institutionName ?? u.designation ?? '—' },
    {
      key: 'status', header: 'Status', sortValue: (u) => (u.active ? 0 : 1),
      cell: (u) => u.active
        ? <Badge tone="success" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>Active</Badge>
        : <Badge tone="neutral" icon={<XCircle className="size-3.5" aria-hidden />}>Deactivated</Badge>,
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>Edit</Button>
          <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setResetting(u)} aria-label={`Reset password for ${u.name}`}>Password</Button>
          {u.id !== me?.id && (
            <Button size="sm" variant="ghost" icon={u.active ? <UserX className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              onClick={() => toggleActive(u)} aria-label={`${u.active ? 'Deactivate' : 'Reactivate'} ${u.name}`}>
              {u.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title="Users" subtitle="Who can sign in, and as what. Deactivating a user ends their sessions immediately."
        actions={<Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>Create user</Button>} />
      <Table caption="Users" columns={columns} rows={users.data} rowKey={(u) => u.id} loading={users.isLoading} emptyTitle="No users" />
      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      {editing && <EditUserModal key={editing.id} user={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal key={resetting.id} user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}
