/* The floating "join the group" button.
 *
 * Pinned to the bottom-right of every page rather than dropped into one
 * section, because a community link only works if it is in reach at the moment
 * someone decides they want help — which is while they are stuck on a tâche,
 * not while they are reading the footer.
 *
 * Three things it deliberately does NOT do:
 *
 * 1. It never renders when no invite URL is configured (lib/community.js). The
 *    feature ships dark and lights up when the groups exist.
 *
 * 2. It stays out of the way of the cookie banner. That banner is fixed to the
 *    full width of the bottom edge at z-50, so a button in the same corner
 *    would sit underneath it — visible on top of nothing, or covering the
 *    Decline control. Two overlays competing on a first visit is also just
 *    bad manners, so this waits until consent has been answered.
 *
 * 3. It is not captured into the prerendered HTML. react-snap runs the real
 *    app in a headless browser, so anything rendered at snapshot time is baked
 *    into all 37 static pages — which would put "Join our WhatsApp group" into
 *    the indexable text of every one of them. Same guard, and same reason, as
 *    ConsentBanner.
 *
 * With one group configured it is a plain link. The expanding panel only
 * appears when there are two, because a menu holding a single item is a tap
 * that buys the visitor nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatsCircle, TelegramLogo, WhatsappLogo, X } from '@phosphor-icons/react';
import { COMMUNITY_LINKS, HAS_COMMUNITY } from '../lib/community';
import { storedConsent } from './ConsentBanner';
import { track } from '../lib/api';
import { useT } from '../i18n';

const ICONS = { whatsapp: WhatsappLogo, telegram: TelegramLogo };
/* Each group's own colour, so the two are told apart at a glance rather than
   by reading them. */
const TONES = {
  whatsapp: 'bg-[#25D366] hover:brightness-105',
  telegram: 'bg-[#229ED9] hover:brightness-105',
};

/* The same links, in the flow of a page instead of floating over it.
 *
 * Shares ICONS and TONES with the button above so the two never drift into
 * different greens. `from` is carried into the click event, which is what
 * makes it possible to tell later whether the floating button or the moment
 * after signing up is what actually gets people into the groups.
 *
 * Renders nothing when no group is configured, so a caller can drop it in
 * unconditionally. Not gated on consent: this one sits in the page, owns its
 * own space, and covers nothing.
 */
export function CommunityInline({ from, className = '' }) {
  const t = useT();
  if (!HAS_COMMUNITY) return null;
  return (
    <div className={className}>
      <p className="text-xs font-semibold leading-relaxed text-gray-500">
        {t('community.blurb')}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {COMMUNITY_LINKS.map((link) => {
          const Icon = ICONS[link.id] || ChatsCircle;
          return (
            <a
              key={link.id}
              href={link.url} target="_blank" rel="noopener noreferrer"
              onClick={() => track('community_click', { id: link.id, from })}
              data-testid={`community-${from}-${link.id}`}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white transition ${TONES[link.id] || 'bg-primary'}`}
            >
              <Icon size={19} weight="fill" />
              {t(link.labelKey)}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function CommunityButton() {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!HAS_COMMUNITY) return undefined;
    if (/ReactSnap/i.test(window.navigator.userAgent)) return undefined;
    const sync = () => setReady(Boolean(storedConsent()));
    sync();
    // The banner fires these as the answer is given and as it is reopened from
    // the footer, so this appears and disappears with it instead of waiting
    // for the next full page load.
    window.addEventListener('prepfrancais:consent-answered', sync);
    window.addEventListener('prepfrancais:consent-reopen', sync);
    return () => {
      window.removeEventListener('prepfrancais:consent-answered', sync);
      window.removeEventListener('prepfrancais:consent-reopen', sync);
    };
  }, []);

  // Escape and outside clicks, so the panel behaves like every other menu.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const report = useCallback((id) => track('community_click', { id, from: 'float' }), []);

  if (!HAS_COMMUNITY || !ready) return null;

  const single = COMMUNITY_LINKS.length === 1 ? COMMUNITY_LINKS[0] : null;
  const SingleIcon = single ? (ICONS[single.id] || ChatsCircle) : null;

  /* z-40: under the cookie banner (z-50) and the paywall (z-60), over the
     page. Those two are modal moments and must never be covered. */
  return (
    <div ref={rootRef} className="fixed bottom-4 right-4 z-40 print:hidden sm:bottom-6 sm:right-6">
      {single ? (
        <a
          href={single.url} target="_blank" rel="noopener noreferrer"
          onClick={() => report(single.id)}
          data-testid={`community-float-${single.id}`}
          aria-label={t('community.join')}
          className={`flex min-h-[52px] items-center gap-2.5 rounded-full px-5 text-sm font-bold text-white shadow-lg transition ${TONES[single.id] || 'bg-primary'}`}
        >
          <SingleIcon size={22} weight="fill" />
          <span className="hidden sm:inline">{t('community.join')}</span>
        </a>
      ) : (
        <>
          {open && (
            <div
              id="community-panel"
              className="mb-3 w-60 origin-bottom-right rounded-2xl border border-violet-100 bg-white p-3 shadow-xl"
            >
              <p className="px-1 pb-2 text-xs font-semibold leading-relaxed text-gray-500">
                {t('community.blurb')}
              </p>
              {COMMUNITY_LINKS.map((link) => {
                const Icon = ICONS[link.id] || ChatsCircle;
                return (
                  <a
                    key={link.id}
                    href={link.url} target="_blank" rel="noopener noreferrer"
                    onClick={() => { report(link.id); setOpen(false); }}
                    data-testid={`community-float-${link.id}`}
                    className={`mt-1.5 flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 text-sm font-bold text-white transition ${TONES[link.id] || 'bg-primary'}`}
                  >
                    <Icon size={20} weight="fill" />
                    {t(link.labelKey)}
                  </a>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="community-panel"
            aria-label={open ? t('community.close') : t('community.join')}
            data-testid="community-float-toggle"
            className="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-600 text-white shadow-lg transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {open ? <X size={24} weight="bold" /> : <ChatsCircle size={26} weight="fill" />}
          </button>
        </>
      )}
    </div>
  );
}
