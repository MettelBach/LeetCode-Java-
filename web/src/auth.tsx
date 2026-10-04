import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { useI18n, type Lang } from './i18n';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  language: Lang;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => void;
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
    setToken(null);
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
    if (me.data?.language) setLang(me.data.language);
  }, [me.data?.language, setLang]);
  const login = useCallback(
    async (token: string) => {
      setToken(token);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    [qc],
  );
  return (
    <Ctx.Provider
      value={{
        user: me.data ?? null,
        loading: me.isLoading,
        login,
        logout,
        refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
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
