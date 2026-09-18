/* GA4 business events, in one place.
 *
 * This file does NOT load or configure GA4, and it does not know the
 * measurement id. The tag is loaded by public/index.html and configured by
 * public/gtag-init.js, which also owns Consent Mode v2. Everything here talks
 * to the gtag() that file already put on window, so there is exactly one GA4
 * implementation on the page and exactly one place G-E829Q86M96 is written
 * down. Where an id is genuinely needed — gtag('get', …) demands one — it is
 * read back out of the dataLayer rather than repeated here. See gaIds().
 *
 * Why a module and never an inline <script>: script-src carries no
 * 'unsafe-inline' (frontend/security-headers.conf), so an inline gtag block is
 * dropped silently and the dashboard stays at zero. This ships inside the
 * bundle, which is same-origin and already allowed. Nothing here appends a
 * script tag or names a new host, so the CSP needs no change at all.
 *
 * ---------------------------------------------------------------------------
 * Consent
 * ---------------------------------------------------------------------------
 * Nothing here reads, writes, or gates on consent state. gtag() already
 * applies Consent Mode to everything it is handed: with analytics_storage
 * denied the event still goes out, cookieless, exactly as the page_view from
 * gtag('config') already does today. Gating custom events on granted consent
 * would make them behave differently from the pageview sitting beside them and
 * would silently drop the whole funnel for every visitor who never answers the
 * banner. Consent is owned by public/gtag-init.js and
 * components/ConsentBanner.jsx; this file is only ever a caller.
 *
 * ---------------------------------------------------------------------------
 * What must never be sent
 * ---------------------------------------------------------------------------
 * No email, name, phone number, password, essay text, transcript, audio,
 * answer sheet, card detail or gateway token. GA4's terms forbid personal
 * data and there is no legitimate reason to want it here. clean() below drops
 * anything that is not a short scalar, which stops an object being spread in
 * by accident, and sanitizeSearch() strips query strings down to campaign
 * parameters so a password-reset token in the URL cannot ride along in
 * page_location. Neither can tell a safe string from an unsafe one — that
 * judgement stays with the caller.
 *
 * ---------------------------------------------------------------------------
 * Two systems, on purpose
 * ---------------------------------------------------------------------------
 * track() in lib/api.js posts the same moments to our own backend. That one is
 * unblockable and authoritative; this one is blockable and is what the GA4
 * reports are built on. They are fed from the SAME call site here so the two
 * cannot drift, and each moment produces exactly one event in each system.
 * The names differ where history says they should:
 *
 *   helper                  GA4 event         first-party event
 *   ----------------------  ----------------  ---------------------------
 *   trackSignUp             sign_up           — (server records sign_up)
 *   trackLogin              login             login  <- stitching moment
 *   trackPracticeStart      practice_start    practice_start
 *   trackPracticeComplete   practice_complete practice_complete
 *   trackResultView         result_view       result_view
 *   trackViewPricing        view_pricing      pricing_view  (unchanged name)
 *   trackCheckoutStart      checkout_start    checkout_start (unchanged name)
 *   trackPurchase           purchase          — (server records
 *                                                "payment_success")
 *   trackPageView           page_view         page_view
 *
 * The full catalogue — every event, when it fires, and which parameters are
 * safe to attach — lives in lib/eventTaxonomy.js. Read that before adding one.
 *
 * Every function is fire-and-forget and swallows its own errors. Measurement
 * must never be able to break the thing it measures.
 */
import { track } from './api';
import {
  EVENTS, SKILLS, EXAMS, EXAM_TYPES,
  sanitizeSearch, sanitizePath, currentPath, clean,
} from './eventTaxonomy';

/* Re-exported, not redefined. These used to live in this file; they moved to
   lib/eventTaxonomy.js so that lib/api.js could use them too without importing
   this module, which imports api.js — a cycle that works in a bundler and is
   a bad thing to rely on. Callers that already import them from here keep
   working, and there is still exactly one implementation. */
export { EVENTS, SKILLS, EXAMS, EXAM_TYPES, sanitizeSearch, sanitizePath, clean };

/* The one place gtag is called. Everything else in this file goes through it.

   The typeof check is not defensive padding: gtag.js is loaded async from a
   third-party host, so it is legitimately absent during the first paint, for
   the whole visit behind an ad blocker, and in every unit test. None of those
   is an error worth surfacing. */
