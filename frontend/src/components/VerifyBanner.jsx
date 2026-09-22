/* Prompt to confirm the account.
 *
 * Deliberately a dismissible strip rather than a gate: blocking practice behind
 * a link that may sit in a spam folder would cost more accounts than it
 * protects. Accounts created before verification existed are unverified too,
 * so this must never stand between anyone and their work.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnvelopeSimple, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

/* Keyed per account, not per browser.
 *
 * A single shared key meant one person dismissing this hid it from everyone
 * who signed in on that machine afterwards — so the next account never saw
 * the prompt to confirm their address at all. Shared laptops and internet
 * cafés are ordinary for this audience. */
const dismissKey = (userId) => `prepfrancais.verifyDismissed.${userId}`;

export default function VerifyBanner() {
  const { user } = useAuth();
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-read whenever the account changes, including on the first load once the
  // session has been restored.
  useEffect(() => {
    if (!user?.user_id) { setDismissed(false); return; }
    try {
      setDismissed(localStorage.getItem(dismissKey(user.user_id)) === '1');
    } catch { setDismissed(false); }
  }, [user?.user_id]);

  // Either channel confirms the account. `verified` is the server's answer to
  // that; the email flag alone is the fallback for a bundle that predates it.
  const confirmed = user?.verified ?? user?.email_verified;
  /* An account the free-PDF form opened has no password yet, and nobody who
     filled that form in asked to register. Telling them to "secure your
     account" for something they have not done yet is a warning about a
     decision they were never offered — and it duplicates the confirmation
     the finish dialog asks for at the moment it starts to matter. */
  const notYetRegistered = user?.password_set === false;
  if (!user || confirmed || dismissed || notYetRegistered) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(dismissKey(user.user_id), '1'); } catch { /* private mode */ }
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success(t('auth.verifySent'));
    } catch (err) {
      toast.error(errMsg(err, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm text-amber-900 sm:px-6">
        <EnvelopeSimple size={18} weight="duotone" className="shrink-0" />
        <p className="flex-1">{t('auth.verifyBanner')}</p>
        <button type="button" onClick={resend} disabled={busy}
          className="font-semibold underline underline-offset-2 disabled:opacity-60">
          {t('auth.verifyResend')}
        </button>
        {/* Resending to an address typed wrong just repeats the mistake, so the
            way to correct it sits right next to the resend. */}
        <Link to="/account/verify" className="font-semibold underline underline-offset-2">
          {t('auth.verifyManage')}
        </Link>
        <button type="button" onClick={dismiss} aria-label={t('auth.dismiss')}
          className="-m-1 rounded p-1 text-amber-700 transition hover:text-amber-900">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
