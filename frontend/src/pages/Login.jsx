import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { EnvelopeSimple, Lock, Eye, EyeSlash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

export default function Login() {
  const { login } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  // ProtectedRoute records where the user was heading before it bounced them
  // here, so a link to a specific correction survives the sign-in.
  const from = location.state?.from?.pathname;
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

const submit = async (e) => {
  e.preventDefault();
  setError(''); 
  setBusy(true);
  
  const res = await login(email, password);  // ✅ This is the function from useAuth
  
  setBusy(false);
  if (res.ok) {
    toast.success(t('auth.welcomeToast', { name: res.user.name }));
    const fallback = res.user.role === 'admin' ? '/admin' : '/practice';
    navigate(from && from !== '/login' ? from : fallback, { replace: true });
  } else {
    setError(res.error);
    toast.error(res.error);
  }
};

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-gradient-to-br from-violet-50 via-white to-violet-100 px-4 py-12">
      <Seo titleKey="seo.login.title" descKey="seo.login.desc" path="/login" />
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">{t('auth.welcomeBack')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('auth.loginSub')}</p>
        {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="login-error">{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <EnvelopeSimple size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type="email" name="email" autoComplete="email"
              autoCapitalize="none" autoCorrect="off" spellCheck="false" required
              placeholder={t('auth.email')} value={email}
              onChange={(e) => setEmail(e.target.value)} data-testid="email-input" />
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11 !pr-12" type={showPassword ? 'text' : 'password'}
              name="password" autoComplete="current-password" required
              placeholder={t('auth.password')} value={password}
              onChange={(e) => setPassword(e.target.value)} data-testid="password-input" />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2.5 text-gray-400 transition hover:text-primary">
              {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <button className="btn-primary w-full" disabled={busy} data-testid="login-button">
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {t('auth.loginButton')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/forgot-password" className="font-semibold text-primary hover:underline">
            {t('auth.forgot')}
          </Link>
        </p>
        <p className="mt-4 text-center text-sm text-gray-600">
          {t('auth.noAccountPrefix')} <Link to="/register" className="font-semibold text-primary">{t('auth.noAccount')}</Link>
        </p>
      </div>
    </main>
  );
}
