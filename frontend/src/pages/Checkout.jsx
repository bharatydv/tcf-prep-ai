/* The order summary, on our own page, before the gateway's.
 *
 * Clicking a plan used to hand the learner straight to PayU's hosted page:
 * a green "P" tile, a "Total Payable" they had not seen before, and nothing
 * saying whose site they were on. The one screen where somebody decides to
 * part with money was the only screen that did not look like prepfrancais.
 *
 * This page is the step in between. The site header and wordmark are above
 * it, the price is broken into the same three lines the server itemises, and
 * Back and Close both lead somewhere sensible. The gateway's own page still
 * follows this one and still looks like the gateway — nothing here can
 * restyle a page served from secure.payu.in.
 *
 * It computes nothing. Every figure comes from GET /api/billing/plans, which
 * is also what the server charges; a total the browser worked out for itself
 * is a total the browser can be wrong about.
 */
import { useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { X, LockSimple, ShieldCheck } from '@phosphor-icons/react';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { useBillingPlans, formatPrice } from '../lib/plans';
import { useCheckout } from '../lib/checkout';
import { BackLink } from '../components/shared';

/* The merchant tile, the way the gateway's page shows one — except it is our
   wordmark rather than a letter in a coloured square. The header carries the
   same mark; repeating it here keeps it beside the amount, which is where a
   buyer looks to check who is being paid. */
function Wordmark() {
  return (
    <span aria-hidden="true"
      className="select-none font-heading text-xl font-extrabold leading-none tracking-tight">
      <span style={{ color: '#7F3BE7' }}>prep</span>
      <span style={{ color: '#211C2B' }}>fran</span>
      <span style={{ color: '#E8179B' }}>c</span>
      <span style={{ color: '#211C2B' }}>ais</span>
    </span>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className={strong ? 'font-heading text-base font-bold text-gray-900' : 'text-gray-600'}>
        {label}
      </dt>
      <dd className={strong
        ? 'font-heading text-xl font-extrabold tabular-nums text-primary'
        : 'font-semibold tabular-nums text-gray-900'}>
        {value}
      </dd>
    </div>
  );
}

export default function Checkout() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { plans, currency, configured, loading } = useBillingPlans();
  const { subscribe, busy, promptDialog } = useCheckout();

  const plan = plans.find((p) => p.id === planId);

  /* A plan id nobody sells — a stale bookmark, or a link from before a plan
     was renamed — must not render an empty card with a Pay button under it. */
  useEffect(() => {
    if (!loading && !plan) navigate('/pricing', { replace: true });
  }, [loading, plan, navigate]);

  if (!plan) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center text-gray-500">
        {t('checkout.loading')}
      </main>
    );
  }

  const c = plan.checkout || {};
  const total = c.total ?? plan.amount;

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <Seo titleKey="checkout.title" descKey="pricing.subtitle" path={`/checkout/${plan.id}`} noindex />

      {/* Back returns to wherever they came from, Close leaves checkout
          altogether. Two different intentions, so two different controls —
          a single X that sometimes means "go back" is how people lose the
          plan they had picked. */}
      <div className="mb-1 flex items-center justify-between">
        <BackLink fallback="/pricing" className="!mb-0" />
        <button type="button" onClick={() => navigate('/pricing')}
          data-testid="checkout-close" aria-label={t('checkout.close')}
          className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
          <X size={20} weight="bold" />
        </button>
      </div>

      <h1 className="font-heading text-2xl font-extrabold text-gray-900">{t('checkout.title')}</h1>

      <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {/* Who is being paid, and for what. */}
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 bg-gray-50 px-6 py-4">
          <Link to="/" className="flex items-center" aria-label="prepfrancais">
            <Wordmark />
          </Link>
          <span className="pill bg-violet-100 text-primary">{plan.name}</span>
        </div>

        <dl className="divide-y divide-gray-100 px-6 py-3 text-sm">
          <Row label={t('pricing.planPrice')}
            value={formatPrice(c.base_amount ?? plan.amount, currency)} />
          {/* Rendered even at zero. On the gateway's page the fee is folded
              silently into one "Total Payable"; the point of this page is
              that the number is explained before anyone is asked to pay it. */}
          <Row label={t('pricing.processingFee', { pct: c.fee_percent ?? 0 })}
            value={formatPrice(c.fee_amount ?? 0, currency)} />
          {Boolean(c.tax_amount) && (
            <Row label={`${c.tax_label} (${c.tax_percent}%)`}
              value={formatPrice(c.tax_amount, currency)} />
          )}
          <Row label={t('pricing.total')} value={formatPrice(total, currency)} strong />
        </dl>

        <div className="border-t border-gray-100 px-6 py-5">
          <button type="button" data-testid={`pay-${plan.id}`}
            onClick={() => subscribe(plan.id)} disabled={Boolean(busy) || !configured}
            className="btn-primary w-full justify-center !py-3 text-base">
            <LockSimple size={18} weight="fill" />
            {busy ? t('billing.redirecting') : t('checkout.pay', {
              amount: formatPrice(total, currency),
            })}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-500">
            <ShieldCheck size={15} weight="fill" className="text-green-600" />
            {t('checkout.secure')}
          </p>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">{t('checkout.note')}</p>
      {promptDialog}
    </main>
  );
}
