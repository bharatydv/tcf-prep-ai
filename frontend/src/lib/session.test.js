/* The identity primitives in lib/api.js.
 *
 * These decide who two events belong to and whether they happened in the same
 * visit, and getting them wrong is not a visible bug — it is a dashboard that
 * quietly answers the wrong question, or worse, one person's study history
 * shown inside another person's journey. They are tested directly rather than
 * through track(), which would need axios and an interceptor stack to say
 * anything about a thirty-minute window.
 *
 * axios is mocked at the module boundary so importing api.js does not try to
 * build a real client under jsdom.
 */
import { anonId, sessionId, resetIdentity } from './api';

jest.mock('axios', () => {
  const instance = {
    post: jest.fn(() => Promise.resolve({ data: {} })),
    get: jest.fn(() => Promise.resolve({ data: {} })),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { baseURL: '' },
  };
  return { __esModule: true, default: { create: () => instance }, create: () => instance };
});

const MINUTE = 60 * 1000;

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

describe('anonymous id', () => {
  it('is created once and then reused', () => {
    const first = anonId();
    expect(first).toBeTruthy();
    expect(anonId()).toBe(first);
  });

  it('survives across visits, because it is in localStorage', () => {
    const first = anonId();
    // A new page load reads the same store; nothing in memory carries over.
    expect(window.localStorage.getItem('prepfrancais.anon')).toBe(first);
  });

  it('returns null rather than throwing when storage is unavailable', () => {
    jest.spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation(() => { throw new Error('private mode'); });
    expect(anonId()).toBeNull();
  });
});

describe('session id', () => {
  it('creates one on first use', () => {
    const id = sessionId(0);
    expect(id).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('prepfrancais.session')).id)
      .toBe(id);
  });

  it('keeps the same session while activity continues', () => {
    const start = sessionId(0);
    expect(sessionId(5 * MINUTE)).toBe(start);
    expect(sessionId(29 * MINUTE)).toBe(start);
  });

  it('keeps the same session exactly at the thirty-minute edge', () => {
    const start = sessionId(0);
    expect(sessionId(30 * MINUTE)).toBe(start);
  });

  it('starts a new session after more than thirty idle minutes', () => {
    const start = sessionId(0);
    const later = sessionId(30 * MINUTE + 1);
    expect(later).not.toBe(start);
  });

  it('measures idleness from the last event, not from the session start', () => {
    /* The case that makes this idle-based rather than fixed-length: a
       candidate sitting a sixty-minute paper is still in the visit they
       arrived in, because they kept doing things throughout it. */
    const start = sessionId(0);
    expect(sessionId(20 * MINUTE)).toBe(start);
    expect(sessionId(40 * MINUTE)).toBe(start);
    expect(sessionId(60 * MINUTE)).toBe(start);
    // ...and then they leave.
    expect(sessionId(95 * MINUTE)).not.toBe(start);
  });

  it('starts a new session when the stored entry is corrupt', () => {
    window.localStorage.setItem('prepfrancais.session', 'not json');
    expect(sessionId(0)).toBeTruthy();
  });

  it('starts a new session when the stored entry has no timestamp', () => {
    window.localStorage.setItem('prepfrancais.session',
      JSON.stringify({ id: 'orphan' }));
    expect(sessionId(0)).not.toBe('orphan');
  });

  it('never merges two visits when storage throws', () => {
    jest.spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => { throw new Error('quota'); });
    // Failing towards "every event is its own session" undercounts session
    // length; failing the other way would join strangers together.
    expect(sessionId(0)).not.toBe(sessionId(0));
  });
});

describe('resetIdentity', () => {
  it('throws away both ids, so the next account starts a fresh trail', () => {
    const anon = anonId();
    const session = sessionId(0);
    resetIdentity();
    expect(anonId()).not.toBe(anon);
    expect(sessionId(0)).not.toBe(session);
  });

  it('is safe to call when nothing was ever stored', () => {
    expect(() => resetIdentity()).not.toThrow();
  });

  it('does not throw when storage is unavailable', () => {
    jest.spyOn(window.localStorage.__proto__, 'removeItem')
      .mockImplementation(() => { throw new Error('private mode'); });
    expect(() => resetIdentity()).not.toThrow();
  });
});

describe('ids are unique', () => {
  it('gives every browser a different anonymous id', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      window.localStorage.clear();
      seen.add(anonId());
    }
    expect(seen.size).toBe(200);
  });

  it('gives every new session a different id', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      window.localStorage.clear();
      seen.add(sessionId(0));
    }
    expect(seen.size).toBe(200);
  });
});
