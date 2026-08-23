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

/* Rendered until the catalogue loads, and if the request fails outright — a
   pricing page with three empty cards is worse than one showing last known
   prices. `configured` stays false for these, so nothing is buyable from them. */
export const PLANS = [
  { id: 'week', name: '1 Week', amount: 20, first_amount: 15, price: '$15', wasPrice: '$20', bonus: 3, ...PLAN_STYLE.week },
  { id: 'month', name: '1 Month', amount: 80, first_amount: 60, price: '$60', wasPrice: '$80', bonus: 8, ...PLAN_STYLE.month },
  { id: 'quarter', name: '3 Months', amount: 220, first_amount: 165, price: '$165', wasPrice: '$220', bonus: 15, ...PLAN_STYLE.quarter },
];

/* The live catalogue.
 *
 * `configured` is false when the server has no Cashfree credentials, which is
 * what decides whether the buttons do anything. `firstTime` defaults to true:
 * a signed-out visitor has by definition never paid, so showing them the
 * introductory price is both the truthful number and the useful one. */
export function useBillingPlans() {
  const [state, setState] = useState({
    plans: PLANS, currency: 'USD', configured: false, firstTime: true, loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Eligibility needs a session; a signed-out visitor 401s here and keeps
      // the introductory price, which is correct for them.
      const eligible = await api.get('/api/billing/subscription')
        .then(({ data }) => data.first_time_eligible !== false)
        .catch(() => true);

      try {
        const { data } = await api.get('/api/billing/plans');
        if (cancelled) return;
        const currency = data.currency || 'USD';
        const plans = (data.plans || []).map((p) => {
          const discounted = eligible && p.first_amount != null
            && p.first_amount < p.amount;
          return {
            ...p,
            ...(PLAN_STYLE[p.id] || {}),
            price: formatPrice(discounted ? p.first_amount : p.amount, currency),
            // Only set when there is a real saving to show, so the card never
            // strikes through a price identical to the one beside it.
            wasPrice: discounted ? formatPrice(p.amount, currency) : null,
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
