import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, loadSession, saveSession, setUnauthorizedHandler } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import type { Session, User } from '@/types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  async function applySession(next: Session | null) {
    await saveSession(next);
    if (!next) queryClient.clear(); // não vazar dados entre contas
    setSession(next);
  }

  useEffect(() => {
    // Restaura a sessão guardada no aparelho quando o app abre.
    loadSession()
      .then(setSession)
      .finally(() => setLoading(false));

    // Se o servidor disser 401 (token inválido), volta para o login.
    setUnauthorizedHandler(() => {
      applySession(null).catch(() => undefined);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn: async (email, password) => {
        const next = await api<Session>('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        await applySession(next);
      },
      signUp: async (name, email, password) => {
        const next = await api<Session>('/auth/register', {
          method: 'POST',
          body: { name, email, password },
        });
        await applySession(next);
      },
      signOut: async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } catch {
          // Sem servidor, sair continua funcionando: apagamos a sessão local.
        }
        await applySession(null);
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return context;
}
