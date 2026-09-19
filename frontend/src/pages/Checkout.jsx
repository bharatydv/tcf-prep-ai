/* The last screen on this site before the gateway takes over.
 *
 * It exists because PayU's hosted page prints one "Total Payable" and nothing
 * else — no plan name, no itemised fee, none of this site's chrome. Arriving
 * there straight from a card that said 1,299 to be asked for 1,337.84 reads as
 * a bait and switch. So the order is confirmed here, under the same header and
 * footer as every other page, and the figure on the pay button is the figure
 * PayU will ask for.
 *
 * Nothing here decides what anyone pays. The plan id in the query string is
 * the only input, every amount is the server's own catalogue rendered back,
 * and the charge is recomputed server-side when the order is opened.
 */
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LockSimple, SpinnerGap } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { useBillingPlans, CheckoutBreakdown, formatPrice } from '../lib/plans';
import { useCheckout } from '../lib/checkout';

const FEATURE_KEYS = ['pricing.feature1', 'pricing.feature2', 'pricing.feature3', 'pricing.feature4'];

export default function Checkout() {
  const t = useT();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const planId = params.get('plan') || '';
  const { plans, currency, configured, loading } = useBillingPlans();
  const { subscribe, busy, promptDialog } = useCheckout();

  const plan = plans.find((p) => p.id === planId);

  // An unknown or missing plan is a mistyped link, not an error worth a page
  // of its own: the catalogue it should have named is one hop away.
  if (!loading && !plan) return <Navigate to="/pricing" replace />;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <Seo title="Checkout" description="Confirm your plan before paying." path="/checkout" noindex />

      <Link to="/pricing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 transition hover:text-primary">
        <ArrowLeft size={16} weight="bold" /> {t('checkout.back')}
      </Link>
      <h1 className="mt-4 font-heading text-3xl font-extrabold text-gray-900">{t('checkout.title')}</h1>

      {loading || !plan ? (
        <div className="mt-8 flex justify-center py-16" role="status" aria-live="polite">
          <SpinnerGap size={32} className="animate-spin text-primary" />
        </div>
      ) : (
        <div className="card mt-6 overflow-hidden" data-testid="checkout-card">
          <div className={`bg-gradient-to-r ${plan.grad} px-6 py-6 text-white`}>
            <p className="font-heading text-2xl font-extrabold">{plan.name}</p>
            <p className="mt-0.5 text-sm text-white/80">
              / {plan.durationKey ? t(plan.durationKey) : plan.name}
            </p>
          </div>

          <ul className="space-y-2.5 px-6 pt-6 text-sm text-gray-700">
            <li className="font-semibold text-primary">+ {t('pricing.bonus', { n: plan.bonus })}</li>
            {FEATURE_KEYS.map((k) => <li key={k}>{t(k)}</li>)}
          </ul>

          <CheckoutBreakdown plan={plan} currency={currency} />

          <div className="px-6 pb-6 pt-5">
            {!user ? (
              <>
                <p className="mb-3 text-sm text-gray-600">{t('checkout.accountFirst')}</p>
                <Link
                  to={`/register?plan=${encodeURIComponent(plan.id)}`}
                  className="btn-primary w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600"
                  data-testid="checkout-register">
                  {t('pricing.createAccount')}
                </Link>
                <Link to="/login" className="mt-3 block text-center text-sm font-semibold text-primary hover:underline">
                  {t('checkout.haveAccount')}
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={() => subscribe(plan.id)}
                disabled={!configured || Boolean(busy)}
                className="btn-primary w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60"
                data-testid="checkout-pay">
                {busy === plan.id
                  ? t('billing.redirecting')
                  : t('checkout.pay', { amount: formatPrice(plan.checkout?.total, currency) })}
              </button>
            )}

            <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-xs text-gray-500">
              <LockSimple size={14} weight="fill" className="mt-0.5 shrink-0" />
              {t('checkout.secure')}
            </p>
            <p className="mt-2 text-center text-xs text-gray-400">
              <Link to="/refund" className="underline-offset-2 hover:underline">{t('checkout.refunds')}</Link>
            </p>
          </div>
        </div>
      )}

      {promptDialog}
    </main>
  );
}
