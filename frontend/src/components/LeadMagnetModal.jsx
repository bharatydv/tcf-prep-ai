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
 * 2. Once per browser, whatever the answer. A visitor who closed it said no,
 *    and showing it again on the next page is how an offer turns into an
 *    irritation. The "captured" key outlives the "dismissed" one on purpose:
 *    giving the number once should never be asked for twice.
 *
 * 3. Never while prerendering. react-snap runs the real app, effects
 *    included, so anything open at snapshot time is baked into the static
 *    HTML of every page — read by crawlers as page content, and shown for a
 *    frame to everyone.
 *
 * On the trigger itself: a browser cannot show its own dialog during
 * `beforeunload`, so "about to close the window" has to be read from the
 * pointer leaving through the top edge of the viewport, where the tab bar,
 * the address bar and the close button are. That signal does not exist on a
 * touch screen, which has no pointer to leave — so phones get a dwell timer
 * instead, which is the closest honest equivalent: somebody who has been
 * reading a while, rather than somebody who is leaving.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, DownloadSimple, CheckCircle, FilePdf } from '@phosphor-icons/react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

/* The resource this offer is for. One slug, matching backend DOWNLOADS. */
export const LEAD_RESOURCE = 'tcf-vocabulary';

/* Opens the form from anywhere. The Resources card uses it. */
export const LEAD_OPEN_EVENT = 'prepfrancais:lead-open';

const CAPTURED_KEY = 'prepfrancais.leadCaptured';
const DISMISSED_KEY = 'prepfrancais.leadDismissed';
const SOURCE_KEY = 'prepfrancais.leadSource';

/* How long a phone visitor reads before the offer appears. Long enough that
   it never lands on somebody still deciding whether to stay. */
const TOUCH_DELAY_MS = 45000;

