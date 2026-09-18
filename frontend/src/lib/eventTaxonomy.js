/* The event taxonomy. One list, documented, for the whole application.
 *
 * Before this file, event names were string literals scattered across a dozen
 * pages and a Python set on the other side of the wire, and the only way to
 * find out what `practice_start` carried was to read every call site. An
 * analytics property is only as good as the agreement about what its names
 * mean, and that agreement has to be written down somewhere both halves of the
 * app can point at.
 *
 * This module is deliberately a leaf: it imports nothing, so lib/api.js and
 * lib/analytics.js can both use it without an import cycle between them.
 *
 * The backend enforces its own allowlist in server.py (CLIENT_EVENTS and
 * SERVER_EVENTS) because a browser must not be able to invent event names. The
 * two lists have to agree; tests/test_analytics.py asserts that they do.
 *
 * ---------------------------------------------------------------------------
 * WHO RECORDS WHAT
 * ---------------------------------------------------------------------------
 * browser  the only place that can see it (a page was read, a button pressed)
 * server   must not be blockable or forgeable (an account, a charge, a cost)
 *
 * A moment is recorded by exactly one of them. Where GA4 and the first-party
 * funnel both want it, one call site feeds both (see lib/analytics.js).
 *
 * ---------------------------------------------------------------------------
 * THE CATALOGUE
 * ---------------------------------------------------------------------------
 * name              who      fires when                      safe parameters
 * ----------------  -------  ------------------------------  ----------------
 * landing_view      browser  the marketing home page mounts  —
 * page_view         browser  a React Router navigation, and  page (path only,
 *                            the first paint                 query stripped)
 * tcf_canada_view   browser  one of the TCF Canada pages     slug
 *                            mounts
 * signup_start      browser  the registration form opens.    —
 *                            NOT a submission.
 * sign_up           server   the account row was committed.  method
 *                            Never on a taken address, a
 *                            weak password or a failure.
 * login             browser  credentials accepted and a      method
 *                            session opened. This is the
 *                            identity-stitching moment: it
 *                            is the one event that carries
 *                            the anonymous id AND the
 *                            account cookie together.
 * logout            server   the session was ended, while
 *                            the account is still known.     —
 * email_verified    server   a confirmation link was         —
 *                            consumed successfully.
 * practice_start    browser  the candidate is in the paper   skill, exam,
 *                            with the clock running - not    exam_type,
 *                            merely on the page that         tache, level,
 *                            describes it. One per sitting.  test_number,
 *                                                            set_number, mode
 * practice_complete browser  the server returned a grade.    skill, exam,
 *                            Never from the submit button,   exam_type, level,
 *                            which also fires for a 402      score, total,
 *                            paywall and every failure.      tache, words
 * result_view       browser  a graded correction is opened   skill, level,
 *                            and read.                       source
 * pricing_view      browser  the pricing page mounts         —
 * checkout_start    browser  a plan was chosen and the       plan
 *                            gateway is being asked for an
 *                            order. NOT a purchase.
 * payment_success   server   a signed webhook confirmed the  plan, amount,
 *                            charge AND premium was granted  currency,
 *                            or extended. The only thing     first_cycle
 *                            that counts as revenue.
 * payment_reversed  server   a refund or chargeback landed   plan, amount
 * community_click   browser  a community link was followed   id, from
 * mic_denied        browser  the browser refused microphone  —
 *                            permission
 * ai_call           server   one paid model round trip       feature, provider,
 *                            finished, for cost accounting   model, seconds,
 *                                                            chars
 * ai_result         server   a grade was produced            feature, level
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NEVER RECORDED
 * ---------------------------------------------------------------------------
 * Essay text, transcripts, audio, answer sheets, conversation turns, email
 * addresses, names, phone numbers, passwords, tokens, card details, IP
 * addresses, precise location, mouse movement, keystrokes, scroll position.
 *
 * `clean()` below is the mechanical guard - it drops anything that is not a
 * short scalar, which stops a whole grading response being spread into an
 * event by accident. It cannot tell a safe string from an unsafe one, so the
 * judgement stays with the caller, and the parameter columns above are the
 * agreed answer.
 */

/* ------------------------------------------------------------- the names --- */

