import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Warning, SpinnerGap } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

/* Where Cashfree sends the learner back after they authorise the mandate.
 *
 * This page reports; it never grants. Premium is turned on by the signed
 * webhook, which arrives on its own schedule — usually within seconds, but the
 * browser landing here proves only that the learner finished at Cashfree, not
 * that the charge settled. So it polls the server for a few seconds and says
 * plainly when the answer has not arrived yet, rather than claiming success
 * from the mere fact of the redirect. */
const POLL_MS = 2000;
const MAX_POLLS = 10;

export default function BillingReturn() {
  const t = useT();
  const { refreshUser } = useAuth();
  const [state, setState] = useState('checking');   // checking | active | pending
  const [until, setUntil] = useState(null);
  const pollsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const check = async () => {
      try {
        const { data } = await api.get('/api/billing/subscription');
        if (cancelled) return;
        if (data.premium) {
          setUntil(data.premium_until);
          setState('active');
          // The header credit badge reads the cached user, so it would keep
          // showing the free trial until the next navigation without this.
          refreshUser?.();
          return;
        }
      } catch { /* transient — the retry below covers it */ }
      if (cancelled) return;
      pollsRef.current += 1;
      if (pollsRef.current >= MAX_POLLS) { setState('pending'); return; }
      timer = setTimeout(check, POLL_MS);
    };

    check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // refreshUser is stable enough; re-running would restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center" data-testid="billing-return">
      {state === 'checking' && (
        <>
          <SpinnerGap size={44} className="mx-auto animate-spin text-primary" />
          <h1 className="mt-5 font-heading text-2xl font-bold text-gray-900">
            {t('billing.checking')}
          </h1>
          <p className="mt-2 text-sm text-gray-600">{t('billing.checkingBody')}</p>
        </>
      )}

      {state === 'active' && (
        <>
          <CheckCircle size={48} weight="fill" className="mx-auto text-green-500" />
          <h1 className="mt-5 font-heading text-2xl font-bold text-gray-900">
            {t('billing.activeTitle')}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            {until
              ? t('billing.activeUntil', { date: new Date(until).toLocaleDateString() })
              : t('billing.activeBody')}
          </p>
        </>
      )}

      {state === 'pending' && (
        <>
          <Warning size={48} weight="fill" className="mx-auto text-amber-500" />
          <h1 className="mt-5 font-heading text-2xl font-bold text-gray-900">
            {t('billing.pendingTitle')}
          </h1>
          <p className="mt-2 text-sm text-gray-600">{t('billing.pendingBody')}</p>
        </>
      )}

      <Link to="/dashboard"
        className="btn-primary mt-8 inline-flex justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
        {t('billing.toDashboard')}
      </Link>
    </main>
  );
}
