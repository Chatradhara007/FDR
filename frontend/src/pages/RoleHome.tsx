import type { Role } from '@fdr/shared';
import { useAuth } from '@/auth/AuthContext';
import { Card, PageHeader, SystemStatus } from '@/components';

const COPY: Record<Role, { title: string; subtitle: string; next: string }> = {
  institution: {
    title: 'My institution',
    subtitle: 'Your fixed deposit receipts and security deposits lodged with AICTE.',
    next: 'Submitting instruments and uploading documents arrives in the next release.',
  },
  officer: {
    title: 'Scrutiny desk',
    subtitle: 'Instruments waiting for verification, observations and discrepancies.',
    next: 'Open the scrutiny queue to claim submitted instruments, verify them with the bank and accept or return them.',
  },
  approver: {
    title: 'Approvals',
    subtitle: 'Release requests and escalations that need a competent-authority decision.',
    next: 'Release decisions appear here. The portal supports your decision; it never approves on its own.',
  },
  admin: {
    title: 'Administration',
    subtitle: 'Users, rules, the app clock and demo tools.',
    next: 'Use the clock controls in the header to simulate dates for the demo.',
  },
  auditor: {
    title: 'Audit',
    subtitle: 'Read-only access to the audit trail, reports and dashboard.',
    next: 'The audit trail with its integrity check appears here.',
  },
};

export function RoleHome({ role }: { role: Role }) {
  const { user } = useAuth();
  const c = COPY[role];
  return (
    <>
      <PageHeader title={c.title} subtitle={c.subtitle} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Welcome, ${user?.name ?? ''}`}>
          <p className="text-sm text-slate-700">{user?.designation}</p>
          <p className="mt-3 text-sm text-slate-600">{c.next}</p>
        </Card>
        <SystemStatus />
      </div>
    </>
  );
}
