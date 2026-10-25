import { Route, Routes } from 'react-router-dom';
import { Layout } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { Home } from '@/pages/Home';
import { Login } from '@/pages/Login';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="*" element={<EmptyState title="Page not found" description="Check the address or use the menu." />} />
      </Route>
    </Routes>
  );
}
