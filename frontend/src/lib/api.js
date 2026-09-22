import axios from "axios";
// Leaf module: imports nothing, so there is no cycle with lib/analytics.js.
import { currentPath } from './eventTaxonomy';


// In production (GCP + Nginx), we use relative paths.
// This tells the browser to append the endpoint to the current domain: https://prepfrancais.com/api/...
//
// Except while prerendering. react-snap serves the freshly built bundle from
// its own localhost server and drives it with a headless browser, and there is
// no backend behind that server — so every page whose content arrives over the
// API rendered empty and was snapshotted empty. That is why /blog said "No
// articles yet" with a post sitting in the database, why no post page was ever
// discovered and prerendered, and why /recent-topics shipped a body with
// nothing in it.
//
// Pointing the bundle at the deployed API during that pass does not work: the
// API answers with `access-control-allow-origin` set to the site itself, so
// every response is blocked by CORS on react-snap's localhost origin. Instead
// scripts/prerender-snapshot.js writes the public endpoints to static files
// under /prerender before the build, and requests are rewritten to those —
// same origin, no network. react-snap identifies itself with this exact user
// agent, so a real browser never takes this path.
const isPrerender = typeof navigator !== "undefined"
  && navigator.userAgent === "ReactSnap";
const baseURL = "/api";

export const api = axios.create({ 
  baseURL, 
  withCredentials: true 
});

// 👇 FIX: strips the duplicate /api from any call that already includes it.
// This means components calling '/api/dashboard/stats' AND '/dashboard/stats'
// will both correctly resolve to '/api/dashboard/stats'.
api.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith('/api/')) {
    config.url = config.url.slice(4); // remove the leading '/api'
  }
  // Prerender only: /api/blog/some-slug becomes /prerender/blog/some-slug.json.
  // An endpoint with no snapshot 404s and the component shows the same empty
  // state it shows today, so a gap here degrades no further than the old
  // behaviour did.
  if (isPrerender && config.url) {
    config.baseURL = '/prerender';
    config.url = `${config.url.split('?')[0]}.json`;
  }
  return config;
});

// The access cookie expires after an hour. Without this, any call that happens
// to cross that boundary just fails — losing, for example, an essay the learner
// spent twenty minutes on. Refresh once, then replay the original request.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error?.response?.status;
    const isRefreshCall = original?.url?.includes('/auth/refresh');
    if (status === 402) announcePaywall(paywallDetail(error));
    if (status === 403) announceFinishSignup(finishSignupDetail(error));
    if (status !== 401 || !original || original._retried || isRefreshCall) {
      return Promise.reject(error);
    }
    original._retried = true;
    try {
      // One shared refresh, so N parallel 401s don't fire N refresh calls.
      refreshing = refreshing || api.post('/auth/refresh').finally(() => { refreshing = null; });
      await refreshing;
      return api(original);
    } catch {
      return Promise.reject(error);
    }
  },
);


/* ------------------------------------------------------------ analytics ---
 * Funnel events, sent to our own backend rather than a third party.
 *
 * No cookie, no fingerprint, no third-party script: an id in localStorage that
 * is random, belongs to this browser, and means nothing anywhere else. It
 * exists so a visitor who has not signed up yet still occupies a position in
 * the funnel; once they sign in the backend attaches their account id instead.
 *
 * The important events - signup, payment, an AI result - are recorded by the
 * server, where they cannot be blocked or forged. These are the ones only the
 * browser can see: which pages were reached, and where people stopped.
 *
 * Every call is fire-and-forget and swallows its own errors. Measurement must
 * never be able to break the thing it measures.
 */
const ANON_KEY = 'prepfrancais.anon';
const SESSION_KEY = 'prepfrancais.session';

/* How long a gap ends a visit. Thirty minutes is the convention GA4 and
   everyone else uses; the number matters less than the fact that both systems
   use the same one, so a session in the admin funnel means the same span of
   time as a session in GA4. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

function randomId() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch { /* not available in this context */ }
  // Two draws, because one Math.random() is about 52 bits and these have to
  // stay unique across every browser that ever posts an event.
  return `${Date.now().toString(36)}-${String(Math.random()).slice(2)}`
    + `-${String(Math.random()).slice(2)}`;
}

