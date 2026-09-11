/* Buying a plan, from wherever the learner asked to buy it.
 *
 * This used to live inside Pricing.jsx, which meant the only way to reach a
 * checkout was to be on /pricing. The landing page's plan cards therefore
 * linked to /pricing instead of selling anything — a click that said "I want
 * the monthly plan" was answered with a page asking which plan they wanted.
 * Lifting it here lets any surface open the real checkout with one call.
 *
 * Nothing here grants anything. The server opens an order at the gateway, the
 * learner pays there, and the signed webhook is what turns premium on — so
 * there is no success path in this file to fake if a response is tampered
 * with. What it returns is only ever "the checkout opened" or "it did not".
 *
 * Usage:
 *   const { subscribe, busy, promptDialog } = useCheckout();
 *   <button disabled={busy === p.id} onClick={() => subscribe(p.id)}>…</button>
 *   {promptDialog}        // required: the phone prompt renders through it
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg, track } from './api';
import { pathForLocale } from './locale';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { usePrompt } from '../components/shared';

/* The gateway's checkout script, fetched once and only when someone actually
   buys. It is tens of kilobytes that a visitor reading a pricing table never
   needs, and loading it on mount would put a third-party script on the page
   for everyone to pay for a purchase most of them will not make.

   Which script is loaded is decided by the server's reply, not by a build
   flag: PAYMENT_PROVIDER lives in the backend environment, and a browser
   bundle that had to be rebuilt to follow it would turn a config switch back
   into a deploy. */
function loadGatewayScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) return resolve(window[globalName]);
    // A second click while the first load is still in flight must wait for
    // that load, not append another copy of the script.
    const existing = document.querySelector(`script[data-gateway="${globalName}"]`);
    const el = existing || document.createElement('script');
    el.addEventListener('load', () => (window[globalName]
      ? resolve(window[globalName])
      : reject(new Error(`${globalName} script loaded without defining it`))));
    el.addEventListener('error', () => reject(new Error(`${globalName} script failed to load`)));
    if (!existing) {
      el.src = src;
      el.async = true;
      el.dataset.gateway = globalName;
      document.head.appendChild(el);
    }
    return undefined;
  });
}

export function useCheckout() {
  const { user, refreshUser } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [prompt, promptDialog] = usePrompt();

  /* Cashfree will not open an order without a phone number, so the account
     needs one before checkout can proceed there. Razorpay does not ask for
     one, and the server does not demand it when Razorpay is the gateway — so
     this runs only when the server actually says it is missing, which is why
     it is driven by the 400 below rather than by a check on the user object.

     Asked for at the moment of purchase rather than at registration. Only
     people who are actually buying are asked, nobody is stopped from signing
     up and using the free trial over a field the trial never needs, and
     everyone who registered before this existed can still buy. */
  const askForPhone = useCallback(async () => {
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
  }, [prompt, refreshUser, t]);

  /* Razorpay's modal. It resolves when the learner is done with it, one way or
     another, so the button stays busy for exactly as long as the modal is up.

     The handler does NOT mean premium is on. Razorpay calls it as soon as the
     payment is taken, and the signed webhook is what grants access, so all it
     does is move the browser to the page that waits for that webhook. */
  const payWithRazorpay = useCallback((checkout, subId) => new Promise((resolve) => {
    loadGatewayScript('https://checkout.razorpay.com/v1/checkout.js', 'Razorpay')
      .then((Razorpay) => {
        const rzp = new Razorpay({
          key: checkout.key_id,
          order_id: checkout.order_id,
          amount: checkout.amount,
          currency: checkout.currency,
          name: checkout.name,
          description: checkout.description,
          prefill: checkout.prefill,
          notes: checkout.notes,
          theme: { color: '#7C3AED' },
          handler: () => {
            // Locale-aware: a French buyer must not be dropped onto the
            // English confirmation page mid-purchase.
            window.location.assign(
              `${pathForLocale(lang, '/billing/return')}?sub=${encodeURIComponent(subId)}`);
            resolve(true);
          },
          modal: {
            // Closing the modal is not a failure worth a red toast — the
            // learner chose to. Reporting it as an error is how people learn
            // to ignore the errors that do matter.
            ondismiss: () => resolve(false),
          },
        });
        // A declined card is the one failure the webhook will never tell the
        // learner about, because no payment was taken to notify us of.
        rzp.on('payment.failed', (resp) => {
          toast.error(resp?.error?.description || t('billing.failed'));
        });
        rzp.open();
      })
      .catch(() => { toast.error(t('billing.noLink')); resolve(false); });
  }), [lang, t]);

  /* Cashfree's redirect. An order is not a link: Cashfree rejected this
     account for Subscriptions and for Payment Links, so checkout is the Orders
     API, which answers with a session id and no URL to send anyone to. The
     session is opened by their script instead. */
  const payWithCashfree = useCallback(async (sessionId) => {
    try {
      const Cashfree = await loadGatewayScript(
        'https://sdk.cashfree.com/js/v3/cashfree.js', 'Cashfree');
      const cashfree = Cashfree({ mode: 'production' });
      // _self, not a popup: a blocked popup is indistinguishable from a
      // broken checkout to the person looking at the screen.
      await cashfree.checkout({
        paymentSessionId: sessionId,
        redirectTarget: '_self',
      });
      return true;
    } catch {
      toast.error(t('billing.noLink'));
      return false;
    }
  }, [t]);

  const startCheckout = useCallback(async (planId) => {
    const { data } = await api.post('/api/billing/subscribe', { plan_id: planId });
    if (data?.provider === 'razorpay') {
      if (!data?.checkout?.order_id || !data?.checkout?.key_id) {
        // Sending the learner nowhere silently is how "I paid and nothing
        // happened" reports start.
        toast.error(t('billing.noLink'));
        return false;
      }
      return payWithRazorpay(data.checkout, data.subscription_id);
    }
    if (!data?.session_id) {
      toast.error(t('billing.noLink'));
      return false;
    }
    return payWithCashfree(data.session_id);
  }, [payWithCashfree, payWithRazorpay, t]);

  /* The one entry point. Safe to call from any surface: it handles the
     signed-out case, the missing-phone case and the busy case itself, so a
     caller is a button and nothing more. */
  const subscribe = useCallback(async (planId) => {
    if (!user) {
      // Purchase intent is worth keeping across the signup: the plan comes
      // back as a query param so the account lands ready to buy it.
      navigate(`/register?plan=${encodeURIComponent(planId)}`);
      return false;
    }
    if (busy) return false;
    setBusy(planId);
    track('checkout_start', { plan: planId });
    try {
      return await startCheckout(planId);
    } catch (err) {
      // The server names the missing phone in a 400. Collect it and carry on
      // rather than making the learner find a settings page mid-purchase.
      const detail = String(err?.response?.data?.detail || '');
      const needsPhone = err?.response?.status === 400
        && /numéro de téléphone|phone/i.test(detail);
      if (needsPhone && await askForPhone()) {
        try {
          return await startCheckout(planId);
        } catch (retryErr) {
          toast.error(errMsg(retryErr, t('billing.failed')));
        }
      } else if (!needsPhone) {
        toast.error(errMsg(err, t('billing.failed')));
      }
      return false;
    } finally {
      setBusy('');
    }
  }, [askForPhone, busy, navigate, startCheckout, t, user]);

  return { subscribe, busy, promptDialog };
}

export default useCheckout;
