import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Warning, SpinnerGap, XCircle, ArrowCounterClockwise } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

/* Where the gateway sends the learner back after they finish — or don't.
 *
 * This page reports; it never grants. Premium is turned on by the signed
 * webhook, which arrives on its own schedule — usually within seconds, but the
 * browser landing here proves only that the learner finished at the gateway,
 * not that the charge settled. So it polls the server for a few seconds and
 * says plainly when the answer has not arrived yet, rather than claiming
 * success from the mere fact of the redirect.
 *
 * Polling is for a payment that might still land. Somebody who pressed Cancel
 * is not waiting for anything, and spending twenty seconds on "Confirming your
 * payment…" before telling them their bank has not replied is a lie about
 * something they just did themselves. The webhook reads PayU's own reason —
 * cancelled is reported as a failure there, the difference being in
 * `unmappedstatus` — and passes it in ?status, so those two land finished. */
const POLL_MS = 2000;
const MAX_POLLS = 10;

export default function BillingReturn() {
  const t = useT();
  const { refreshUser } = useAuth();
  const [params] = useSearchParams();
  /* The gateway's own verdict, and the only thing that can be known at the
     moment of landing. Anything else — including no parameter at all, which
     is every Cashfree return and any PayU reply that failed to parse — falls
     through to the poll, because then the server is the only one who knows. */
  const reported = params.get('status');
  const [state, setState] = useState(   // checking | active | pending | cancelled | failed
    reported === 'cancelled' || reported === 'failed' ? reported : 'checking');
  const [until, setUntil] = useState(null);
  const pollsRef = useRef(0);
  const settled = state === 'cancelled' || state === 'failed';

  useEffect(() => {
    if (settled) return undefined;
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
  }, [settled]);

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

      {state === 'cancelled' && (
        <>
          <XCircle size={48} weight="fill" className="mx-auto text-gray-400" />
          <h1 className="mt-5 font-heading text-2xl font-bold text-gray-900">
            {t('billing.cancelledTitle')}
          </h1>
          <p className="mt-2 text-sm text-gray-600">{t('billing.cancelledBody')}</p>
        </>
      )}

      {state === 'failed' && (
        <>
          <XCircle size={48} weight="fill" className="mx-auto text-red-500" />
          <h1 className="mt-5 font-heading text-2xl font-bold text-gray-900">
            {t('billing.declinedTitle')}
          </h1>
          <p className="mt-2 text-sm text-gray-600">{t('billing.declinedBody')}</p>
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

      {/* Nothing was charged, so the useful door is back to the plans — and
          it is the first one, because somebody who stopped mid-payment most
          often meant to change something, not to leave. */}
      {settled ? (
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/pricing" data-testid="billing-retry"
            className="btn-primary inline-flex justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <ArrowCounterClockwise size={17} weight="bold" /> {t('billing.tryAgain')}
          </Link>
          <Link to="/dashboard" className="btn-outline inline-flex justify-center">
            {t('billing.toDashboard')}
          </Link>
        </div>
      ) : (
        <Link to="/dashboard"
          className="btn-primary mt-8 inline-flex justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
          {t('billing.toDashboard')}
        </Link>
      )}
    </main>
  );
}
