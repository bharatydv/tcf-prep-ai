/* "Priya S. just finished a writing test" — a small card in the bottom-left
 * corner, one at a time, built from real activity (GET /api/activity/recent).
 *
 * Live: every open page asks for new activity every POLL_MS, so when anyone
 * finishes a test or buys a plan, everybody on the site sees it within
 * seconds. Between live events it replays the last two weeks' activity, one
 * card every GAP_MS and at most MAX_REPLAYS per browser tab.
 *
 * Kept quiet where it would get in the way:
 *  - closing it with × stops them for the rest of the visit;
 *  - it never shows during a timed test, in the admin panel, or while the
 *    cookie banner holds the bottom of the screen;
 *  - it is not captured into the prerendered HTML (react-snap).
 * Bottom-left, the opposite corner from the community button. Not shown on a
 * phone at all: there it shared the bottom edge with the community button and
 * the cookie banner, and covered the page's own buttons.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle, Crown, X } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { storedConsent } from './ConsentBanner';

const FIRST_DELAY_MS = 8000;   // before the first replayed card
const SHOW_MS = 6000;          // how long a card stays up
const GAP_MS = 20000;          // between replayed cards
const LIVE_GAP_MS = 3000;      // between live cards, when several arrive at once
const POLL_MS = 20000;         // how often to ask for new activity
const MAX_REPLAYS = 5;         // replayed cards per tab; live ones are not capped
const STORE = 'prepfrancais.activity';

// Timed tests and the admin panel: nothing should pop up there.
const QUIET = [
  /^\/admin/, /^\/exam\//, /^\/exam-simulator/, /^\/practice\/simulator/,
  /^\/speaking\/(test|record)/, /^\/(reading|listening)\/test\//,
];

function readStore() {
  try { return JSON.parse(sessionStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function writeStore(patch) {
  try { sessionStorage.setItem(STORE, JSON.stringify({ ...readStore(), ...patch })); } catch { /* harmless */ }
}

function ago(t, iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('activity.justNow');
  if (mins < 60) return t('activity.minsAgo', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t(hours === 1 ? 'activity.hourAgo' : 'activity.hoursAgo', { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? 'activity.dayAgo' : 'activity.daysAgo', { n: days });
}

const keyOf = (e) => `${e.at}|${e.name}|${e.kind}|${e.what}`;

export default function ActivityToast() {
  const t = useT();
  const { pathname } = useLocation();
  const [current, setCurrent] = useState(null);
  const [consented, setConsented] = useState(false);
  // Refs, not state: the ticker below reads them every second and none of
  // them should re-render anything on their own.
  const backlog = useRef([]);     // the last two weeks, replayed in turn
  const live = useRef([]);        // arrived since this tab opened, shown first
  const newest = useRef('');      // the newest `at` seen so far
  const onScreen = useRef(null);
  const shownAt = useRef(0);
  const hiddenAt = useRef(0);
  const openedAt = useRef(Date.now());
  const quiet = QUIET.some((re) => re.test(pathname));
  const snap = /ReactSnap/i.test(window.navigator.userAgent);

  // The cookie banner spans the bottom edge until it is answered.
  useEffect(() => {
    if (snap) return undefined;
    const sync = () => setConsented(Boolean(storedConsent()));
    sync();
    window.addEventListener('prepfrancais:consent-answered', sync);
    window.addEventListener('prepfrancais:consent-reopen', sync);
    return () => {
      window.removeEventListener('prepfrancais:consent-answered', sync);
      window.removeEventListener('prepfrancais:consent-reopen', sync);
    };
  }, [snap]);

  // Poll. The first answer becomes the replay list; anything newer than what
  // has been seen after that is live and goes to the front of the queue.
  useEffect(() => {
    if (snap) return undefined;
    let first = true;
    const poll = () => api.get('/api/activity/recent')
      .then(({ data }) => {
        const events = data.events || [];
        if (first) {
          first = false;
          backlog.current = events;
          newest.current = events[0]?.at || new Date().toISOString();
          return;
        }
        const fresh = events.filter((e) => e.at > newest.current);
        if (!fresh.length) return;
        newest.current = fresh[0].at;
        const known = new Set(backlog.current.map(keyOf));
        backlog.current = [...fresh.filter((e) => !known.has(keyOf(e))), ...backlog.current];
        // Oldest first, so several at once are told in the order they happened.
        live.current.push(...[...fresh].reverse());
      })
      .catch(() => {});
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [snap]);

  // One ticker decides what is on screen.
  useEffect(() => {
    if (snap || quiet || !consented) {
      setCurrent(null);
      return undefined;
    }
    // Decided outside setState: an updater may run twice in development, and
    // taking from the queue twice would skip a card.
    const show = (e) => { onScreen.current = e; shownAt.current = Date.now(); setCurrent(e); };
    const tick = () => {
      if (readStore().closed) return;
      const now = Date.now();
      if (onScreen.current) {
        if (now - shownAt.current < SHOW_MS) return;
        onScreen.current = null;
        hiddenAt.current = now;
        setCurrent(null);
        return;
      }
      if (live.current.length && now - hiddenAt.current >= LIVE_GAP_MS) {
        show(live.current.shift());
        return;
      }
      const s = readStore();
      const replays = s.shown || 0;
      if (backlog.current.length && replays < MAX_REPLAYS
          && now - openedAt.current >= FIRST_DELAY_MS
          && now - hiddenAt.current >= GAP_MS) {
        const i = (s.next || 0) % backlog.current.length;
        writeStore({ shown: replays + 1, next: i + 1 });
        show(backlog.current[i]);
      }
    };
    const id = setInterval(tick, 1000);
    return () => { clearInterval(id); onScreen.current = null; setCurrent(null); };
  }, [snap, quiet, consented]);

  if (!current) return null;

  const close = () => {
    writeStore({ closed: true });
    onScreen.current = null;
    setCurrent(null);
  };

  const plan = current.kind === 'plan';
  const text = plan
    ? t('activity.plan', { name: current.name, plan: current.plan })
    : t(`activity.test_${current.what}`, { name: current.name });

  return (
    <div role="status" aria-live="polite" data-testid="activity-toast"
      className="activity-toast fixed bottom-4 left-4 z-40 hidden w-[calc(100%-6rem)] max-w-xs sm:bottom-6 sm:left-6 sm:block">
      <div className="relative flex items-start gap-3 rounded-2xl border border-violet-100 bg-white p-3.5 pr-9 shadow-lift">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${plan ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
          {plan ? <Crown size={18} weight="fill" /> : <CheckCircle size={18} weight="fill" />}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] leading-snug text-gray-800">{text}</p>
          <p className="mt-1 text-[11px] text-gray-400">
            {ago(t, current.at)}
            {plan && (
              <> · <Link to="/pricing" className="font-semibold text-primary hover:underline">{t('activity.seePlans')}</Link></>
            )}
          </p>
        </div>
        <button type="button" onClick={close} aria-label={t('activity.close')}
          className="absolute right-2 top-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
