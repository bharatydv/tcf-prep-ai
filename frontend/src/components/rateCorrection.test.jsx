/* "How was this correction?" — mounted, with the API mocked.
 *
 * Same approach as speakingResult.test.jsx: react-dom/client with act(), and
 * the DOM read directly. The network is a jest mock, so the test also pins
 * exactly what is sent: a low rating can never be posted as public, whatever
 * the box says, because the server treats that as feedback for us and the
 * client should never even ask.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import RateCorrection from './RateCorrection';

jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errMsg: (e) => String(e?.message || e),
}));
const { api } = require('../lib/api');

function mount(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<I18nProvider><RateCorrection {...props} /></I18nProvider>);
  });
  return { host, unmount: () => act(() => { root.unmount(); host.remove(); }) };
}

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue({ data: { review: null } });
  api.post.mockResolvedValue({ data: { detail: 'Thanks' } });
});

describe('RateCorrection', () => {
  it('renders nothing without a submission to rate', () => {
    const { host, unmount } = mount({ submissionId: null });
    expect(host.innerHTML).toBe('');
    expect(api.get).not.toHaveBeenCalled();
    unmount();
  });

  it('asks the five faces, and opens the comment only once one is picked', async () => {
    const { host, unmount } = mount({ submissionId: 'sub_1' });
    await flush();
    expect(host.querySelectorAll('[data-testid^="rate-"][aria-pressed]').length).toBe(5);
    expect(host.querySelector('[data-testid="rate-comment"]')).toBeNull();

    act(() => host.querySelector('[data-testid="rate-2"]').click());
    expect(host.querySelector('[data-testid="rate-comment"]')).not.toBeNull();
    // A poor rating is private feedback: no "show on the site" box.
    expect(host.querySelector('[data-testid="rate-public"]')).toBeNull();
    unmount();
  });

  it('posts the rating for this submission, and thanks the learner', async () => {
    const { host, unmount } = mount({ submissionId: 'sub_1' });
    await flush();
    act(() => host.querySelector('[data-testid="rate-5"]').click());
    act(() => host.querySelector('[data-testid="rate-public"]').click());
    await act(async () => {
      host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/api/reviews');
    expect(body.submission_id).toBe('sub_1');
    expect(body.rating).toBe(5);
    expect(body.allow_public).toBe(true);
    expect(host.querySelector('[data-testid="rate-done"]')).not.toBeNull();
    unmount();
  });

  it('never sends a low rating as public', async () => {
    const { host, unmount } = mount({ submissionId: 'sub_1' });
    await flush();
    act(() => host.querySelector('[data-testid="rate-5"]').click());
    act(() => host.querySelector('[data-testid="rate-public"]').click());
    // Changed their mind down to a 2 after ticking the box.
    act(() => host.querySelector('[data-testid="rate-2"]').click());
    await act(async () => {
      host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(api.post.mock.calls[0][1].allow_public).toBe(false);
    unmount();
  });

  it('shows the thanks, not the question, for a correction already rated', async () => {
    api.get.mockResolvedValue({ data: { review: { rating: 4, comment: 'Bien', allow_public: false } } });
    const { host, unmount } = mount({ submissionId: 'sub_1' });
    await flush();
    expect(api.get).toHaveBeenCalledWith('/api/reviews/mine/sub_1');
    expect(host.querySelector('[data-testid="rate-done"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="rate-correction"]')).toBeNull();
    unmount();
  });

  it('keeps the page up when the API is down', async () => {
    api.post.mockRejectedValue(new Error('Network Error'));
    const { host, unmount } = mount({ submissionId: 'sub_1', compact: true });
    await flush();
    act(() => host.querySelector('[data-testid="rate-3"]').click());
    await act(async () => {
      host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[data-testid="rate-done"]')).toBeNull();
    expect(host.textContent).toContain('Network Error');
    unmount();
  });
});
