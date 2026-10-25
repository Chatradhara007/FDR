import { Outlet, Route, Routes } from 'react-router-dom';
import { ROLES } from '@fdr/shared';
import { HomeRedirect, ProtectedRoute } from '@/auth/ProtectedRoute';
import { Layout } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { ROLE_HOME } from '@/lib/roles';
import { InstitutionHome } from '@/pages/institution/InstitutionHome';
import { InstrumentView } from '@/pages/institution/InstrumentView';
import { InstrumentWizard } from '@/pages/institution/wizard/InstrumentWizard';
import { Login } from '@/pages/Login';
import { ReviewPage } from '@/pages/officer/ReviewPage';
import { ScrutinyQueue } from '@/pages/officer/ScrutinyQueue';
import { RoleHome } from '@/pages/RoleHome';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomeRedirect />} />
        {ROLES.filter((role) => role !== 'institution').map((role) => (
          <Route key={role} path={ROLE_HOME[role]} element={<ProtectedRoute roles={[role]}><RoleHome role={role} /></ProtectedRoute>} />
        ))}
        <Route path="/institution" element={<ProtectedRoute roles={['institution']}><Outlet /></ProtectedRoute>}>
          <Route index element={<InstitutionHome />} />
          <Route path="instruments/new" element={<InstrumentWizard key="new" />} />
          <Route path="instruments/:id/edit" element={<InstrumentWizard />} />
          <Route path="instruments/:id" element={<InstrumentView />} />
        </Route>
        <Route path="/officer/queue" element={<ProtectedRoute roles={['officer', 'approver', 'admin', 'auditor']}><ScrutinyQueue /></ProtectedRoute>} />
        <Route path="/officer/review/:id" element={<ProtectedRoute roles={['officer', 'approver', 'admin', 'auditor']}><ReviewPage /></ProtectedRoute>} />
        <Route path="*" element={<EmptyState title="Page not found" description="Check the address or use the menu." />} />
      </Route>
    </Routes>
  );
}
