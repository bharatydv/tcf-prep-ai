import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '../lib/api';
// To this:
const res = await api.post('/auth/login', ...);
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/api/auth/me');
      setUser(data.user);
      return data.user;
    } catch (e) {
      if (e?.response?.status === 401) {
        try {
          const { data } = await api.post('/api/auth/refresh');
          setUser(data.user);
          return data.user;
        } catch {
          setUser(null);
        }
      }
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => { await refreshUser(); setLoading(false); })();
  }, [refreshUser]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post('/api/auth/login', { email, password });
      setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: errMsg(e, 'Login failed') };
    }
  };

  const register = async (name, email, password) => {
    try {
      const { data } = await api.post('/api/auth/register', { name, email, password });
      setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: errMsg(e, 'Registration failed') };
    }
  };

  const logout = async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
