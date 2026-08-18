import { Link } from 'react-router-dom';
import { CheckCircle } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

const PLANS = [
  { name: 'Bronze', price: '$14.99', durationKey: 'pricing.duration5d', bonus: 3, grad: 'from-amber-700 to-amber-500', popular: false },
  { name: 'Silver', price: '$29.99', durationKey: 'pricing.duration1m', bonus: 8, grad: 'from-gray-500 to-gray-400', popular: true },
  { name: 'Gold', price: '$49.99', durationKey: 'pricing.duration2m', bonus: 15, grad: 'from-yellow-500 to-amber-400', popular: false },
];

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
  const cta = user ? '/dashboard' : '/register';

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <Seo titleKey="seo.pricing.title" descKey="seo.pricing.desc" path="/pricing" />
      <h1 className="text-center text-4xl font-bold">{t('pricing.title')}</h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
        {t('pricing.subtitle')}
      </p>

      {/* Selling a plan that cannot be bought sends people to a dead end at the
          exact moment they decide to pay. Say so before the cards, not in a
          collapsed FAQ item underneath them. */}
      <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center"
        data-testid="pricing-unavailable-notice">
        <p className="text-sm font-semibold text-amber-900">
          {t('pricing.noticeTitle')}
        </p>
        <p className="mt-1 text-sm text-amber-800">
          {t('pricing.noticeBody')}
        </p>
      </div>

      <div className="mt-12 grid items-center gap-6 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.name}
            className={`card relative overflow-hidden ${p.popular ? 'z-10 ring-4 ring-primary md:scale-110' : ''}`}
            data-testid={`plan-${p.name.toLowerCase()}`}>
            <div className="absolute -right-9 top-5 rotate-45 bg-gray-900 px-10 py-1 text-[10px] font-bold tracking-widest text-white">PACK</div>
            {p.popular && (
              <div className="bg-primary py-1.5 text-center text-xs font-bold tracking-wider text-white">{t('pricing.mostPopular')}</div>
            )}
            <div className={`bg-gradient-to-r ${p.grad} px-6 py-7 text-white`}>
              <h2 className="font-heading text-2xl font-bold">{p.name}</h2>
              <p className="mt-2"><span className="font-heading text-4xl font-bold">{p.price}</span><span className="text-white/80"> / {t(p.durationKey)}</span></p>
              <p className="mt-1 text-sm font-semibold text-white/90">+ {t('pricing.bonus', { n: p.bonus })}</p>
            </div>
            <ul className="space-y-3 p-6 text-sm">
              {FEATURE_KEYS.map((k) => (
                <li key={k} className="flex items-start gap-2">
                  <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-green-500" /> {t(k)}
                </li>
              ))}
            </ul>
            <div className="px-6 pb-6">
              <button disabled
                className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-400"
                data-testid={`plan-cta-${p.name.toLowerCase()}`}>
                {t('pricing.comingSoon')}
              </button>
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
