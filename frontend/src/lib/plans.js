/* The subscription plans.
 *
 * Prices, the currency and the plan ids come from GET /api/billing/plans, and
 * whether this account still qualifies for the introductory rate comes from
 * GET /api/billing/subscription. They used to be literals in this file, which
 * meant the amount a learner was charged originated in the browser — the one
 * place an attacker can edit it. What stays here is presentation only: the
 * gradient, which card is flagged popular, and which duration string to show.
 *
 * Nothing here decides what anyone pays. The price shown is advisory; the
 * server recomputes it at checkout from its own catalogue and its own record
 * of whether the account has ever paid.
 *
 * Both the pricing page and the paywall render these. Keeping the list inside
 * Pricing.jsx would have been enough for the page, but the paywall is mounted
 * in the app shell — importing it from there would have pulled the whole
 * lazy-loaded pricing page into the main bundle to read three prices.
 */
import { useEffect, useState } from 'react';
import { api } from './api';
import { useT } from '../i18n';

export const PLAN_STYLE = {
  week: { grad: 'from-amber-700 to-amber-500', durationKey: 'pricing.duration1w', popular: false },
  month: { grad: 'from-gray-500 to-gray-400', durationKey: 'pricing.duration1m', popular: true },
  quarter: { grad: 'from-yellow-500 to-amber-400', durationKey: 'pricing.duration3m', popular: false },
};

export function formatPrice(amount, currency = 'USD') {
  if (amount == null) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // An unknown currency code must not blank the price out.
    return `${amount} ${currency}`;
  }
}

/* What the customer will be charged, itemised, rendered above the pay
 * button rather than after it.
 *
 * Every figure comes from the server, which is the only thing that decides
 * what is charged; this adds nothing up. When no fee is configured it renders
 * nothing at all, because a "fee: $0.00" line discloses nothing and a total
 * identical to the price above it is just noise. */
export function CheckoutBreakdown({ plan, currency = 'USD', className = '' }) {
  const t = useT();
  const c = plan?.checkout;
  if (!c || !c.fee_amount) return null;
  const line = (label, value, key) => (
    <div key={key} className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  );
  return (
    <dl className={`space-y-1.5 px-6 pt-5 text-[13px] ${className}`}
      data-testid={`checkout-${plan.id}`}>
      {line(t('pricing.planPrice'), formatPrice(c.base_amount, currency), 'base')}
      {line(t('pricing.processingFee', { pct: c.fee_percent }),
            formatPrice(c.fee_amount, currency), 'fee')}
      {Boolean(c.tax_amount) && line(
        `${c.tax_label} (${c.tax_percent}%)`,
        formatPrice(c.tax_amount, currency), 'tax')}
      <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
        <dt className="font-heading text-sm font-bold text-gray-900">{t('pricing.total')}</dt>
        <dd className="font-heading text-base font-extrabold tabular-nums text-primary"
          data-testid={`checkout-total-${plan.id}`}>
          {formatPrice(c.total, currency)}
        </dd>
      </div>
    </dl>
  );
}

/* The gateway's cut, added to what the customer pays. Only ever used for
   the fallback cards below: every live figure is computed on the server and
   served with the catalogue, because the amount actually charged must not be
   something the browser worked out for itself. */
export const FALLBACK_FEE_PERCENT = 2.99;

export function feeBreakdown(base, feePercent = FALLBACK_FEE_PERCENT) {
  const cents = (n) => Math.round(n * 100) / 100;
  const fee = cents((base * feePercent) / 100);
  return {
    base_amount: cents(base), fee_percent: feePercent, fee_amount: fee,
    tax_percent: 0, tax_amount: 0, tax_label: 'Tax', total: cents(base + fee),
  };
}

/* Rendered until the catalogue loads, and if the request fails outright — a
   pricing page with three empty cards is worse than one showing last known
   prices. `configured` stays false for these, so nothing is buyable from them. */
export const PLANS = [
  { id: 'week', name: '1 Week', amount: 20, first_amount: 15, price: '$15', wasPrice: '$20', bonus: 3, checkout: feeBreakdown(15), ...PLAN_STYLE.week },
  { id: 'month', name: '1 Month', amount: 80, first_amount: 60, price: '$60', wasPrice: '$80', bonus: 8, checkout: feeBreakdown(60), ...PLAN_STYLE.month },
  { id: 'quarter', name: '3 Months', amount: 220, first_amount: 160, price: '$160', wasPrice: '$220', bonus: 15, checkout: feeBreakdown(160), ...PLAN_STYLE.quarter },
];

/* The live catalogue.
 *
 * `configured` is false when the server has no Cashfree credentials, which is
 * what decides whether the buttons do anything. `firstTime` defaults to true:
 * a signed-out visitor has by definition never paid, so showing them the
 * introductory price is both the truthful number and the useful one. */
/* Two components mounting together asked for the catalogue twice, and each
 * ask is two requests: eligibility, then the plans. The landing page renders
 * plan cards while the paywall sits mounted in the app shell, so one view cost
 * four calls for one answer.
 *
 * Only the in-flight promise is shared, never a settled result. Caching the
 * answer would be the obvious next step and would be wrong: whether this
 * account still qualifies for the introductory price changes the moment
 * somebody signs in, and a stale cache would quote a price the server will not
 * honour. Sharing the request in flight removes the duplication with no window
 * in which a stale price can be shown. */
let inFlight = null;

function loadCatalogue() {
  if (!inFlight) {
    inFlight = fetchCatalogue().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function fetchCatalogue() {
  // Eligibility needs a session; a signed-out visitor 401s here and keeps
  // the introductory price, which is correct for them.
  const eligible = await api.get('/api/billing/subscription')
    .then(({ data }) => data.first_time_eligible !== false)
    .catch(() => true);
  const { data } = await api.get('/api/billing/plans');
  return { data, eligible };
}

export function useBillingPlans() {
  const [state, setState] = useState({
    plans: PLANS, currency: 'USD', configured: false, firstTime: true, loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let eligible = true;
      try {
        const loaded = await loadCatalogue();
        const { data } = loaded;
        eligible = loaded.eligible;
        if (cancelled) return;
        const currency = data.currency || 'USD';
        const plans = (data.plans || []).map((p) => {
          const discounted = eligible && p.first_amount != null
            && p.first_amount < p.amount;
          // The server itemises both prices; take whichever this account is
          // being offered. Nothing here adds the fee up — a total the browser
          // computes is a total the browser can be wrong about.
          const checkout = (discounted ? p.first_checkout : p.checkout)
            || feeBreakdown(discounted ? p.first_amount : p.amount,
                            data.fee_percent ?? FALLBACK_FEE_PERCENT);
          return {
            ...p,
            ...(PLAN_STYLE[p.id] || {}),
            price: formatPrice(discounted ? p.first_amount : p.amount, currency),
            // Only set when there is a real saving to show, so the card never
            // strikes through a price identical to the one beside it.
            wasPrice: discounted ? formatPrice(p.amount, currency) : null,
            checkout,
          };
        });
        setState({
          plans: plans.length ? plans : PLANS,
          currency,
          configured: Boolean(data.configured),
          firstTime: eligible,
          loading: false,
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, firstTime: eligible, loading: false }));
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
