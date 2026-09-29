'use client';

import { hasPermission, type Permission } from '@cpos/shared';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import type { Company, User } from './types';

interface AuthState {
  user: Pick<User, 'id' | 'name' | 'role' | 'companyId' | 'telegramId'> | null;
  company: Company | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithTelegram: (payload: Record<string, unknown>) => Promise<void>;
  logout: () => void;
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthState['user']>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ user: AuthState['user']; company: Company }>('/api/auth/me');
      setUser(me.user);
      setCompany(me.company);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      router.replace('/login');
    });
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [refresh, router]);

  const complete = useCallback(
    async (res: { token: string }) => {
      setToken(res.token);
      await refresh();
      router.replace('/dashboard');
    },
    [refresh, router],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      company,
      loading,
      login: async (email, password) => complete(await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email, password } })),
      loginWithTelegram: async (payload) => complete(await api<{ token: string }>('/api/auth/telegram', { method: 'POST', body: payload })),
      logout: () => {
        setToken(null);
        setUser(null);
        router.replace('/login');
      },
      can: (p) => !!user && hasPermission(user.role, p),
      refresh,
    }),
    [user, company, loading, complete, router, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
