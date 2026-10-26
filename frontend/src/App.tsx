import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import type { Role } from '@fdr/shared';
import { HomeRedirect, ProtectedRoute } from '@/auth/ProtectedRoute';
import { Layout } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { InstitutionHome } from '@/pages/institution/InstitutionHome';
import { InstrumentWizard } from '@/pages/institution/wizard/InstrumentWizard';
import { AlertsInbox } from '@/pages/alerts/AlertsInbox';
import { DemoTools } from '@/pages/admin/DemoTools';
import { Outbox } from '@/pages/admin/Outbox';
import { RulesPage } from '@/pages/admin/rules/RulesPage';
import { Users } from '@/pages/admin/Users';
import { AuditLog } from '@/pages/audit/AuditLog';
import { PassportPage } from '@/pages/passport/PassportPage';
import { Login } from '@/pages/Login';
import { ReviewPage } from '@/pages/officer/ReviewPage';
import { ScrutinyQueue } from '@/pages/officer/ScrutinyQueue';
import { Dashboard } from '@/pages/dashboard/Dashboard';
import { InstitutionProfile, Institutions } from '@/pages/institutions/Institutions';
import { OfficerHome } from '@/pages/myday/OfficerHome';
import { Register } from '@/pages/register/Register';
import { Improvement } from '@/pages/reports/Improvement';
import { Reports } from '@/pages/reports/Reports';
import { ApproverHome } from '@/pages/releases/ApproverHome';
import { ReleaseList } from '@/pages/releases/ReleaseList';
import { ReleaseOrder } from '@/pages/releases/ReleaseOrder';
import { ReleaseReviewPage } from '@/pages/releases/ReleaseReviewPage';

/** The Phase 2 detail URL now opens the passport. */
function ToPassport() {
  const { id } = useParams();
  return <Navigate to={`/instruments/${id}`} replace />;
}

const INTERNAL: Role[] = ['officer', 'approver', 'admin', 'auditor'];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomeRedirect />} />
        <Route path="/officer" element={<ProtectedRoute roles={['officer']}><OfficerHome /></ProtectedRoute>} />
        <Route path="/approver" element={<ProtectedRoute roles={['approver']}><ApproverHome /></ProtectedRoute>} />
        <Route path="/admin" element={<Navigate to="/admin/rules" replace />} />
        <Route path="/auditor" element={<Navigate to="/audit" replace />} />
        <Route path="/admin/rules" element={<ProtectedRoute roles={['admin', 'auditor']}><RulesPage /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute roles={['admin', 'auditor']}><AuditLog /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute roles={INTERNAL}><Dashboard /></ProtectedRoute>} />
        <Route path="/register" element={<ProtectedRoute roles={INTERNAL}><Register /></ProtectedRoute>} />
        <Route path="/institutions" element={<ProtectedRoute roles={INTERNAL}><Institutions /></ProtectedRoute>} />
        <Route path="/institutions/:id" element={<InstitutionProfile />} />
        <Route path="/reports" element={<ProtectedRoute roles={INTERNAL}><Reports /></ProtectedRoute>} />
        <Route path="/reports/improvement" element={<ProtectedRoute roles={INTERNAL}><Improvement /></ProtectedRoute>} />
        <Route path="/institution" element={<ProtectedRoute roles={['institution']}><Outlet /></ProtectedRoute>}>
          <Route index element={<InstitutionHome />} />
          <Route path="instruments/new" element={<InstrumentWizard key="new" />} />
          <Route path="instruments/:id/edit" element={<InstrumentWizard />} />
          <Route path="instruments/:id" element={<ToPassport />} />
        </Route>
        <Route path="/instruments/:id" element={<PassportPage />} />
        <Route path="/officer/queue" element={<ProtectedRoute roles={['officer', 'approver', 'admin', 'auditor']}><ScrutinyQueue /></ProtectedRoute>} />
        <Route path="/officer/review/:id" element={<ProtectedRoute roles={['officer', 'approver', 'admin', 'auditor']}><ReviewPage /></ProtectedRoute>} />
        <Route path="/officer/releases" element={<ProtectedRoute roles={['officer', 'approver', 'admin', 'auditor']}><ReleaseList /></ProtectedRoute>} />
        <Route path="/officer/releases/:id" element={<ProtectedRoute roles={['officer', 'approver', 'admin', 'auditor']}><ReleaseReviewPage /></ProtectedRoute>} />
        <Route path="/approver/releases/:id" element={<ProtectedRoute roles={['approver']}><ReleaseReviewPage /></ProtectedRoute>} />
        <Route path="/releases/:id/order" element={<ReleaseOrder />} />
        <Route path="/alerts" element={<AlertsInbox />} />
        <Route path="/admin/demo" element={<ProtectedRoute roles={['admin']}><DemoTools /></ProtectedRoute>} />
        <Route path="/admin/outbox" element={<ProtectedRoute roles={['admin']}><Outbox /></ProtectedRoute>} />
        <Route path="*" element={<EmptyState title="Page not found" description="Check the address or use the menu." />} />
      </Route>
    </Routes>
  );
}
