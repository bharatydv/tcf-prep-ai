import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '../lib/api';

const AuthContext = createContext(null);

/* The session cookies are httpOnly and unreadable here by design. The server
   sets this ordinary companion cookie alongside them, carrying no identity —
   only the fact that a session exists. Without it, every anonymous visitor
   paid for two failed round trips (/auth/me -> 401 -> /auth/refresh -> 401)
   before the landing page settled. */
const SESSION_HINT = 'mf_session';

/* Remembers that the last probe found nobody signed in, so a returning
   anonymous visitor skips it too. It is the reason a session that predates the
   hint cookie is not locked out: with neither marker present we still probe
   once, and /auth/me sets the hint cookie on the way back.

   NOT 'prepfrancais.anon' — that key belongs to the analytics id in lib/api.js,
   and the two collided in both directions. Once track() had stored its UUID,
   the '1' comparison below never matched and every anonymous visitor paid for
   the /auth/me → 401 → /auth/refresh → 401 pair this marker exists to skip;
   and logging out stamped '1' over the analytics id, so every signed-out
   browser reported the same anon_id and the funnel counted them as one person,
   while logging in deleted the id and made a returning browser look brand new. */
const ANON_MARKER = 'prepfrancais.anonSession';

function hasSessionHint() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${SESSION_HINT}=`));
}

function markAnonymous(value) {
  try {
    if (value) localStorage.setItem(ANON_MARKER, '1');
    else localStorage.removeItem(ANON_MARKER);
  } catch { /* storage blocked — the cookie hint still works */ }
}

function knownAnonymous() {
  try { return localStorage.getItem(ANON_MARKER) === '1'; } catch { return false; }
}

/* Probe unless we have positive evidence there is nothing to restore. */
function shouldProbe() {
  return hasSessionHint() || !knownAnonymous();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Nothing to wait for when there is no session to restore.
  const [loading, setLoading] = useState(shouldProbe);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      markAnonymous(false);
      return data.user;
    } catch (e) {
      if (e?.response?.status === 401) {
        try {
          const { data } = await api.post('/auth/refresh');
          setUser(data.user);
          markAnonymous(false);
          return data.user;
        } catch {
          setUser(null);
          markAnonymous(true);
        }
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (!shouldProbe()) { setLoading(false); return; }
    (async () => { await refreshUser(); setLoading(false); })();
  }, [refreshUser]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setUser(data.user);
      markAnonymous(false);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: errMsg(e, 'Login failed') };
    }
  };

  const register = async (name, email, password) => {
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      setUser(data.user);
      markAnonymous(false);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: errMsg(e, 'Registration failed') };
    }
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    setUser(null);
    markAnonymous(true);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
