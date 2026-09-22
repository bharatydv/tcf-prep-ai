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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, DownloadSimple, CheckCircle, FilePdf, CaretLeft, CaretRight, Lock, Check,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { CommunityInline } from './CommunityButton';
import { HAS_COMMUNITY } from '../lib/community';
import { useT } from '../i18n';
import LeadCaptureForm from './LeadCaptureForm';
import {
  alreadyCaptured, recentlyDismissed, rememberDismissed, rememberSource,
} from '../lib/leads';

/* The pages of the real file, as pictures — see backend/tools/lead_pdf_preview.py.
 *
 * It starts at page 2 because page 1 is the cover, and a cover proves nothing:
 * anybody can put a title on a page. Pages 2 to 4 are the tables of French
 * with English beside it, which is the entire argument for handing over a
 * phone number.
 *
 * The last one is page 5 with the blur baked into the file rather than
 * applied in CSS, so "the rest is locked" is true of what was sent and not
 * just of what is displayed. Everything from there to page 25 is behind the
 * form. */
const TOTAL_PAGES = 25;
const FIRST_LOCKED = 5;
const SLIDES = [
  { page: 2, src: '/tcf-vocabulary/page-2.webp' },
  { page: 3, src: '/tcf-vocabulary/page-3.webp' },
  { page: 4, src: '/tcf-vocabulary/page-4.webp' },
  { locked: true, src: '/tcf-vocabulary/blur-5.webp' },
];

export default function LeadMagnetModal() {
  const t = useT();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(null);      // { url, community }, once given
  const [slide, setSlide] = useState(0);
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

  const step = useCallback((by) => {
    setSlide((i) => (i + by + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    /* The arrow keys move the preview, because a carousel that can only be
       driven with the mouse is one most people never turn past the first
       page — and the first page is the least convincing one. */
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const current = SLIDES[slide];
  const caption = useMemo(() => (
    current.locked
      ? t('lead.locked', { from: FIRST_LOCKED, to: TOTAL_PAGES })
      : t('lead.page', { n: current.page, total: TOTAL_PAGES })
  ), [current, t]);

  if (!open) return null;

  const arrow = 'absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-violet-100 bg-white/95 text-primary shadow-md transition hover:bg-white disabled:opacity-40';

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
            <div>
              <div className="relative">
                <button type="button" onClick={() => step(-1)} aria-label={t('lead.prev')}
                  data-testid="lead-prev" className={`${arrow} left-2`}>
                  <CaretLeft size={15} weight="bold" />
                </button>

                {/* Every page is in the DOM at once so an arrow press is
                    instant rather than a spinner over a blank rectangle.
                    They are four small pictures, not the 3 MB file. */}
                <div className="relative aspect-[857/1109] max-h-[27vh] w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm sm:max-h-none">
                  {SLIDES.map((s, i) => (
                    <img key={s.src} src={s.src} alt=""
                      aria-hidden={i !== slide}
                      className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-200 ${i === slide ? 'opacity-100' : 'opacity-0'}`} />
                  ))}
                  {current.locked && (
                    <div className="absolute inset-0 grid place-items-center bg-white/45 px-4 text-center">
                      <div>
                        <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-primary text-white shadow-lg">
                          <Lock size={17} weight="fill" />
                        </span>
                        <p className="mt-2 font-heading text-[13px] font-black leading-snug text-gray-900">
                          {t('lead.lockedBody')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <button type="button" onClick={() => step(1)} aria-label={t('lead.next')}
                  data-testid="lead-next" className={`${arrow} right-2`}>
                  <CaretRight size={15} weight="bold" />
                </button>
              </div>

              <div className="mt-2 flex items-center justify-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500" data-testid="lead-caption">
                  {caption}
                </span>
                <span className="flex gap-1">
                  {SLIDES.map((s, i) => (
                    <i key={s.src}
                      className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-3.5 bg-primary' : 'w-1.5 bg-violet-200'}`} />
                  ))}
                </span>
              </div>
            </div>

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