export const EVENTS = {
  LANDING_VIEW: 'landing_view',
  PAGE_VIEW: 'page_view',
  TCF_CANADA_VIEW: 'tcf_canada_view',

  SIGNUP_START: 'signup_start',
  SIGN_UP: 'sign_up',
  LOGIN: 'login',
  LOGOUT: 'logout',
  EMAIL_VERIFIED: 'email_verified',

  PRACTICE_START: 'practice_start',
  PRACTICE_COMPLETE: 'practice_complete',
  RESULT_VIEW: 'result_view',

  PRICING_VIEW: 'pricing_view',
  CHECKOUT_START: 'checkout_start',

  PAYMENT_SUCCESS: 'payment_success',
  PAYMENT_REVERSED: 'payment_reversed',

  COMMUNITY_CLICK: 'community_click',
  MIC_DENIED: 'mic_denied',

  AI_CALL: 'ai_call',
  AI_RESULT: 'ai_result',
};

/* The four things the exam measures. The value of every `skill` parameter, and
   the only values the admin skill filter will accept. */
export const SKILLS = {
  READING: 'reading',
  LISTENING: 'listening',
  WRITING: 'writing',
  SPEAKING: 'speaking',
};

/* Which exam the material belongs to.
 *
 * Everything the product currently contains is TCF Canada: the papers, the
 * tâches, the CEFR bands and the grader's rubric. TEF appears in the marketing
 * copy and in one line of a grader prompt, and there is no TEF paper, no TEF
 * selector and no TEF content anywhere in the app.
 *
 * TEF is listed here anyway, and the admin Exams view will show it with a zero
 * against it, because an empty row that says "no TEF activity" is a true and
 * useful answer, and because the day TEF content is added this is the constant
 * it should be tagged with rather than a new string invented at that call site.
 */
export const EXAMS = {
  TCF: 'tcf',
  TEF: 'tef',
};

/* The shape of a sitting. Orthogonal to EXAMS: a TCF paper can be sat as a
   timed test, as untimed practice, as a full simulator run, or pasted in for a
   one-off check. */
export const EXAM_TYPES = {
  TEST: 'test',
  PRACTICE: 'practice',
  SIMULATOR: 'simulator',
  MOCK: 'mock',
  CHECK: 'check',
  FREE: 'free',
};

/* ----------------------------------------------------------- URL safety --- */

/* Query parameters worth keeping in a URL we report.
 *
 * An allowlist rather than a blocklist, because the parameter that must not
 * leak is always the one nobody thought of. /reset-password?token=,
 * /account/verify?token= and /verify-email?token= are opened straight from an
 * email and that token is a live credential; /speaking/record carries the exam
 * question in ?q= for convenience.
 *
 * Campaign parameters survive because GA4 reads attribution out of
 * page_location, and stripping them would send every acquisition report to
 * direct/none.
 *
 * public/gtag-init.js holds a second copy of this list, because it is served
 * as-is from /public and cannot import from the bundle. They must not drift.
 */
const CAMPAIGN_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'gclid', 'gbraid', 'wbraid', 'dclid',
  'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid', 'ref',
]);

/* GA4's own ceilings, applied here so a value is trimmed rather than the whole
   event being rejected at the collector: 25 parameters, 40-character names,
   100-character values. The backend trims again on arrival, because a browser
   is not something to take trimming promises from. */
const MAX_PARAMS = 25;
const MAX_NAME = 40;
const MAX_VALUE = 100;

export function sanitizeSearch(search) {
  try {
    const kept = [];
    new URLSearchParams(search || '').forEach((value, key) => {
      if (CAMPAIGN_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
    });
    if (!kept.length) return '';
    return `?${new URLSearchParams(kept).toString()}`;
  } catch {
    // A malformed query string is not worth reporting a page over.
    return '';
  }
}

/* The path as it may be reported: where the visitor is, minus anything private
   that happened to be in the address bar. */
export function sanitizePath(pathname, search) {
  return `${pathname || '/'}${sanitizeSearch(search)}`;
}

/* The current address, sanitised. Used by track() so every first-party event
   carries the page it happened on without any call site having to remember. */
export function currentPath() {
  try {
    return sanitizePath(window.location.pathname, window.location.search);
  } catch {
    return '';
  }
}

/* Parameter values are short scalars or they are dropped.
 *
 * The dropping matters more than the trimming: it is what stops
 * `trackPracticeComplete(result)` spreading a whole grading response —
 * transcripts, corrections, the candidate's own text — into an event because
 * somebody passed the wrong object. */
export function clean(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  for (const [rawKey, value] of Object.entries(params)) {
    if (Object.keys(out).length >= MAX_PARAMS) break;
    if (value == null || value === '') continue;
    const key = String(rawKey).slice(0, MAX_NAME);
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_VALUE);
    }
    // Objects, arrays, functions: deliberately skipped. See above.
  }
  return out;
}