/* The browser, across visits.
 *
 * Random, stored here, and meaningless anywhere else: it is not a fingerprint
 * and not derived from anything about the device or the person. It exists so a
 * visitor who has not signed up yet still occupies a position in the funnel,
 * and so the trail they leave before registering can be joined to the account
 * they eventually open. See resetIdentity() for why it does not survive a
 * logout. */
export function anonId() {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = randomId().slice(0, 36);
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    // Private mode, or storage disabled. The event still counts, it just
    // cannot be tied to the visitor's other ones.
    return null;
  }
}

/* One visit.
 *
 * localStorage rather than sessionStorage, deliberately, for two reasons:
 * sessionStorage is per-tab, so opening the pricing page in a second tab would
 * start a second session and split one visit in half; and it is cleared when
 * the tab closes, so somebody who closes the tab and comes back two minutes
 * later would be counted as a returning visitor rather than the same one
 * carrying on.
 *
 * The window is idle-based, not fixed-length: `lastSeen` moves with every
 * event, so a candidate who sits a sixty-minute paper and then opens the
 * pricing page is still in the session that started when they arrived, which
 * is the whole point of measuring a journey.
 *
 * Reads and writes are wrapped because localStorage throws outright in some
 * privacy modes, and a storage error must never take down the page it is
 * measuring. When it does throw this returns a fresh id every time: every
 * event becomes its own session, which undercounts session length but never
 * merges two people's journeys, and that is the right way round to fail.
 */
export function sessionId(now = Date.now()) {
  try {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch { /* corrupt entry - treated as no session below */ }

    const fresh = !saved || !saved.id || typeof saved.lastSeen !== 'number'
      || (now - saved.lastSeen) > SESSION_IDLE_MS;
    const id = fresh ? randomId().slice(0, 36) : saved.id;
    // Written on every call, including the ones that did not start a session:
    // this IS the activity clock, and a session that stopped being extended
    // would expire thirty minutes after it began rather than thirty minutes
    // after the visitor stopped doing anything.
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastSeen: now }));
    return id;
  } catch {
    return randomId().slice(0, 36);
  }
}

/* A different person is now using this browser.
 *
 * Called on logout. Both ids are thrown away and the next event starts a new
 * anonymous identity and a new visit.
 *
 * This is the primary defence against two accounts on one machine - a shared
 * laptop, an internet cafe, a family computer - being stitched into one
 * journey. The server has a second, independent guard (it refuses to attribute
 * anonymous activity to an account when the same anon_id has been seen signing
 * into more than one), but that one is a repair; this one stops the damage
 * being recorded in the first place.
 *
 * It costs the cross-visit continuity of the anonymous id for somebody who
 * logs out and carries on browsing. That is the correct trade: the alternative
 * is attributing one person's study history to a different person's account. */
