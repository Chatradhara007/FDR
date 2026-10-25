import { Route, Routes } from 'react-router-dom';
import { ROLES } from '@fdr/shared';
import { HomeRedirect, ProtectedRoute } from '@/auth/ProtectedRoute';
import { Layout } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { ROLE_HOME } from '@/lib/roles';
import { Login } from '@/pages/Login';
import { RoleHome } from '@/pages/RoleHome';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomeRedirect />} />
        {ROLES.map((role) => (
          <Route key={role} path={ROLE_HOME[role]} element={<ProtectedRoute roles={[role]}><RoleHome role={role} /></ProtectedRoute>} />
        ))}
        <Route path="*" element={<EmptyState title="Page not found" description="Check the address or use the menu." />} />
      </Route>
    </Routes>
  );
}
