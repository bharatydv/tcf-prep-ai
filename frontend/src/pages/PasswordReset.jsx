/* Forgot-password request and the reset form it links to.
 *
 * Neither existed, so a learner who forgot their password had no way back into
 * an account holding all of their practice history — it had to be fixed by
 * hand in the database.
 *
 * The request form always reports the same thing whether or not the address is
 * registered. Saying "no such account" would turn this page into a membership
 * oracle for anyone with a list of addresses.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EnvelopeSimple, Lock, Eye, EyeSlash, CheckCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

const SHELL = 'flex min-h-[calc(100dvh-4rem)] items-center justify-center '
  + 'bg-gradient-to-br from-violet-50 via-white to-violet-100 px-4 py-12';

export function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      // A rate-limit refusal is worth showing; anything else still resolves to
      // the neutral confirmation so the endpoint stays non-enumerable.
      if (err?.response?.status === 429) toast.error(errMsg(err, ''));
      else setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={SHELL}>
      <Seo titleKey="seo.forgot.title" descKey="seo.forgot.desc" path="/forgot-password" noindex />
      <div className="card w-full max-w-md p-8">
        {sent ? (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-green-600">
              <CheckCircle size={26} weight="duotone" />
            </span>
            <h1 className="mt-4 text-2xl font-bold">{t('auth.forgotH')}</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600" data-testid="forgot-sent">
              {t('auth.forgotSent')}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">{t('auth.forgotH')}</h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">{t('auth.forgotSub')}</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="relative">
                <EnvelopeSimple size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input !pl-11" type="email" name="email" autoComplete="email"
                  autoCapitalize="none" autoCorrect="off" spellCheck="false" required
                  placeholder={t('auth.email')} value={email}
                  onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email-input" />
              </div>
              <button className="btn-primary w-full" disabled={busy} data-testid="forgot-submit">
                {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {t('auth.forgotButton')}
              </button>
            </form>
          </>
        )}
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="font-semibold text-primary hover:underline">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </main>
  );
}

export function ResetPassword() {
  const t = useT();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError(t('auth.tooShort'));
    if (password !== confirm) return setError(t('auth.mismatch'));
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      // The endpoint signs the user in, so land them where they were going.
      await refreshUser();
      toast.success(t('auth.resetDone'));
      navigate('/practice', { replace: true });
    } catch (err) {
      const msg = err?.response?.status === 400 ? t('auth.resetBadLink') : errMsg(err, '');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <main className={SHELL}>
        <Seo titleKey="seo.reset.title" descKey="seo.reset.desc" path="/reset-password" noindex />
        <div className="card w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold">{t('auth.resetH')}</h1>
          <p className="mt-3 text-sm text-gray-600">{t('auth.resetBadLink')}</p>
          <Link to="/forgot-password" className="btn-primary mt-6 w-full">{t('auth.forgotButton')}</Link>
        </div>
      </main>
    );
  }

  return (
    <main className={SHELL}>
      <Seo titleKey="seo.reset.title" descKey="seo.reset.desc" path="/reset-password" noindex />
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">{t('auth.resetH')}</h1>
        <p className="mt-2 text-sm text-gray-500">{t('auth.resetSub')}</p>
        {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="reset-error">{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11 !pr-12" type={show ? 'text' : 'password'}
              name="new-password" autoComplete="new-password" required minLength={8}
              placeholder={t('auth.newPassword')} value={password}
              onChange={(e) => setPassword(e.target.value)} data-testid="reset-password-input" />
            <button type="button" onClick={() => setShow((v) => !v)}
              aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')} aria-pressed={show}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2.5 text-gray-400 transition hover:text-primary">
              {show ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type={show ? 'text' : 'password'}
              name="confirm-password" autoComplete="new-password" required
              placeholder={t('auth.confirmPassword')} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} data-testid="reset-confirm-input" />
          </div>
          <button className="btn-primary w-full" disabled={busy} data-testid="reset-submit">
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {t('auth.resetButton')}
          </button>
        </form>
      </div>
    </main>
  );
}