function stored(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function remember(key) {
  try { window.localStorage.setItem(key, '1'); } catch { /* private mode */ }
}

function rememberSource(value) {
  try { window.sessionStorage.setItem(SOURCE_KEY, value); } catch { /* ditto */ }
}

function lastSource() {
  try { return window.sessionStorage.getItem(SOURCE_KEY) || 'exit_intent'; }
  catch { return 'exit_intent'; }
}

/* Whether the file has already been handed to this browser. Exported so the
   Resources page can offer the direct link instead of the form. */
export function alreadyCaptured() {
  return stored(CAPTURED_KEY) === '1';
}

/* The unsigned path. Serves anybody signed in; refuses everybody else, which
   is why the form exists at all. */
export function downloadPath(resource = LEAD_RESOURCE) {
  return `/api/downloads/${resource}`;
}

/* Start the download without leaving the page. A plain <a download> click
   rather than fetch+blob, so the browser's own download UI handles it and a
   3 MB PDF never sits in a tab's memory. */
function startDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function LeadMagnetModal() {
  const t = useT();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(null);      // the signed link, once given
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  /* Read by the listeners, which are registered once and must not be torn
     down and rebuilt every time a field is typed into. */
  const openRef = useRef(false);
  openRef.current = open;

  const show = useCallback((source) => {
    if (openRef.current) return;
    rememberSource(source);
    setError('');
    setOpen(true);
    /* Counted as shown the moment it is shown, not when it is answered: a
       visitor who closes the tab over the dialog has still seen the offer. */
    remember(DISMISSED_KEY);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (/ReactSnap/i.test(window.navigator.userAgent)) return undefined;

    /* Asked for by name — the Resources card — which overrides every rule
       below. Those rules are about not interrupting somebody; a button
       somebody pressed is not an interruption. */
    const onAsk = () => show('resources');
    window.addEventListener(LEAD_OPEN_EVENT, onAsk);
    const stop = () => window.removeEventListener(LEAD_OPEN_EVENT, onAsk);

    // `loading` is the session still settling: without it a signed-in visitor
    // is offered the form for the second /auth/me takes to answer.
    if (loading || user || alreadyCaptured() || stored(DISMISSED_KEY) === '1') {
      return stop;
    }

    // `relatedTarget` is null only when the pointer has left the document
    // entirely — without that check, every hover over an iframe or a native
    // select fires this. `buttons` rules out a drag.
    const onOut = (e) => {
      if (e.clientY > 0 || e.relatedTarget || e.buttons) return;
      show('exit_intent');
    };
    document.addEventListener('mouseout', onOut);

    const isTouch = typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none)').matches;
    const timer = isTouch
      ? window.setTimeout(() => show('dwell'), TOUCH_DELAY_MS)
      : null;

    return () => {
      stop();
      document.removeEventListener('mouseout', onOut);
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, user, show]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/leads', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        resource: LEAD_RESOURCE,
        source: lastSource(),
      });
      remember(CAPTURED_KEY);
      setDone(data.url);
      startDownload(data.url);
    } catch (err) {
      /* The dialog stays open with the values still in it. A lead form that
         clears itself on a failed submit is a lead that never arrives. */
      setError(errMsg(err, t('lead.fail')));
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-xl border border-violet-200 bg-white px-3.5 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-violet-200';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={t('lead.title')}>
      {/* Deliberately small. This interrupts somebody who was leaving, so it
          has to be readable at a glance and answerable in three taps — a
          panel that fills the screen reads as a wall to climb rather than an
          offer to take. */}
      <div className="flex max-h-[92vh] w-full max-w-[22rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2.5 bg-gradient-to-r from-primary to-fuchsia-600 px-4 py-3 text-white">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
            <FilePdf size={16} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-[13px] font-bold leading-snug">{t('lead.title')}</p>
            <p className="text-[10px] text-white/80">{t('lead.badge')}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('lead.close')}
            data-testid="lead-close"
            className="rounded-lg p-1 text-white/80 transition hover:bg-white/20 hover:text-white">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          {done ? (
            <div className="text-center">
              <CheckCircle size={34} weight="fill" className="mx-auto text-emerald-500" />
              <p className="mt-2 font-heading text-sm font-bold text-gray-900">{t('lead.doneTitle')}</p>
              <p className="mt-1 text-[13px] leading-snug text-gray-600">{t('lead.doneBody')}</p>
              {/* The click above can be blocked by a download setting, so the
                  link is on the page too rather than only in the code. */}
              <a href={done} download
                className="btn-primary mt-3 inline-flex items-center gap-2 !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-5 !py-2.5 text-sm">
                <DownloadSimple size={16} weight="bold" /> {t('lead.doneCta')}
              </a>
              <button type="button" onClick={() => setOpen(false)}
                className="mt-3 block w-full text-xs font-semibold text-gray-500 hover:text-primary">
                {t('lead.doneClose')}
              </button>
            </div>
          ) : (
            <>
              {/* One line, not a feature list. Whoever is reading this was on
                  their way out; the three fields below are the ask, and
                  everything above them is what stands between. */}
              <p className="text-[13px] leading-snug text-gray-600">{t('lead.body')}</p>

              <form onSubmit={submit} className="mt-3 space-y-2" data-testid="lead-form">
                <input className={field} value={form.name} onChange={set('name')}
                  name="name" autoComplete="name" required minLength={2} maxLength={120}
                  placeholder={t('lead.name')} aria-label={t('lead.name')} />
                <input className={field} value={form.email} onChange={set('email')}
                  name="email" type="email" autoComplete="email" required maxLength={255}
                  placeholder={t('lead.email')} aria-label={t('lead.email')} />
                {/* The pattern matches the server's: digits and the
                    punctuation people actually type, nothing normalised. */}
                <input className={field} value={form.phone} onChange={set('phone')}
                  name="phone" type="tel" autoComplete="tel" required
                  minLength={6} maxLength={32} pattern="[0-9+().\s-]{6,32}"
                  placeholder={t('lead.phone')} aria-label={t('lead.phone')} />
                {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
                <button type="submit" disabled={busy}
                  className="btn-primary w-full !bg-gradient-to-r !from-primary !to-fuchsia-600 !py-2.5 text-sm disabled:opacity-60">
                  {busy ? t('lead.sending') : t('lead.cta')}
                </button>
              </form>

              <p className="mt-2.5 text-center text-[10px] leading-snug text-gray-400">
                {t('lead.privacy')}{' '}
                <Link to="/privacy" className="font-semibold text-gray-500 underline-offset-2 hover:text-primary hover:underline">
                  {t('consent.privacy')}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
