/* The free vocabulary PDF, offered on the way out.
 *
 * Mounted once near the router, like Paywall: a visitor leaving the pricing
 * page is the same visitor leaving the blog, and no page should have to know
 * about a download offer to be able to make it.
 *
 * Three rules decide whether it is shown at all:
 *
 * 1. Signed out only. Somebody with an account has already given us their
 *    name, address and number — asking again in a popup would be asking twice
 *    for what we have, so for them the file is simply a link.
 *
 * 2. Not again for a day after it was closed, and never again after it was
 *    answered. A visitor who closed it said no, and showing it again on the
 *    next page is how an offer turns into an irritation — but "no" today is
 *    not "no" tomorrow, and a returning visitor who is leaving again is
 *    somebody the offer is for. Giving the number, on the other hand, is
 *    answered for good: the file is theirs, and asking twice for what we
 *    have is asking twice.
 *
 * 3. Never while prerendering. react-snap runs the real app, effects
 *    included, so anything open at snapshot time is baked into the static
 *    HTML of every page — read by crawlers as page content, and shown for a
 *    frame to everyone.
 *
 * On the trigger, which is the only one: the pointer leaving through the top
 * edge of the viewport, where the tab bar, the address bar and the close
 * button are. A browser cannot show its own dialog during `beforeunload`, so
 * "about to change tab or close the window" has to be read from the pointer
 * on its way there.
 *
 * There used to be a second trigger — a dwell timer, on touch screens, which
 * have no pointer to leave. It is gone. Somebody who has been reading for
 * forty-five seconds is not leaving, they are reading, and a dialog over what
 * they are reading is an interruption rather than an offer. The consequence
 * is deliberate and worth stating: on a phone this never appears at all. The
 * guide has its own page now, which is where somebody who wants it goes.
 *
 * On the shape of it: two columns, and never a scrollbar. Whoever is reading
 * this was already leaving, so anything below the fold of the dialog is
 * something they will not see — a form they have to scroll to reach is a form
 * they do not fill in. The preview and the ask therefore sit side by side on
 * a desktop and stack short on a phone, and the whole panel is sized to fit
 * inside the viewport rather than to scroll inside it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, DownloadSimple, CheckCircle, FilePdf, Check,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { CommunityInline } from './CommunityButton';
import { HAS_COMMUNITY } from '../lib/community';
import { useT } from '../i18n';
import LeadCaptureForm from './LeadCaptureForm';
import PdfPreview from './PdfPreview';
import {
  alreadyCaptured, recentlyDismissed, rememberDismissed, rememberSource,
} from '../lib/leads';

export default function LeadMagnetModal() {
  const t = useT();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(null);      // { url, community }, once given
  /* Read by the listeners, which are registered once and must not be torn
     down and rebuilt every time a field is typed into. */
  const openRef = useRef(false);
  openRef.current = open;

  const show = useCallback((source) => {
    if (openRef.current) return;
    rememberSource(source);
    setOpen(true);
    /* Counted as shown the moment it is shown, not when it is answered: a
       visitor who closes the tab over the dialog has still seen the offer. */
    rememberDismissed();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (/ReactSnap/i.test(window.navigator.userAgent)) return undefined;

    // `loading` is the session still settling: without it a signed-in visitor
    // is offered the form for the second /auth/me takes to answer.
    if (loading || user || alreadyCaptured() || recentlyDismissed()) {
      return undefined;
    }

    // `relatedTarget` is null only when the pointer has left the document
    // entirely — without that check, every hover over an iframe or a native
    // select fires this. `buttons` rules out a drag.
    const onOut = (e) => {
      if (e.clientY > 0 || e.relatedTarget || e.buttons) return;
      show('exit_intent');
    };
    document.addEventListener('mouseout', onOut);
    return () => document.removeEventListener('mouseout', onOut);
  }, [loading, user, show]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/70 p-3 backdrop-blur-sm sm:p-4"
      role="dialog" aria-modal="true" aria-label={t('lead.title')}>
      {/* max-h with the body laid out inside it, and no overflow-y anywhere:
          if something ever does not fit, the fix is to cut it rather than to
          hand the visitor a scrollbar. */}
      <div className="flex max-h-[96vh] w-full max-w-[44rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-4 py-3 text-white sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/20">
            <FilePdf size={19} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.08em] text-white/80">
              {t('lead.eyebrow')}
            </p>
            <p className="font-heading text-[15px] font-bold leading-tight sm:text-lg">{t('lead.title')}</p>
            <p className="text-[11px] text-white/85">{t('lead.badge')}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('lead.close')}
            data-testid="lead-close"
            className="shrink-0 rounded-lg p-1 text-white/80 transition hover:bg-white/20 hover:text-white">
            <X size={18} weight="bold" />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-6 text-center">
            <CheckCircle size={36} weight="fill" className="mx-auto text-emerald-500" />
            <p className="mt-2 font-heading text-base font-bold text-gray-900">{t('lead.doneTitle')}</p>
            <p className="mt-1 text-[13px] leading-snug text-gray-600">{t('lead.doneBody')}</p>
            {/* The click above can be blocked by a download setting, so the
                link is on the page too rather than only in the code. */}
            <a href={done.url} download
              className="btn-primary mt-3 inline-flex items-center gap-2 !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-5 !py-2.5 text-sm">
              <DownloadSimple size={16} weight="bold" /> {t('lead.doneCta')}
            </a>
            {/* Offered once per number. Somebody whose phone is already in the
                group is told so and left alone, rather than handed a second
                invitation to a room they are standing in. */}
            {HAS_COMMUNITY && (done.community ? (
              <CommunityInline from="lead" className="mx-auto mt-5 max-w-sm" />
            ) : (
              <p className="mt-5 text-xs font-semibold text-gray-500">{t('lead.doneMember')}</p>
            ))}
            <button type="button" onClick={() => setOpen(false)}
              className="mt-4 block w-full text-xs font-semibold text-gray-500 hover:text-primary">
              {t('lead.doneClose')}
            </button>
          </div>
        ) : (
          <div className="grid gap-3 overflow-y-auto px-4 py-3 sm:grid-cols-[17rem_1fr] sm:gap-5 sm:overflow-visible sm:px-5 sm:py-5">

            {/* ---- what is in the file ---------------------------------- */}
            <PdfPreview keys compact />

            {/* ---- the ask ---------------------------------------------- */}
            <div className="flex flex-col">
              <p className="font-heading text-sm font-black text-gray-900">{t('lead.formTitle')}</p>

              {/* Hidden on a phone, where the space it would take is the
                  space the form needs to stay above the fold. The preview
                  makes the same argument, and makes it better. */}
              <ul className="mt-2 hidden space-y-1 sm:block">
                {['lead.b1', 'lead.b2', 'lead.b3'].map((k) => (
                  <li key={k} className="flex items-start gap-1.5 text-[12px] leading-snug text-gray-600">
                    <Check size={13} weight="bold" className="mt-0.5 shrink-0 text-primary" />
                    {t(k)}
                  </li>
                ))}
              </ul>

              <LeadCaptureForm className="mt-3" onDone={setDone} />

              <p className="mt-2 text-[10px] leading-snug text-gray-400">
                {t('lead.privacy')}{' '}
                <Link to="/privacy" className="font-semibold text-gray-500 underline-offset-2 hover:text-primary hover:underline">
                  {t('consent.privacy')}
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
