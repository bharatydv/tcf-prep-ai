/* Landing page for the confirmation link sent at registration.
 *
 * Nothing previously proved an address belonged to the person who typed it, so
 * anyone could sign up under someone else's email — which becomes a billing
 * dispute the moment paid plans open.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

export default function VerifyEmail() {
  const t = useT();
  const [params] = useSearchParams();
  const { refreshUser } = useAuth();
  const token = params.get('token') || '';
  const [state, setState] = useState('working'); // working | ok | failed
  // React 18+ mounts effects twice in development; without this the token is
  // spent on the first call and the second one reports failure.
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!token) { setState('failed'); return; }
    api.post('/auth/verify-email', { token })
      .then(async () => { await refreshUser(); setState('ok'); })
      .catch(() => setState('failed'));
  }, [token, refreshUser]);

  const ok = state === 'ok';
  const working = state === 'working';

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-gradient-to-br from-violet-50 via-white to-violet-100 px-4 py-12">
      <Seo title={t('auth.verifyOk')} description={t('auth.verifyBanner')} path="/verify-email" noindex />
      <div className="card w-full max-w-md p-8 text-center">
        {working ? (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
            <p className="mt-5 text-sm text-gray-600">{t('auth.verifying')}</p>
          </>
        ) : (
          <>
            <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
              ok ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
              {ok ? <CheckCircle size={28} weight="duotone" /> : <WarningCircle size={28} weight="duotone" />}
            </span>
            <h1 className="mt-4 font-heading text-2xl font-bold text-gray-900" data-testid="verify-result">
              {ok ? t('auth.verifyOk') : t('auth.verifyFail')}
            </h1>
            <Link to={ok ? '/practice' : '/dashboard'} className="btn-primary mt-7 w-full">
              {ok ? t('nav.writing') : t('nav.dashboard')}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
