import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { ROLES } from '@fdr/shared';
import { HomeRedirect, ProtectedRoute } from '@/auth/ProtectedRoute';
import { Layout } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { ROLE_HOME } from '@/lib/roles';
import { InstitutionHome } from '@/pages/institution/InstitutionHome';
import { InstrumentWizard } from '@/pages/institution/wizard/InstrumentWizard';
import { AlertsInbox } from '@/pages/alerts/AlertsInbox';
import { Outbox } from '@/pages/admin/Outbox';
import { PassportPage } from '@/pages/passport/PassportPage';
import { Login } from '@/pages/Login';
import { ReviewPage } from '@/pages/officer/ReviewPage';
import { ScrutinyQueue } from '@/pages/officer/ScrutinyQueue';
import { RoleHome } from '@/pages/RoleHome';
import { ApproverHome } from '@/pages/releases/ApproverHome';
import { ReleaseList } from '@/pages/releases/ReleaseList';
import { ReleaseOrder } from '@/pages/releases/ReleaseOrder';
import { ReleaseReviewPage } from '@/pages/releases/ReleaseReviewPage';

/** The Phase 2 detail URL now opens the passport. */
function ToPassport() {
  const { id } = useParams();
  return <Navigate to={`/instruments/${id}`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomeRedirect />} />
        {ROLES.filter((role) => role !== 'institution').map((role) => (
          <Route key={role} path={ROLE_HOME[role]}
            element={<ProtectedRoute roles={[role]}>{role === 'approver' ? <ApproverHome /> : <RoleHome role={role} />}</ProtectedRoute>} />
        ))}
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
        <Route path="/admin/outbox" element={<ProtectedRoute roles={['admin']}><Outbox /></ProtectedRoute>} />
        <Route path="*" element={<EmptyState title="Page not found" description="Check the address or use the menu." />} />
      </Route>
    </Routes>
  );
}
