import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { connectSocket, disconnectSocket } from './socket';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    // hapus juga cookie lampiran (HttpOnly, hanya bisa dihapus server)
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    disconnectSocket();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me', { noRedirect: true })
      .then((r) => {
        setUser(r.user);
        connectSocket(t);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password }, { noRedirect: true });
    setToken(r.token);
    connectSocket(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (data) => {
    const r = await api.post('/auth/register', data, { noRedirect: true });
    setToken(r.token);
    connectSocket(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(() => ({ user, setUser, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export const ROLE_LABEL = {
  admin: 'Administrator',
  designer: 'Exercise Designer',
  facilitator: 'Fasilitator',
  player: 'Peserta (Player)',
  evaluator: 'Evaluator',
  viewer: 'Viewer',
};

export function canDesign(user) {
  return user && ['admin', 'designer', 'facilitator'].includes(user.role);
}
