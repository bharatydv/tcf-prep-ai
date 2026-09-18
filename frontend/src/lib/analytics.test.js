/* The parts of lib/analytics.js that decide what leaves the browser.
 *
 * Two of these are the whole reason that file has any logic in it at all:
 * sanitizeSearch, which keeps a password-reset token out of GA4, and clean(),
 * which stops a grading response being spread into an event. Both are cheap to
 * get wrong in a way nobody notices until the data is already collected.
 *
 * lib/api.js is mocked because importing it pulls in axios and an interceptor
 * stack that has nothing to do with any of this, and because asserting on the
 * first-party call is the only way to prove one call site really does feed
 * both systems.
 */
import {
  sanitizeSearch, sanitizePath, clean, trackEvent, trackSignUp,
  trackViewPricing, trackPracticeStart, trackPurchase, trackLogin,
  trackResultView, trackPageView,
} from './analytics';
import { track } from './api';

jest.mock('./api', () => ({ track: jest.fn() }));

describe('sanitizeSearch', () => {
  it('drops a password-reset token', () => {
    expect(sanitizeSearch('?token=abc123')).toBe('');
  });

  it('drops everything that is not a campaign parameter', () => {
    expect(sanitizeSearch('?q=Presentez-vous&theme=42&plan=month')).toBe('');
  });

  it('keeps campaign parameters, so attribution still works', () => {
    expect(sanitizeSearch('?utm_source=google&utm_medium=cpc'))
      .toBe('?utm_source=google&utm_medium=cpc');
  });

  it('keeps the campaign parameter and drops the secret beside it', () => {
    expect(sanitizeSearch('?token=secret&gclid=xyz')).toBe('?gclid=xyz');
  });

  it('is case-insensitive about parameter names', () => {
    expect(sanitizeSearch('?UTM_Source=nl')).toBe('?UTM_Source=nl');
  });

  it('survives a malformed query string', () => {
    expect(sanitizeSearch('%%%')).toBe('');
    expect(sanitizeSearch(undefined)).toBe('');
  });
});

describe('sanitizePath', () => {
  it('joins the path to the surviving parameters', () => {
    expect(sanitizePath('/reset-password', '?token=abc')).toBe('/reset-password');
    expect(sanitizePath('/pricing', '?utm_id=7')).toBe('/pricing?utm_id=7');
  });
});

describe('clean', () => {
  it('keeps short scalars', () => {
    expect(clean({ skill: 'reading', score: 12, spoken: true }))
      .toEqual({ skill: 'reading', score: 12, spoken: true });
  });

  it('drops objects and arrays, so a grading response cannot be spread in', () => {
    const graded = {
      skill: 'writing',
      corrections: [{ span: 'je suis allé', fix: 'je suis allée' }],
      submission: { text: 'the candidate essay', email: 'a@b.com' },
    };
    expect(clean(graded)).toEqual({ skill: 'writing' });
  });

  it('drops empty and absent values rather than sending blanks', () => {
    expect(clean({ level: null, tache: undefined, note: '' })).toEqual({});
  });

  it('trims a long string to GA4 100-character ceiling', () => {
    expect(clean({ note: 'x'.repeat(250) }).note).toHaveLength(100);
  });

  it('stops at 25 parameters', () => {
    const many = {};
    for (let i = 0; i < 40; i += 1) many[`p${i}`] = i + 1;
    expect(Object.keys(clean(many))).toHaveLength(25);
  });

  it('returns an empty object for a non-object', () => {
    expect(clean(null)).toEqual({});
    expect(clean('reading')).toEqual({});
  });
});

describe('trackEvent', () => {
  afterEach(() => { delete window.gtag; });

  it('does nothing at all when the tag is absent or blocked', () => {
    expect(() => trackEvent('sign_up', { method: 'email' })).not.toThrow();
  });

  it('sends the cleaned parameters through gtag', () => {
    window.gtag = jest.fn();
    trackSignUp('email');
    expect(window.gtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'email' });
  });

  it('never lets a throwing gtag reach the caller', () => {
    window.gtag = () => { throw new Error('blocked'); };
    expect(() => trackSignUp()).not.toThrow();
  });
});

