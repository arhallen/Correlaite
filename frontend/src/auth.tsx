import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try { if (user) localStorage.setItem('hadSession', '1'); else if (!loading) localStorage.removeItem('hadSession'); } catch { /* ignore */ }
  }, [user, loading]);

  useEffect(() => {
    api<User>('/me')
      .then(setUser)
      .catch((e) => { if (!(e instanceof ApiError && e.status === 401)) console.error(e); })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, setUser, logout }}>{children}</Ctx.Provider>;
}
