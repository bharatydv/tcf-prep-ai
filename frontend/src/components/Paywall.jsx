/* The end of the free trial, shown as a plan chooser rather than an error.
 *
 * Mounted once, near the router. Every 402 the API returns is announced on the
 * window by lib/api.js, so no page has to catch it, translate it, or decide
 * what to do about it — and nothing navigates away, because the learner is
 * usually standing in a half-written essay when this fires.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Lock, CheckCircle } from '@phosphor-icons/react';
import { PAYWALL_EVENT } from '../lib/api';
import { useBillingPlans } from '../lib/plans';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

// Which allowance ran out decides the headline. The server also sends a French
// sentence, which is the fallback when a new kind appears before its copy does.
const TITLE_KEY = {
  writing: 'pay.titleWriting',
  speaking: 'pay.titleSpeaking',
  speaking_tache2: 'pay.titleTache2',
  conversation: 'pay.titleConversation',
};

export default function Paywall() {
  const t = useT();
  const { user } = useAuth();
  const { plans, configured } = useBillingPlans();
  const [block, setBlock] = useState(null);

  useEffect(() => {
    const onBlock = (e) => setBlock(e.detail || null);
    window.addEventListener(PAYWALL_EVENT, onBlock);
    return () => window.removeEventListener(PAYWALL_EVENT, onBlock);
  }, []);

  useEffect(() => {
    if (!block) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setBlock(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [block]);

  if (!block) return null;

  // The 402 carries a fresh count; the cached user object is a fallback for it.
  const trial = block.trial || user?.trial || null;
  const line = (key) => (trial?.[key]
    ? `${Math.min(trial[key].used, trial[key].limit)}/${trial[key].limit}` : null);
  const title = t(TITLE_KEY[block.kind] || 'pay.title');
  const close = () => setBlock(null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-6 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Lock size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-bold leading-snug">{title}</p>
            <p className="text-[11px] text-white/80">{t('pay.kept')}</p>
          </div>
          <button onClick={close} aria-label={t('pay.close')}
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white">
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {trial && (
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
              {['writing', 'speaking', 'speaking_tache2'].map((key) => (
                line(key) && (
                  <span key={key} className="pill bg-violet-50 text-primary">
                    {t(`pay.used.${key}`)} {line(key)}
                  </span>
                )
              ))}
            </div>
          )}

          <p className="mt-4 text-sm leading-relaxed text-gray-600">{t('pay.body')}</p>

          <div className="mt-4 space-y-2">
            {plans.map((plan) => (
              <div key={plan.name}
                className="flex items-center gap-3 rounded-2xl border border-violet-100 px-4 py-3">
                <span className={`h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br ${plan.grad}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-sm font-bold text-gray-900">{plan.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {t(plan.durationKey)} · {t('pricing.bonus', { n: plan.bonus })}
                  </p>
                </div>
                <span className="shrink-0 text-right">
                  {plan.wasPrice && (
                    <span className="mr-1.5 text-[11px] text-gray-400 line-through">{plan.wasPrice}</span>
                  )}
                  <span className="font-heading text-sm font-extrabold text-gray-900">{plan.price}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Only while payment really is closed — once Cashfree is configured
              this line would be a lie sitting above a working buy button. */}
          {!configured && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
              <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-primary" />
              {t('pay.notLive')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row-reverse">
          <Link to="/pricing" onClick={close}
            className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
            {t('pay.seePlans')}
          </Link>
          <button onClick={close} className="btn-outline flex-1 justify-center">
            {t('pay.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
