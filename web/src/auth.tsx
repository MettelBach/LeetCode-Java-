import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { api, getToken, isImpersonating, setImpersonationToken, setToken, setUnauthorizedHandler } from './api';
import { useI18n, type Lang } from './i18n';

export interface User {
  id: number;
  account_id: number;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'user';
  language: Lang;
  impersonator: { id: number; name: string; email: string } | null;
  account: { id: number; name: string; plan: string; plan_name: string; status: 'trial' | 'active' | 'suspended' | 'closed'; trial_ends_at: string | null; paid_until: string | null };
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => void;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setLang } = useI18n();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => (getToken() ? api.get<User>('/auth/me') : Promise.resolve(null)),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const logout = useCallback(() => {
    if (isImpersonating()) {
      setImpersonationToken(null);
      window.close();
    } else setToken(null);
    qc.clear();
    qc.setQueryData(['me'], null);
  }, [qc]);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.clear();
      qc.setQueryData(['me'], null);
    });
  }, [qc]);
  useEffect(() => {
    // Support staff keep their own language while impersonating.
    if (me.data?.language && !me.data.impersonator) setLang(me.data.language);
  }, [me.data?.language, me.data?.impersonator, setLang]);
  const login = useCallback(
    async (token: string) => {
      setToken(token);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    [qc],
  );
  const user = me.data ?? null;
  return (
    <Ctx.Provider
      value={{
        user,
        loading: me.isLoading,
        login,
        logout,
        refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
        isAdmin: !!user && (user.role !== 'user' || !!user.impersonator),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
