import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LoginResponse, SessionUser } from '@fdr/shared';
import { apiFetch } from '@/api/client';
import { clearToken, getStoredUser, getToken, setSession } from './token';

interface AuthValue {
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(() => (getToken() ? getStoredUser() : null));

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
    queryClient.clear();
    setSession(res.token, res.user);
    setUser(res.user);
    return res.user;
  }, [queryClient]);

  const logout = useCallback(() => {
    clearToken();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
