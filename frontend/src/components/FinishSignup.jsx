/* The password the free-PDF form never asked for, asked at the moment it
 * finally matters.
 *
 * Mounted once near the router, like Paywall, and opened by the same
 * mechanism: lib/api.js announces every 403 account_incomplete on the window,
 * so no page has to know that an account can be half-made. Whoever hits this
 * has just pressed record or pressed correct, and navigating them to a
 * registration page would throw out what they were in the middle of.
 *
 * Two steps, and the second one is a six-digit code rather than a link. A
 * link means leaving for a mail client and coming back to wherever the link
 * decides — which, for somebody who was thirty seconds into practising, is
 * not coming back at all. The code is typed here and the page they were on
 * is still behind it.
 *
 * Everything the download form already collected is filled in and shown
 * rather than asked for again. The address cannot be edited: it is what the
 * code is going to, and it is what the account is keyed on.
 */
import { useCallback, useEffect, useState } from 'react';
import { X, ArrowRight, CheckCircle, Envelope } from '@phosphor-icons/react';
import { api, errMsg, FINISH_SIGNUP_EVENT } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1/C2', 'not-sure'];

export default function FinishSignup() {
  const { user, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onNeeded = () => setOpen(true);
    window.addEventListener(FINISH_SIGNUP_EVENT, onNeeded);
    return () => window.removeEventListener(FINISH_SIGNUP_EVENT, onNeeded);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /* Nothing to finish once it is finished. Closing on that rather than in the
     submit handler means the dialog also goes away if the account is
     completed in another tab. */
  useEffect(() => { if (user && user.complete) setOpen(false); }, [user]);

  if (!open || !user || user.complete) return null;
  return (
    <FinishDialog user={user} refreshUser={refreshUser}
      onClose={() => setOpen(false)} />
  );
}

function FinishDialog({ user, refreshUser, onClose }) {
  const t = useT();
  /* Somebody who already chose a password and never confirmed the address is
     past the first step; there is nothing to ask them for but the code. */
  const [step, setStep] = useState(user.password_set ? 'code' : 'password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({
    name: user.name || '', phone: user.phone || '',
    level: user.level || '', password: '', confirm: '',
  });
  const [code, setCode] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const sendCode = useCallback(async (quiet) => {
    try {
      const { data } = await api.post('/auth/email-code/send');
      if (!quiet) setNote(data.email_sent ? t('finish.codeResent') : t('finish.codeNotSent'));
    } catch (err) {
      setError(errMsg(err, t('finish.fail')));
    }
  }, [t]);

  /* Landing straight on the code step means no code has been sent in this
     visit, so one is sent on the way in. The password step sends its own. */
  useEffect(() => {
    if (user.password_set && !user.email_verified) sendCode(true);
    // Once, on mount. Re-sending on every render would be one mail a keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPassword = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (form.password !== form.confirm) {
      setError(t('finish.mismatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/finish-registration', {
        password: form.password,
        name: form.name.trim(),
        phone: form.phone.trim(),
        level: form.level,
      });
      await refreshUser();
      setNote(data.email_sent ? t('finish.codeSent') : t('finish.codeNotSent'));
      setStep('code');
    } catch (err) {
      setError(errMsg(err, t('finish.fail')));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/email-code/verify', { code: code.trim() });
      await refreshUser();
      setStep('done');
    } catch (err) {
      setError(errMsg(err, t('finish.codeFail')));
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-violet-200';
  const label = 'mb-1.5 block text-[13px] font-bold text-gray-900';
  const primary = 'btn-primary w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 !py-3 text-sm disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/70 p-3 backdrop-blur-sm sm:p-4"
      role="dialog" aria-modal="true" aria-label={t('finish.title')}
      data-testid="finish-signup">
      <div className="max-h-[96vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.08em] text-white/80">
              {t('finish.eyebrow')}
            </p>
            <p className="font-heading text-lg font-bold leading-tight">
              {step === 'done' ? t('finish.doneTitle') : t('finish.title')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('lead.close')}
            data-testid="finish-close"
            className="shrink-0 rounded-lg p-1 text-white/80 transition hover:bg-white/20 hover:text-white">
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="px-5 py-5">
          {step === 'password' && (
            <>
              <p className="text-[13px] leading-relaxed text-gray-600">
                {t('finish.passwordIntro')}
              </p>
              <form onSubmit={submitPassword} className="mt-4 space-y-3"
                data-testid="finish-password-form">
                <div>
                  <span className={label}>{t('lead.email')}</span>
                  {/* Not a field. This is what the code is going to and what
                      the account is keyed on; changing it here would be
                      changing which account is being finished. */}
                  <p className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2.5 text-sm font-semibold text-gray-700">
                    {user.email}
                  </p>
                </div>
                <div>
                  <label htmlFor="finish-name" className={label}>{t('lead.name')}</label>
                  <input id="finish-name" className={field} value={form.name}
                    onChange={set('name')} name="name" autoComplete="name"
                    required minLength={2} maxLength={120} />
                </div>
                <div>
                  <label htmlFor="finish-phone" className={label}>{t('lead.phone')}</label>
                  <input id="finish-phone" className={field} value={form.phone}
                    onChange={set('phone')} name="phone" type="tel"
                    autoComplete="tel" required minLength={6} maxLength={32} />
                </div>
                <div>
                  <label htmlFor="finish-level" className={label}>{t('lead.level')}</label>
                  <select id="finish-level" className={field} value={form.level}
                    onChange={set('level')} name="level">
                    <option value="">{t('lead.levelPh')}</option>
                    {LEVELS.map((v) => (
                      <option key={v} value={v}>{v === 'not-sure' ? t('lead.levelUnsure') : v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="finish-password" className={label}>{t('finish.password')}</label>
                  <input id="finish-password" className={field} value={form.password}
                    onChange={set('password')} name="new-password" type="password"
                    autoComplete="new-password" required minLength={8} maxLength={72}
                    placeholder={t('finish.passwordPh')} />
                </div>
                <div>
                  <label htmlFor="finish-confirm" className={label}>{t('finish.confirm')}</label>
                  <input id="finish-confirm" className={field} value={form.confirm}
                    onChange={set('confirm')} name="confirm-password" type="password"
                    autoComplete="new-password" required minLength={8} maxLength={72} />
                </div>
                {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
                <button type="submit" disabled={busy} className={primary}>
                  {busy ? t('finish.saving') : t('finish.passwordCta')}
                  <ArrowRight size={16} weight="bold" />
                </button>
              </form>
            </>
          )}

          {step === 'code' && (
            <>
              <Envelope size={32} weight="fill" className="mx-auto text-primary" />
              <p className="mt-3 text-center text-[13px] leading-relaxed text-gray-600">
                {t('finish.codeIntro', { email: user.email })}
              </p>
              <form onSubmit={submitCode} className="mt-4 space-y-3"
                data-testid="finish-code-form">
                <input className={`${field} text-center text-xl font-black tracking-[0.4em]`}
                  value={code} onChange={(e) => setCode(e.target.value)}
                  name="code" inputMode="numeric" autoComplete="one-time-code"
                  required pattern="[0-9]{6}" maxLength={6}
                  placeholder="000000" aria-label={t('finish.code')} />
                {note && <p className="text-center text-xs font-semibold text-emerald-600">{note}</p>}
                {error && <p className="text-center text-xs font-semibold text-rose-600">{error}</p>}
                <button type="submit" disabled={busy} className={primary}>
                  {busy ? t('finish.checking') : t('finish.codeCta')}
                </button>
              </form>
              <button type="button" onClick={() => sendCode(false)}
                className="mt-3 block w-full text-xs font-semibold text-gray-500 hover:text-primary">
                {t('finish.resend')}
              </button>
            </>
          )}

          {step === 'done' && (
            <div className="text-center">
              <CheckCircle size={40} weight="fill" className="mx-auto text-emerald-500" />
              <p className="mt-3 text-[14px] leading-relaxed text-gray-600">
                {t('finish.doneBody')}
              </p>
              <button type="button" onClick={onClose} className={`${primary} mt-4`}>
                {t('finish.doneCta')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
