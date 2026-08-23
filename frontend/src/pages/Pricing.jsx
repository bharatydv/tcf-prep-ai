import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { CheckoutBreakdown, useBillingPlans } from '../lib/plans';

const FEATURE_KEYS = ['pricing.feature1', 'pricing.feature2', 'pricing.feature3', 'pricing.feature4'];
const FAQ_KEYS = [
  ['pricing.faq1q', 'pricing.faq1a'],
  ['pricing.faq2q', 'pricing.faq2a'],
  ['pricing.faq3q', 'pricing.faq3a'],
  ['pricing.faq4q', 'pricing.faq4a'],
];

export default function Pricing() {
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const { plans, currency, configured, loading } = useBillingPlans();
  const [busy, setBusy] = useState('');
  const cta = user ? '/dashboard' : '/register';

  /* Opens the mandate at Cashfree and hands the browser over to it. Nothing is
     granted here — the signed webhook does that — so there is no success path
     to fake if this call is tampered with. */
  const subscribe = async (planId) => {
    if (!user) return navigate('/register');
    if (busy) return;
    setBusy(planId);
    try {
      const { data } = await api.post('/api/billing/subscribe', { plan_id: planId });
      if (data?.auth_link) {
        window.location.assign(data.auth_link);
        return;
      }
      // A subscription with no authorisation link cannot be paid, and sending
      // the learner nowhere silently is how "I paid and nothing happened"
      // reports start.
      toast.error(t('billing.noLink'));
    } catch (err) {
      toast.error(errMsg(err, t('billing.failed')));
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <Seo titleKey="seo.pricing.title" descKey="seo.pricing.desc" path="/pricing" />
      <h1 className="text-center text-4xl font-bold">{t('pricing.title')}</h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
        {t('pricing.subtitle')}
      </p>

      {/* Selling a plan that cannot be bought sends people to a dead end at the
          exact moment they decide to pay. Say so before the cards, not in a
          collapsed FAQ item underneath them. Now driven by whether the server
          actually holds payment credentials, rather than a hardcoded flag that
          someone has to remember to flip. */}
      {!loading && !configured && (
        <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center"
          data-testid="pricing-unavailable-notice">
          <p className="text-sm font-semibold text-amber-900">
            {t('pricing.noticeTitle')}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {t('pricing.noticeBody')}
          </p>
        </div>
      )}

      <div className="mt-12 grid items-center gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <div key={p.name}
            className={`card relative overflow-hidden ${p.popular ? 'z-10 ring-4 ring-primary md:scale-110' : ''}`}
            data-testid={`plan-${p.name.toLowerCase()}`}>
            <div className="absolute -right-9 top-5 rotate-45 bg-gray-900 px-10 py-1 text-[10px] font-bold tracking-widest text-white">PACK</div>
            {p.popular && (
              <div className="bg-primary py-1.5 text-center text-xs font-bold tracking-wider text-white">{t('pricing.mostPopular')}</div>
            )}
            <div className={`bg-gradient-to-r ${p.grad} px-6 py-7 text-white`}>
              <h2 className="font-heading text-2xl font-bold">{p.name}</h2>
              <p className="mt-2">
                <span className="font-heading text-4xl font-bold">{p.price}</span>
                {/* Only rendered when the introductory rate actually applies,
                    so no card ever strikes through a price equal to the one
                    printed next to it. */}
                {p.wasPrice && (
                  <span className="ml-2 align-middle text-lg text-white/60 line-through">{p.wasPrice}</span>
                )}
                {/* A plan id with no style entry has no duration key, and
                    t() throws on an undefined one — the server's own plan name
                    is the truthful label to fall back to. */}
                <span className="text-white/80"> / {p.durationKey ? t(p.durationKey) : p.name}</span>
              </p>
              {p.wasPrice && (
                <p className="mt-1 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  {t('pricing.firstTime')}
                </p>
              )}
              <p className="mt-1 text-sm font-semibold text-white/90">+ {t('pricing.bonus', { n: p.bonus })}</p>
            </div>
            {/* The fee is shown here, above the button, because a charge the
                customer meets after paying is a charge they did not agree to. */}
            <CheckoutBreakdown plan={p} currency={currency} />
            <ul className="space-y-3 p-6 text-sm">
              {FEATURE_KEYS.map((k) => (
                <li key={k} className="flex items-start gap-2">
                  <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-green-500" /> {t(k)}
                </li>
              ))}
            </ul>
            <div className="px-6 pb-6">
              {configured ? (
                <button onClick={() => subscribe(p.id)} disabled={Boolean(busy)}
                  className="btn-primary w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60"
                  data-testid={`plan-cta-${p.name.toLowerCase()}`}>
                  {busy === p.id ? t('billing.redirecting') : t('pricing.subscribe')}
                </button>
              ) : (
                <button disabled
                  className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-400"
                  data-testid={`plan-cta-${p.name.toLowerCase()}`}>
                  {t('pricing.comingSoon')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-center text-2xl font-bold">{t('pricing.faqTitle')}</h2>
        <div className="mt-8 space-y-4">
          {FAQ_KEYS.map(([q, a]) => (
            <details key={q} className="card group p-5">
              <summary className="cursor-pointer list-none font-heading font-semibold marker:hidden">{t(q)}</summary>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="header-gradient mt-16 rounded-3xl px-8 py-12 text-center text-white">
        <h2 className="text-2xl font-bold">{t('pricing.ctaTitle')}</h2>
        <Link to={cta} className="mt-6 inline-flex rounded-xl bg-white px-6 py-3 font-semibold text-primary transition hover:-translate-y-0.5 hover:shadow-xl" data-testid="pricing-cta">
          {user ? t('pricing.goDashboard') : t('pricing.createAccount')}
        </Link>
      </section>
    </main>
  );
}
