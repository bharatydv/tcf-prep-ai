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
  it('shows the CLB level and the mark of a finished paper', () => {
    const card = mount({ state: 'done', mark: 14, nclc: 8 });
    expect(card.host.querySelector('[data-state="done"]')).not.toBeNull();
    expect(card.host.textContent).toContain('CLB 8');
    expect(card.host.textContent).toContain('14/20');
    card.unmount();
  });

  it('says so when a finished paper is below CLB 4', () => {
    const card = mount({ state: 'done', mark: 3, nclc: null });
    expect(card.host.textContent).toContain('Below CLB 4');
    card.unmount();
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