export function trackEvent(name, params) {
  try {
    if (typeof window === 'undefined') return;
    if (typeof window.gtag !== 'function') return;
    // 40 is GA4's ceiling for an event name; clean() applies the rest.
    window.gtag('event', String(name).slice(0, 40), clean(params));
  } catch {
    // Never let a metric throw into a render path.
  }
}

/* The measurement id, read back rather than repeated.
 *
 * gtag('get', …) is the one call that cannot be made without naming a
 * property. Taking the id from the dataLayer entry gtag-init.js already pushed
 * keeps a single source of truth: change the id in gtag-init.js and this
 * follows, with no second copy to forget. Returns null when the tag has not
 * loaded, which callers treat as "no ids available". */
function measurementId() {
  try {
    for (const args of window.dataLayer || []) {
      if (args && args[0] === 'config' && typeof args[1] === 'string'
          && args[1].startsWith('G-')) {
        return args[1];
      }
    }
  } catch { /* dataLayer absent or not iterable */ }
  return null;
}

/* The browser's GA4 client id and current session id.
 *
 * Wanted only by checkout: the purchase event is sent from the server, by the
 * webhook, and without these it would arrive as a brand-new user with no
 * session — revenue recorded, but attached to nothing, so no campaign ever
 * gets credit for a sale. Captured at checkout_start and carried on the
 * subscription row until the webhook fires. Neither id identifies a person;
 * they are random and mean nothing outside this property.
 *
 * Always resolves, never rejects, and never waits long. gtag's callback does
 * not fire at all when the tag is blocked, so the timeout is the normal exit
 * on a meaningful share of visits — a checkout must not hang behind it. */
export function gaIds(timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const out = {};
    const finish = () => { if (!settled) { settled = true; resolve(out); } };
    try {
      const id = measurementId();
      if (typeof window.gtag !== 'function' || !id) return finish();
      const timer = setTimeout(finish, timeoutMs);
      let pending = 2;
      const got = (key) => (value) => {
        if (value) out[key] = String(value).slice(0, 64);
        pending -= 1;
        if (pending === 0) { clearTimeout(timer); finish(); }
      };
      window.gtag('get', id, 'client_id', got('client_id'));
      window.gtag('get', id, 'session_id', got('session_id'));
    } catch {
      finish();
    }
    return undefined;
  });
}

/* ------------------------------------------------------------ pageviews ---
 * A hard load's page_view is sent by gtag('config') in gtag-init.js and is NOT
 * resent here — that is the whole reason components/RouteAnalytics.jsx skips
 * its first render. This is for the React Router navigations that follow,
 * which gtag cannot see. */
export function trackPageView(page) {
  try {
    const path = page?.path ?? currentPath();
    trackEvent(EVENTS.PAGE_VIEW, {
      page_path: path,
      page_location: `${window.location.origin}${path}`,
      page_title: page?.title ?? document.title,
    });
    /* And to our own funnel, which is where the admin path analysis reads
       sequences from. GA4 cannot answer "what did this person do before they
       bought", because its export is sampled, aggregated and not joinable to
       an account. track() attaches the path itself, so nothing is passed. */
    track(EVENTS.PAGE_VIEW);
  } catch {
    // Never let a metric throw into a render path.
  }
}

/* -------------------------------------------------------------- funnel --- */

/* An account now exists. Fired after the server has confirmed it and never
   from the form's submit handler — an email already taken, a weak password or
   a dropped connection all reach that handler too, and counting those as
   signups makes the number meaningless. `method` is how the account was
   created; there is no social login today, so every caller passes 'email'. */
export function trackSignUp(method = 'email') {
  trackEvent(EVENTS.SIGN_UP, { method });
  // Not reported to the first-party funnel from here: register() on the server
  // records sign_up itself, where it cannot be blocked or forged, and firing
  // it from both sides would double every signup in the funnel.
}

/* Credentials accepted and a session opened.
 *
 * This is the identity-stitching moment, and the reason it is a browser event
 * rather than a server one. track() sends the anonymous id and the session id;
 * the request carries the freshly set account cookie. /api/events is therefore
 * the one place where "this browser" and "this account" are both known at the
 * same instant, and it is what lets the admin journey show what somebody read
 * before they ever had an account. See post_event() in server.py. */
