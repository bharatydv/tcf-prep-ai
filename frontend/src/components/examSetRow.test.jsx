/* A test card shows where the candidate stands on it: nothing yet, part way,
   or finished with the CLB level the paper converts to. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import { ExamSetCard, sittingResult } from './ExamSetRow';
import { speakingPaperMark } from '../lib/tcf';

const task = (level, score) => ({ tcf_level: level, overall_score: score });

describe('sittingResult', () => {
  it('is nothing for a set never sat', () => {
    expect(sittingResult({ set_number: 3, tasks: {} }, speakingPaperMark)).toBeNull();
  });

  it('counts the tâches done on a set part way through', () => {
    const sit = { set_number: 3, tasks: { 1: task('B1', 50), 2: task('B2', 60) } };
    expect(sittingResult(sit, speakingPaperMark)).toEqual({ state: 'partial', done: 2 });
  });

  it('gives a finished paper the mark and CLB the dashboard gives it', () => {
    const tasks = { 1: task('B2', 62), 2: task('B2', 60), 3: task('B2', 64) };
    const paper = speakingPaperMark([tasks[1], tasks[2], tasks[3]]);
    expect(sittingResult({ set_number: 3, tasks }, speakingPaperMark))
      .toEqual({ state: 'done', mark: paper.mark, nclc: paper.nclc });
  });
});

function mount(result) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider>
        <ExamSetCard set={{ set_number: 21, index: 1 }} title="Test 1" onOpen={() => {}}
          result={result} />
      </I18nProvider>,
    );
  });
  return { host, unmount: () => act(() => root.unmount()) };
}

describe('ExamSetCard', () => {
  it('shows that a finished paper is done, and the mark it earned', () => {
    const card = mount({ state: 'done', mark: 14, nclc: 8 });
    expect(card.host.querySelector('[data-state="done"]')).not.toBeNull();
    expect(card.host.textContent).toContain('Completed');
    expect(card.host.textContent).toContain('14/20');
    card.unmount();
  });

  /* A level belongs to the candidate, not to a paper.
     The card used to print the CLB band of whatever sitting it was, which
     reads as "this is your level" — and a level is the lowest of four skills
     across everything someone has done, which a card about one paper cannot
     know. The dashboard answers that; this card answers "how did this paper
     go". `sittingResult` still computes the band, so nothing downstream
     loses it. */
  it('never prints a CLB band, however the paper went', () => {
    const strong = mount({ state: 'done', mark: 18, nclc: '10+' });
    expect(strong.host.textContent).not.toContain('CLB');
    strong.unmount();

    const weak = mount({ state: 'done', mark: 3, nclc: null });
    expect(weak.host.textContent).not.toContain('CLB');
    expect(weak.host.textContent).toContain('3/20');
    weak.unmount();
  });

  it('shows how far a paper in progress has got', () => {
    const card = mount({ state: 'partial', done: 2 });
    expect(card.host.querySelector('[data-state="partial"]')).not.toBeNull();
    expect(card.host.textContent).toContain('2 of 3 tâches done');
    card.unmount();
  });

  it('shows the format on a set not sat yet', () => {
    const card = mount(null);
    expect(card.host.querySelector('[data-state="none"]')).not.toBeNull();
    expect(card.host.textContent).toContain('3 tâches');
    expect(card.host.textContent).not.toContain('CLB');
    card.unmount();
  });
});