describe('one call site, two systems', () => {
  beforeEach(() => { window.gtag = jest.fn(); track.mockClear(); });
  afterEach(() => { delete window.gtag; });

  it('sends view_pricing to GA4 and the original pricing_view to the backend', () => {
    trackViewPricing();
    expect(window.gtag).toHaveBeenCalledWith('event', 'view_pricing', {});
    expect(track).toHaveBeenCalledWith('pricing_view', {});
  });

  it('uses one event name for every skill, with the skill as a parameter', () => {
    /* Speaking briefly routed to a separate `speaking_start`, which split the
       funnel: counting practice starts needed a UNION and every skill
       breakdown carried a special case. The server still accepts the old name
       so rows already written keep counting. */
    trackPracticeStart({ skill: 'speaking', exam_type: 'practice' });
    expect(window.gtag).toHaveBeenCalledWith(
      'event', 'practice_start', { skill: 'speaking', exam_type: 'practice' });
    expect(track).toHaveBeenCalledWith(
      'practice_start', { skill: 'speaking', exam_type: 'practice' });
  });

  it('uses practice_start for every other skill', () => {
    trackPracticeStart({ skill: 'reading', exam_type: 'test' });
    expect(track).toHaveBeenCalledWith(
      'practice_start', { skill: 'reading', exam_type: 'test' });
  });

  it('reports a login to both systems, which is what stitches the identity', () => {
    trackLogin('email');
    expect(window.gtag).toHaveBeenCalledWith('event', 'login', { method: 'email' });
    // track() attaches the anonymous id and the session; the request carries
    // the account cookie. This call is the only place both are known at once.
    expect(track).toHaveBeenCalledWith('login', { method: 'email' });
  });

  it('reports a result view to both systems', () => {
    trackResultView({ skill: 'writing', exam: 'tcf', level: 'B2' });
    expect(window.gtag).toHaveBeenCalledWith(
      'event', 'result_view', { skill: 'writing', exam: 'tcf', level: 'B2' });
    expect(track).toHaveBeenCalledWith(
      'result_view', { skill: 'writing', exam: 'tcf', level: 'B2' });
  });

  it('sends a pageview to both systems, which is what path analysis reads', () => {
    trackPageView({ path: '/pricing' });
    expect(window.gtag).toHaveBeenCalledWith(
      'event', 'page_view', expect.objectContaining({ page_path: '/pricing' }));
    // No parameters: track() attaches the path itself, from the address bar,
    // so no caller can pass one that still has a reset token in it.
    expect(track).toHaveBeenCalledWith('page_view');
  });

  it('does not report signup to the backend, which records it server-side', () => {
    trackSignUp('email');
    expect(track).not.toHaveBeenCalled();
  });
});

describe('trackPurchase', () => {
  beforeEach(() => { window.gtag = jest.fn(); window.sessionStorage.clear(); });
  afterEach(() => { delete window.gtag; });

  it('refuses to send anything without a transaction id', () => {
    trackPurchase({ value: 60, currency: 'USD' });
    expect(window.gtag).not.toHaveBeenCalled();
  });

  it('sends one event per transaction, however often it is called', () => {
    trackPurchase({ transaction_id: 'sub_1', value: 61.79, currency: 'USD', plan: 'month' });
    trackPurchase({ transaction_id: 'sub_1', value: 61.79, currency: 'USD', plan: 'month' });
    expect(window.gtag).toHaveBeenCalledTimes(1);
    expect(window.gtag).toHaveBeenCalledWith('event', 'purchase', {
      transaction_id: 'sub_1', value: 61.79, currency: 'USD', plan: 'month',
    });
  });

  it('still counts a different order', () => {
    trackPurchase({ transaction_id: 'sub_1', value: 1, currency: 'USD' });
    trackPurchase({ transaction_id: 'sub_2', value: 1, currency: 'USD' });
    expect(window.gtag).toHaveBeenCalledTimes(2);
  });
});