export function trackLogin(method = 'email') {
  trackEvent(EVENTS.LOGIN, { method });
  track(EVENTS.LOGIN, { method });
}

/* A session actually begins: the candidate is in the paper with the clock
   running, not merely on the page that describes it.

   `skill` is reading | listening | writing | speaking. `exam_type` is the shape
   of the sitting — test, practice, simulator, mock — so a timed paper can be
   told apart from untimed practice. `level` is only ever a CEFR band, and only
   where the app actually has one. */
export function trackPracticeStart(params = {}) {
  const fields = clean(params);
  trackEvent(EVENTS.PRACTICE_START, fields);
  /* One name for all four skills, with the skill as a parameter.
   *
   * This briefly routed speaking to a separate `speaking_start`, because the
   * backend allowlist had reserved that name years ago. It was a mistake: it
   * splits the funnel, so "how many people started practising" needed a UNION
   * of two event names and every skill breakdown had a special case in it.
   * `speaking_start` stays allowlisted on the server so any row already
   * written keeps counting, and the admin queries fold it into practice_start.
   */
  track(EVENTS.PRACTICE_START, fields);
}

/* The paper is marked and the result is on screen.
 *
 * Fired from the success path only, after the server has answered — never from
 * the submit button, which also fires for a 402 paywall, a 422 with no speech
 * in the recording, and every network failure.
 *
 * Scores are counts, not content: `score` and `total` say how it went without
 * carrying a single answer, and nothing that could reconstruct the candidate's
 * writing, speech or answer sheet is ever passed in. */
export function trackPracticeComplete(params = {}) {
  const fields = clean(params);
  trackEvent(EVENTS.PRACTICE_COMPLETE, fields);
  track(EVENTS.PRACTICE_COMPLETE, fields);
}

/* A graded correction was opened and read.
 *
 * The step between finishing a paper and doing anything else: somebody who
 * never opens their result did not get the thing they came for, and that gap
 * is invisible without this. Fired from the page that renders the correction,
 * once the submission has actually loaded — not from the link that points at
 * it, which fires just as happily for a result that then fails to load. */
export function trackResultView(params = {}) {
  const fields = clean(params);
  trackEvent(EVENTS.RESULT_VIEW, fields);
  track(EVENTS.RESULT_VIEW, fields);
}

/* The pricing page was actually read. Keeps the first-party name it has always
   had — renaming it would have put a break in a funnel that already has
   history behind it — while GA4 gets the name asked for. One call, one event
   in each system. */
export function trackViewPricing(params = {}) {
  const fields = clean(params);
  trackEvent('view_pricing', fields);
  track(EVENTS.PRICING_VIEW, fields);
}

/* Checkout was opened: a plan was chosen and the gateway is being asked for an
   order. Not a purchase, and deliberately not named like one — this fires for
   everyone who reaches the payment sheet, including everyone who closes it. */
export function trackCheckoutStart(params = {}) {
  const fields = clean(params);
  trackEvent(EVENTS.CHECKOUT_START, fields);
  track(EVENTS.CHECKOUT_START, fields);
}

/* Money was taken.
 *
 * DELIBERATELY NOT CALLED ANYWHERE IN THE APP, and BillingReturn.jsx must not
 * start calling it. Reaching /billing/return proves only that the gateway sent
 * the browser back; the charge is confirmed by a signed webhook that arrives
 * separately, sometimes seconds later, sometimes not at all. The live purchase
 * event is sent from that webhook by the server over the Measurement Protocol
 * — see ga4_track_purchase() in backend/server.py.
 *
 * It is exported because the helper's shape is part of this module's contract
 * and because it is the tested implementation to reach for if client-side
 * attribution is ever wanted for something that genuinely settles in the
 * browser. The sessionStorage guard makes it safe to call twice with the same
 * transaction_id, which is what a page refresh would do. */
export function trackPurchase({ transaction_id, value, currency, plan } = {}) {
  if (!transaction_id) return;
  const key = `prepfrancais.ga4.purchase.${transaction_id}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Private mode. Proceed: a possible duplicate beats a missing sale, and
    // GA4 collapses repeats of one transaction_id in the standard reports.
  }
  trackEvent('purchase', {
    transaction_id,
    value: typeof value === 'number' ? value : undefined,
    currency,
    plan,
  });
}
