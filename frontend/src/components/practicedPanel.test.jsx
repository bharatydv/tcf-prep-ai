/* A practised tâche, mounted: what it claims about the attempt on file, and
 * what it does when asked for the mistakes behind it.
 *
 * The network is a jest mock, so this also pins the one thing the panel
 * promises about cost: the corrections of an attempt are fetched once, and a
 * grade handed over the moment it lands is never fetched at all.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import PracticedPanel from './PracticedPanel';
import { displayMark, nclcFromMark } from '../lib/tcf';

jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errMsg: (e) => String(e?.message || e),
}));
const { api } = require('../lib/api');

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

/* "How was this correction?" has a suite of its own and a fetch of its own;
   here it would only answer questions this file is not asking. */
jest.mock('./RateCorrection', () => ({ __esModule: true, default: () => null }));

const attempt = (id, level, score, when, errors = 0) => ({
  submission_id: id, tcf_level: level, overall_score: score,
  created_at: when, error_count: errors, question_id: 'q1', task_type: 3,
});

/* A full result as /api/submissions/{id} serves one: the columns, plus the
   stored analysis merged over them. */
const submission = (id, said) => ({
  submission_id: id,
  tcf_level: 'B2',
  overall_score: 62,
  transcript: said,
  errors: [{ error: 'allé a Paris', correction: 'allé à Paris',
             explanation: 'accent grave on the preposition',
             category: 'spelling', kind: 'error', severity: 'minor' }],
  criteria: {},
  strengths: [],
  focus_areas: [],
  suggestions: [],
  vocabulary_suggestions: [],
});

function mount(props) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider>
        <PracticedPanel tacheNum={3} testid="p" {...props} />
      </I18nProvider>,
    );
  });
  return { host, unmount: () => act(() => { root.unmount(); host.remove(); }) };
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});
const click = (el) => act(() => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});

