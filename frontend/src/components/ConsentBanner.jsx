/* The cookie consent banner.
 *
 * Pairs with public/gtag-init.js, which denies every storage category until
 * this collects an answer. That file replays a stored "granted" on the next
 * visit, so this is shown once and then never again unless the visitor asks to
 * change it through the footer link.
 *
 * Three things about how it renders, each deliberate:
 *
 * 1. Nothing at all until after mount. The public pages are prerendered to
 *    static HTML, and a banner present at snapshot time would be baked into
 *    every page's markup — read by crawlers as part of the content, and shown
 *    for a frame to visitors who had already answered.
 *
 * 2. Fixed to the bottom, over the page rather than in the layout. A banner
 *    that takes up flow pushes the content down after hydration, which is a
 *    layout shift on every first visit and a Core Web Vitals problem.
 *
 * 3. Declining is a button, not an X or a hidden link. A banner whose only
 *    real option is "accept" does not collect consent in any sense that
 *    matters, and the whole point of this file is that the answer is real.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';

export const CONSENT_KEY = 'prepfrancais.consent';

/* Read once, defensively: localStorage throws, not merely returns null, in
   some privacy modes. An unreadable store means "no answer yet", which leaves
   the denied defaults standing — the safe direction to fail in. */
export function storedConsent() {
  try {
    return window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

/* Tell gtag what changed. Only analytics is ever granted: this site runs no
   advertising products, so the ad_* categories stay denied whatever the
   visitor says, and asking about them would be asking about something that
   does not happen. */
function applyConsent(answer) {
  try {
    window.localStorage.setItem(CONSENT_KEY, answer);
  } catch { /* the choice will be asked again next visit; nothing is stored */ }
  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', {
      analytics_storage: answer === 'granted' ? 'granted' : 'denied',
    });
  }
}

/* Lets the footer reopen the banner so a choice can be withdrawn — which is
   the half of consent that a one-time banner usually leaves out. */
export function reopenConsent() {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch { /* nothing stored to clear */ }
  window.dispatchEvent(new Event('prepfrancais:consent-reopen'));
}

export default function ConsentBanner() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // react-snap runs the real app in a headless browser, effects included, so
    // without this the banner is captured into the static HTML of every
    // prerendered page: crawlers read its text as page content, and every
    // visitor sees it for a frame before hydration decides they had already
    // answered. It identifies itself in the user agent; that is the only
    // signal available from inside the page.
    if (/ReactSnap/i.test(window.navigator.userAgent)) return undefined;
    if (!storedConsent()) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener('prepfrancais:consent-reopen', reopen);
    return () => window.removeEventListener('prepfrancais:consent-reopen', reopen);
  }, []);

  if (!open) return null;

  const answer = (value) => { applyConsent(value); setOpen(false); };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('consent.title')}
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-violet-100 bg-white/95 p-4 shadow-[0_-4px_24px_-8px_rgba(15,23,42,0.18)] backdrop-blur sm:p-5"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-bold text-gray-900">
            {t('consent.title')}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
            {t('consent.body')}{' '}
            <Link to="/privacy" className="font-semibold text-primary underline-offset-2 hover:underline">
              {t('consent.privacy')}
            </Link>
          </p>
        </div>
        {/* Equal weight, so neither answer is the easy one. */}
        <div className="flex shrink-0 gap-2.5">
          <button type="button" onClick={() => answer('denied')}
            data-testid="consent-decline"
            className="btn-outline !px-5 !py-2.5 text-sm">
            {t('consent.decline')}
          </button>
          <button type="button" onClick={() => answer('granted')}
            data-testid="consent-accept"
            className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-5 !py-2.5 text-sm">
            {t('consent.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
