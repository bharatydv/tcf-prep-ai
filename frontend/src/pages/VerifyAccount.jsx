/* Confirm the account — by e-mail or by SMS — and fix what was typed wrong.
 *
 * Registering with a mistyped address used to be a dead end: the confirmation
 * went somewhere nobody reads and nothing in the product could change where it
 * was sent. This page owns all three ways out: correct the address, confirm a
 * phone number instead, or reset a forgotten password.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  EnvelopeSimple, DeviceMobile, CheckCircle, PaperPlaneTilt,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink } from '../components/shared';
import { Seo } from '../lib/seo';

export default function VerifyAccount() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [tab, setTab] = useState('email');       // email | phone
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setEmail((e) => e || user.email || '');
    setPhone((p) => p || user.phone || '');
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const resend = () => run(async () => {
    try {
      await api.post('/auth/resend-verification');
      toast.success(t('auth.verifySent'));
    } catch (err) { toast.error(errMsg(err, t('auth.verifyFail'))); }
  });

  const changeEmail = (e) => {
    e.preventDefault();
    return run(async () => {
      try {
        await api.post('/auth/change-email', { email: email.trim().toLowerCase(), password });
        await refreshUser();
        setPassword('');
        toast.success(t('auth.emailChanged'));
      } catch (err) { toast.error(errMsg(err, t('auth.verifyFail'))); }
    });
  };

  const sendCode = (e) => {
    e.preventDefault();
    return run(async () => {
      try {
        await api.post('/auth/phone/send', { phone: phone.trim() });
        setSent(true);
        toast.success(t('auth.codeSent'));
      } catch (err) { toast.error(errMsg(err, t('auth.verifyFail'))); }
    });
  };

  const verifyCode = (e) => {
    e.preventDefault();
    return run(async () => {
      try {
        await api.post('/auth/phone/verify', { code: code.trim() });
        await refreshUser();
        setCode('');
        setSent(false);
        toast.success(t('auth.phoneVerified'));
      } catch (err) { toast.error(errMsg(err, t('auth.verifyFail'))); }
    });
  };

  const done = Boolean(user.verified);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <Seo title={t('auth.verifyTitle')} description={t('auth.verifyIntro')}
        path="/account/verify" noindex />
      <BackLink to="/dashboard" />

      <h1 className="mt-4 font-heading text-2xl font-bold text-gray-900">
        {t('auth.verifyTitle')}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-600">{t('auth.verifyIntro')}</p>

      {done && (
        <p className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle size={18} weight="fill" /> {t('auth.verifiedAlready')}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        {[['email', EnvelopeSimple, 'auth.verifyByEmail'], ['phone', DeviceMobile, 'auth.verifyBySms']]
          .map(([key, Icon, labelKey]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                tab === key
                  ? 'border-primary bg-violet-50 text-primary'
                  : 'border-gray-200 text-gray-600 hover:border-violet-200'}`}>
              <Icon size={16} weight="fill" /> {t(labelKey)}
            </button>
          ))}
      </div>

      {tab === 'email' ? (
        <form onSubmit={changeEmail} className="mt-5 space-y-4 rounded-3xl border border-violet-100 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              {t('auth.currentEmail')} <strong className="text-gray-900">{user.email}</strong>
            </p>
            <span className={`pill shrink-0 ${user.email_verified
              ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {user.email_verified ? t('auth.confirmed') : t('auth.notConfirmed')}
            </span>
          </div>

          {!user.email_verified && (
            <button type="button" onClick={resend} disabled={busy}
              className="btn-outline w-full justify-center disabled:opacity-60">
              <PaperPlaneTilt size={16} weight="fill" /> {t('auth.verifyResend')}
            </button>
          )}

          <div className="border-t border-gray-100 pt-4">
            <p className="font-heading text-sm font-bold text-gray-900">{t('auth.changeEmail')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('auth.changeEmailHint')}</p>
            <label className="mt-3 block text-xs font-semibold text-gray-700" htmlFor="new-email">
              {t('auth.newEmail')}
            </label>
            <input id="new-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input mt-1 w-full" autoComplete="email" />
            <label className="mt-3 block text-xs font-semibold text-gray-700" htmlFor="cur-password">
              {t('auth.currentPassword')}
            </label>
            <input id="cur-password" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input mt-1 w-full" autoComplete="current-password" />
            <button type="submit" disabled={busy}
              className="btn-primary mt-4 w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60">
              {t('auth.changeEmailBtn')}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-5 space-y-4 rounded-3xl border border-violet-100 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              {user.phone ? <>{t('auth.currentPhone')} <strong className="text-gray-900">{user.phone}</strong></>
                : t('auth.noPhone')}
            </p>
            {user.phone && (
              <span className={`pill shrink-0 ${user.phone_verified
                ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {user.phone_verified ? t('auth.confirmed') : t('auth.notConfirmed')}
              </span>
            )}
          </div>

          <form onSubmit={sendCode}>
            <label className="block text-xs font-semibold text-gray-700" htmlFor="phone">
              {t('auth.phoneLabel')}
            </label>
            <input id="phone" type="tel" required value={phone} placeholder="+33 6 12 34 56 78"
              onChange={(e) => setPhone(e.target.value)}
              className="input mt-1 w-full" autoComplete="tel" />
            <p className="mt-1 text-xs text-gray-500">{t('auth.phoneHint')}</p>
            <button type="submit" disabled={busy}
              className="btn-outline mt-3 w-full justify-center disabled:opacity-60">
              <PaperPlaneTilt size={16} weight="fill" />
              {sent ? t('auth.resendCode') : t('auth.sendCode')}
            </button>
          </form>

          {sent && (
            <form onSubmit={verifyCode} className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-semibold text-gray-700" htmlFor="code">
                {t('auth.codeLabel')}
              </label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code"
                required value={code} maxLength={6} placeholder="123456"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="input mt-1 w-full tracking-[0.4em]" />
              <button type="submit" disabled={busy}
                className="btn-primary mt-3 w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60">
                {t('auth.verifyCode')}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="mt-5 text-center text-sm text-gray-500">
        {t('auth.forgotIntro')}{' '}
        <Link to="/forgot-password" className="font-semibold text-primary hover:underline">
          {t('auth.forgot')}
        </Link>
      </p>
      <button type="button" onClick={() => navigate('/dashboard')}
        className="mt-3 w-full text-center text-xs font-semibold text-gray-400 hover:text-gray-600">
        {t('auth.laterSkip')}
      </button>
    </div>
  );
}