describe('PracticedPanel', () => {
  it('renders nothing on a tâche never practised', () => {
    const { host, unmount } = mount({ attempts: [] });
    expect(host.innerHTML).toBe('');
    expect(api.get).not.toHaveBeenCalled();
    unmount();
  });

  it('reports the latest attempt as practised, with its mark and CLB band', () => {
    const rows = [attempt('s2', 'B2', 62, '2026-10-02T09:00:00Z'),
                  attempt('s1', 'B1', 48, '2026-09-30T09:00:00Z')];
    const { host, unmount } = mount({ attempts: rows });
    const mark = displayMark(62, 'B2');
    expect(host.textContent).toContain('Practiced');
    expect(host.textContent).toContain(`B2 · ${mark}/20`);
    expect(host.querySelector('[data-testid="p-clb"]').textContent)
      .toBe(`CLB ${nclcFromMark(mark)}`);
    // The newest attempt is the standing grade; the older B1 is behind it.
    expect(host.textContent).not.toContain('B1 · ');
    unmount();
  });

  it('says so when the mark converts to nothing the official table publishes', () => {
    const { host, unmount } = mount({
      attempts: [attempt('s1', 'A1', 10, '2026-10-02T09:00:00Z')],
    });
    expect(host.querySelector('[data-testid="p-clb"]').textContent).toBe('Below CLB 4');
    unmount();
  });

  it('fetches the corrections the first time they are opened, and keeps them', async () => {
    api.get.mockResolvedValue({ data: { submission: submission('s1', 'allé a Paris') } });
    const { host, unmount } = mount({
      attempts: [attempt('s1', 'B2', 62, '2026-10-02T09:00:00Z', 1)],
    });

    expect(api.get).not.toHaveBeenCalled();
    click(host.querySelector('[data-testid="p-review"]'));
    await flush();

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/submissions/s1');
    expect(host.textContent).toContain('allé à Paris');

    // Closed and opened again: the result is in hand and is not re-fetched.
    click(host.querySelector('[data-testid="p-review"]'));
    click(host.querySelector('[data-testid="p-review"]'));
    await flush();
    expect(api.get).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('shows a grade handed straight over without asking the server for it', async () => {
    const fresh = { ...submission('new', 'je voudrais reserver une table'),
                    submission_id: 'new' };
    const { host, unmount } = mount({ attempts: [], fresh });
    await flush();
    // Open on arrival: the answer was just given, and this is the moment its
    // corrections are wanted.
    expect(host.textContent).toContain('je voudrais reserver une table');
    expect(api.get).not.toHaveBeenCalled();
    unmount();
  });

  it('offers the attempt just graded as a row before the server lists it', async () => {
    const fresh = { ...submission('new', 'ce que je viens de dire'),
                    submission_id: 'new' };
    const { host, unmount } = mount({
      attempts: [attempt('s1', 'B1', 48, '2026-09-30T09:00:00Z')], fresh,
    });
    await flush();
    // Two attempts: the one on file and the one just marked, newest first.
    expect(host.textContent).toContain('2 attempts so far');
    expect(host.textContent).toContain('Attempt 2');
    expect(host.textContent).toContain('Attempt 1');
    unmount();
  });

  it('opens an earlier attempt when one is chosen, leaving the newest alone', async () => {
    api.get.mockResolvedValue({ data: { submission: submission('s2', 'la derniere fois') } });
    const rows = [attempt('s2', 'B2', 62, '2026-10-02T09:00:00Z'),
                  attempt('s1', 'B1', 48, '2026-09-30T09:00:00Z')];
    const { host, unmount } = mount({ attempts: rows });

    click(host.querySelector('[data-testid="p-review"]'));
    await flush();
    expect(api.get).toHaveBeenCalledWith('/api/submissions/s2');

    api.get.mockResolvedValue({ data: { submission: submission('s1', 'ce que je disais avant') } });
    click(host.querySelector('[data-testid="p-attempts-open-s1"]'));
    await flush();

    expect(api.get).toHaveBeenCalledWith('/api/submissions/s1');
    expect(host.textContent).toContain('ce que je disais avant');
    // The chosen row says it is the one on screen, so comparing two attempts
    // does not lose your place.
    expect(host.querySelector('[data-testid="p-attempts-open-s1"]').textContent)
      .toContain('Showing');
    unmount();
  });

  it('keeps what is on screen when an attempt cannot be opened', async () => {
    api.get.mockResolvedValue({ data: { submission: submission('s2', 'la bonne reponse') } });
    const rows = [attempt('s2', 'B2', 62, '2026-10-02T09:00:00Z'),
                  attempt('s1', 'B1', 48, '2026-09-30T09:00:00Z')];
    const { host, unmount } = mount({ attempts: rows });
    click(host.querySelector('[data-testid="p-review"]'));
    await flush();
    expect(host.textContent).toContain('la bonne reponse');

    api.get.mockRejectedValue(new Error('offline'));
    click(host.querySelector('[data-testid="p-attempts-open-s1"]'));
    await flush();
    // Not a spinner over a result that is never going to arrive.
    expect(host.textContent).toContain('la bonne reponse');
    expect(host.textContent).not.toContain('Opening your attempt');
    unmount();
  });

  it('practising again is offered inside the mistakes, not over them', async () => {
    api.get.mockResolvedValue({ data: { submission: submission('s1', 'allé a Paris') } });
    const onAgain = jest.fn();
    const { host, unmount } = mount({
      attempts: [attempt('s1', 'B2', 62, '2026-10-02T09:00:00Z')], onAgain,
    });

    expect(host.querySelector('[data-testid="p-attempts-retake"]')).toBeNull();
    click(host.querySelector('[data-testid="p-review"]'));
    await flush();

    const again = host.querySelector('[data-testid="p-attempts-retake"]');
    expect(again.textContent).toContain('Practice again');
    click(again);
    expect(onAgain).toHaveBeenCalledTimes(1);
    unmount();
  });
});
