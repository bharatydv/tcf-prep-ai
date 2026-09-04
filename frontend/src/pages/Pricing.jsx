import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { CheckoutBreakdown, useBillingPlans } from '../lib/plans';
import { usePrompt } from '../components/shared';
import { track } from '../lib/api';

const FEATURE_KEYS = ['pricing.feature1', 'pricing.feature2', 'pricing.feature3', 'pricing.feature4'];
const FAQ_KEYS = [
  ['pricing.faq1q', 'pricing.faq1a'],
  ['pricing.faq2q', 'pricing.faq2a'],
  ['pricing.faq3q', 'pricing.faq3a'],
  ['pricing.faq4q', 'pricing.faq4a'],
];

export default function Pricing() {
  const { user, refreshUser } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const { plans, currency, configured, loading } = useBillingPlans();
  const [busy, setBusy] = useState('');
  const [prompt, promptDialog] = usePrompt();

  // Reaching the pricing page is the step before checkout, and the gap
  // between the two is the most useful number in the funnel.
  useEffect(() => { track('pricing_view'); }, []);
  const cta = user ? '/dashboard' : '/register';

  /* Opens the mandate at Cashfree and hands the browser over to it. Nothing is
     granted here — the signed webhook does that — so there is no success path
     to fake if this call is tampered with. */
  /* The gateway will not open a mandate without a phone number, so the
     account needs one before checkout can proceed.
   *
   * Asked for here, at the moment of purchase, rather than at registration.
   * Only people who are actually buying are asked, nobody is stopped from
   * signing up and using the free trial over a field the trial never needs,
   * and everyone who registered before this existed can still buy. */
  const askForPhone = async () => {
    const phone = await prompt({
      title: t('billing.phoneTitle'),
      message: t('billing.phoneWhy'),
      placeholder: '+1 514 555 0123',
      type: 'tel',
      inputMode: 'tel',
      autoComplete: 'tel',
      confirmLabel: t('billing.phoneSave'),
    });
    if (!phone) return false;
    try {
      await api.post('/api/auth/phone/send', { phone });
      await refreshUser();
      return true;
    } catch (err) {
      toast.error(errMsg(err, t('billing.phoneFailed')));
      return false;
    }
  };

  /* Cashfree's checkout script, fetched once and only when someone actually
     buys. It is ~40 kB that a visitor reading the pricing table never needs,
     and loading it on mount would put a third-party script on the page for
     everyone to pay for a purchase most of them will not make. */
  const loadCashfree = () => new Promise((resolve, reject) => {
    if (window.Cashfree) return resolve(window.Cashfree);
    const el = document.createElement('script');
    el.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    el.async = true;
    el.onload = () => (window.Cashfree
      ? resolve(window.Cashfree)
      : reject(new Error('Cashfree SDK loaded without defining Cashfree')));
    el.onerror = () => reject(new Error('Cashfree SDK failed to load'));
    document.head.appendChild(el);
  });

  const startCheckout = async (planId) => {
    const { data } = await api.post('/api/billing/subscribe', { plan_id: planId });
    /* An order is not a link. Cashfree rejected this account for
       Subscriptions and for Payment Links, so checkout is the Orders API,
       which answers with a session id and no URL to send anyone to. The
       session is opened by their script instead. */
    if (!data?.session_id) {
      // Sending the learner nowhere silently is how "I paid and nothing
      // happened" reports start.
      toast.error(t('billing.noLink'));
      return false;
    }
    try {
      const Cashfree = await loadCashfree();
      const cashfree = Cashfree({ mode: 'production' });
      // _self, not a popup: a blocked popup is indistinguishable from a
      // broken checkout to the person looking at the screen.
      await cashfree.checkout({
        paymentSessionId: data.session_id,
        redirectTarget: '_self',
      });
      return true;
    } catch (err) {
      toast.error(t('billing.noLink'));
      return false;
    }
  };

  const subscribe = async (planId) => {
    if (!user) return navigate('/register');
    if (busy) return;
    setBusy(planId);
    track('checkout_start', { plan: planId });
    try {
      await startCheckout(planId);
    } catch (err) {
      // The server names the missing phone in a 400. Collect it and carry on
      // rather than making the learner find a settings page mid-purchase.
      const detail = String(err?.response?.data?.detail || '');
      const needsPhone = err?.response?.status === 400
        && /num\u00e9ro de t\u00e9l\u00e9phone|phone/i.test(detail);
      if (needsPhone && await askForPhone()) {
        try {
          await startCheckout(planId);
        } catch (retryErr) {
          toast.error(errMsg(retryErr, t('billing.failed')));
        }
      } else if (!needsPhone) {
        toast.error(errMsg(err, t('billing.failed')));
      }
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
      {promptDialog}
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