export function resetIdentity() {
  try {
    localStorage.removeItem(ANON_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored means nothing to reset.
  }
}

/* One first-party event.
 *
 * `event_id` is generated here rather than on the server so that a retry of
 * this POST - by the browser, by a proxy, by a service worker - is the SAME
 * event and is rejected by the unique index rather than counted twice. It is
 * the only thing standing between a flaky connection and a doubled funnel.
 *
 * `path` is the page this happened on, with its query string stripped back to
 * campaign parameters, so no caller has to remember to pass it and no caller
 * can accidentally pass a URL with a reset token in it. */
export function track(event, meta) {
  try {
    api.post('/api/events', {
      event,
      event_id: randomId(),
      anon_id: anonId(),
      session_id: sessionId(),
      path: currentPath(),
      meta: meta || {},
    }).catch(() => {});
  } catch {
    // Never let a metric throw into a render path.
  }
}

// Exporting baseURL as BACKEND_URL for consistency
export const BACKEND_URL = "";

/* -------------------------------------------------------------- paywall ----
   Running out of free attempts is not a failure the learner should have to
   read as an API error. Every 402 carries which allowance ran out, so it is
   announced once here and one host component renders it over whatever page
   they were on — their half-written essay included, which navigating away to
   /pricing used to throw out. */
export const PAYWALL_EVENT = 'prepfrancais:paywall';

// The 402 body, or null for anything else. Also accepts a bare detail object,
// which is what the SSE stream hands back instead of an axios error.
export function paywallDetail(errOrDetail, status) {
  const isErr = errOrDetail?.response !== undefined || errOrDetail?.isAxiosError;
  const code = isErr ? errOrDetail?.response?.status : status;
  if (code !== 402) return null;
  const detail = isErr ? errOrDetail?.response?.data?.detail : errOrDetail;
  if (detail && typeof detail === 'object') return detail;
  return { code: 'trial_exhausted', kind: 'writing',
           msg: typeof detail === 'string' ? detail : '' };
}

export function announcePaywall(detail) {
  if (!detail) return false;
  try {
    window.dispatchEvent(new CustomEvent(PAYWALL_EVENT, { detail }));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------- finishing an account ----
   The same idea as the paywall, for the other thing that is not an error.

   An account made by the free-PDF form has no password and an unconfirmed
   address, so the server answers 403 account_incomplete to everything except
   the download. That is not a failure to report but a form to show, and it is
   announced here for the same reason the paywall is: whoever hit it was in
   the middle of recording an answer, and navigating away would throw it out. */
export const FINISH_SIGNUP_EVENT = 'prepfrancais:finish-signup';

export function finishSignupDetail(errOrDetail, status) {
  const isErr = errOrDetail?.response !== undefined || errOrDetail?.isAxiosError;
  const code = isErr ? errOrDetail?.response?.status : status;
  if (code !== 403) return null;
  const detail = isErr ? errOrDetail?.response?.data?.detail : errOrDetail;
  // Only this one. Admin-only routes answer 403 as well, and turning those
  // into a sign-up form would be nonsense.
  if (!detail || typeof detail !== 'object') return null;
  return detail.code === 'account_incomplete' ? detail : null;
}

export function announceFinishSignup(detail) {
  if (!detail) return false;
  try {
    window.dispatchEvent(new CustomEvent(FINISH_SIGNUP_EVENT, { detail }));
    return true;
  } catch {
    return false;
  }
}

/* errorMessage() used to sit here beside errMsg() below, doing the same job on
   the same shapes and imported by nothing. Two functions for one FastAPI error
   is one too many, and the one that survives is the one every page already
   calls. */

export const CATEGORIES = {
  prepositions: { label: "Prépositions", color: "#FEF08A" },
  spelling: { label: "Orthographe", color: "#FECACA" },
  conjugation: { label: "Conjugaison", color: "#FED7AA" },
  gender_number: { label: "Accord en genre et nombre", color: "#BFDBFE" },
  anglicism: { label: "Anglicismes", color: "#E9D5FF" },
  improvement: { label: "Améliorations C1", color: "#BBF7D0" },
};

export const catColor = (key) => CATEGORIES[key]?.color || "#E5E7EB";

/* The SSE reader lives in components/shared.jsx as streamAnalysis(), which is
   what every writing surface imports. A second copy used to sit here, unused
   and subtly worse: it never called announcePaywall, so a spent trial would
   have surfaced through it as a bare error string instead of the plan chooser,
   and it had no guard for a stream that closes with no result event. One of
   them was going to get imported by mistake. */

export const errMsg = (err, defaultMsg) => {
  // A detail is not always a sentence: the paywall sends an object, and
  // returning it raw put "[object Object]" in a toast — or crashed the render
  // outright where the caller puts the message straight into JSX.
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg || '').filter(Boolean).join('; ');
  return err?.message || defaultMsg;
};
export const CATEGORY_META = CATEGORIES;
export const ACCENTS = ["é", "è", "ê", "ë", "à", "â", "ç", "î", "ï", "ô", "û", "ù", "ü", "œ", "«", "»", "’"];