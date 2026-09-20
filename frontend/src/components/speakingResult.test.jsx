/* The speaking result page, mounted.
 *
 * It grew from a correction table into a report with eleven sections, most of
 * which are conditional on data that is frequently absent — no history on a
 * first attempt, no timings from most transcription providers, no `kind` or
 * `remember` on every result graded before those fields existed. Each of
 * those absences is a blank page or a crash if it is handled wrong, and none
 * of them is visible in a build that compiles.
 *
 * Same approach as reviewExercises.test.jsx: no @testing-library, which is not
 * a dependency here — react-dom/client with act() mounts the thing and the
 * DOM is read directly.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import { SpeakingResult, rankErrors } from './SpeakingResult';
import { topPriorities } from './speakingReport';

const TTS = { speak: () => {}, stop: () => {}, speakingId: null, supported: false };

const RESULT = {
  overall_score: 45,
  tcf_level: 'B1',
  submission_id: 'sub_1',
  has_audio: false,
  transcript: "j'habite au Toronto et je vais répondre aux questions des clients",
  corrected_version: "j'habite à Toronto et je réponds aux questions des clients",
  enhanced_version: "Je réside à Toronto et je réponds quotidiennement aux clients.",
  strengths: ['You answered the task directly.', 'You used several connectors.'],
  focus_areas: ['Subject-verb agreement', 'Common prepositions'],
  suggestions: ['Slow down at the start of each idea.'],
  vocabulary_suggestions: ['être en contact avec', 'présenter des avantages'],
  criteria: { linguistic: { score: 45, comment: 'x' } },
  errors: [
    {
      error: "j'habite au Toronto", correction: "j'habite à Toronto",
      category: 'prepositions', severity: 'moderate', kind: 'error',
      explanation: 'With a city you need à.', remember: 'à + ville, au + pays masculin',
    },
    {
      error: "c'est très important", correction: 'cela revêt une importance particulière',
      category: 'improvement', severity: 'minor', kind: 'upgrade',
      explanation: 'Your sentence is correct; this is more formal.',
      remember: 'Reach for advanced phrasing only once the basics hold.',
    },
    {
      error: 'je vais répondre', correction: 'je réponds',
      category: 'conjugation', severity: 'major', kind: 'error',
      explanation: 'A daily habit takes the present tense.',
      remember: 'Habit -> présent, not futur proche',
    },
  ],
  history: {
    recurring: [{ category: 'conjugation', times: 4,
      example: { error: 'les gens est', correction: 'les gens sont' } }],
    previous: { score: 38, level: 'A2', errors: 7, at: '2026-09-01T00:00:00Z' },
  },
};

function mount(result) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider>
        <SpeakingResult result={result} tts={TTS} />
      </I18nProvider>,
    );
  });
  return {
    host,
    text: () => host.textContent,
    find: (id) => host.querySelector(`[data-testid="${id}"]`),
    unmount: () => act(() => root.unmount()),
  };
}

describe('SpeakingResult', () => {
  it('opens with the result, not with the errors', () => {
    const page = mount(RESULT);
    const hero = page.find('result-hero');
    expect(hero).not.toBeNull();
    // The mark out of 20, the level and the CLB band.
    expect(hero.textContent).toMatch(/\/20/);
    expect(hero.textContent).toMatch(/B1/);
    expect(hero.textContent).toMatch(/CLB/);
    page.unmount();
  });

  it('shows what went well before what went wrong', () => {
    const page = mount(RESULT);
    const html = page.host.innerHTML;
    const wentWell = html.indexOf('data-testid="did-well"');
    const corrections = html.indexOf('data-testid="corrections-table"');
    expect(wentWell).toBeGreaterThan(-1);
    expect(corrections).toBeGreaterThan(-1);
    // The order is the product decision this page exists to make.
    expect(wentWell).toBeLessThan(corrections);
    page.unmount();
  });

  it('counts priorities from real mistakes only, never from style', () => {
    const page = mount(RESULT);
    const box = page.find('top-priorities');
    expect(box.textContent).toMatch(/Conjugaison/);
    expect(box.textContent).toMatch(/Prépositions/);
    // The 'improvement'/'upgrade' row must not become a thing to go and fix.
    expect(box.textContent).not.toMatch(/Améliorations/);
    page.unmount();
  });

  it('renders the Remember column', () => {
    const page = mount(RESULT);
    expect(page.text()).toMatch(/à \+ ville, au \+ pays masculin/);
    page.unmount();
  });

  it('shows the three row states', () => {
    const page = mount(RESULT);
    const text = page.text();
    expect(text).toMatch(/Error/);
    expect(text).toMatch(/Upgrade/);
    page.unmount();
  });

  it('shows recurring mistakes and progress when there is history', () => {
    const page = mount(RESULT);
    expect(page.find('recurring-mistakes').textContent).toMatch(/4 times/);
    const progress = page.find('attempt-progress');
    expect(progress).not.toBeNull();
    expect(progress.textContent).toMatch(/Improved by/);
    page.unmount();
  });

  it('leaves history out on a first attempt instead of inventing it', () => {
    const page = mount({ ...RESULT, history: {} });
    expect(page.find('recurring-mistakes')).toBeNull();
    expect(page.find('attempt-progress')).toBeNull();
    // and the rest of the page is still there
    expect(page.find('result-hero')).not.toBeNull();
    page.unmount();
  });

  it('renders a result graded before kind and remember existed', () => {
    const old = {
      ...RESULT,
      history: {},
      errors: RESULT.errors.map(({ error, correction, category, explanation }) => ({
        error, correction, category, explanation,
      })),
    };
    const page = mount(old);
    expect(page.find('result-hero')).not.toBeNull();
    expect(page.text()).toMatch(/j'habite/);
    page.unmount();
  });

  it('survives a result with nothing in it', () => {
    const page = mount({ overall_score: 0, tcf_level: 'A1', errors: [] });
    expect(page.find('result-hero')).not.toBeNull();
    page.unmount();
  });

  it('hides the transcript for tâches 1 and 2', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider>
          <SpeakingResult result={RESULT} tts={TTS} taskType={1} />
        </I18nProvider>,
      );
    });
    expect(host.querySelector('[data-testid="transcript-diff"]')).toBeNull();
    expect(host.querySelector('[data-testid="transcript-withheld"]')).not.toBeNull();
    act(() => root.unmount());
  });
});

describe('rankErrors', () => {
  it('puts real mistakes above style, and major above minor', () => {
    const order = rankErrors(RESULT.errors).map((r) => r.e.category);
    expect(order).toEqual(['conjugation', 'prepositions', 'improvement']);
  });

  it('keeps the order they were said when nothing separates two rows', () => {
    const rows = [
      { error: 'a', kind: 'error', severity: 'major' },
      { error: 'b', kind: 'error', severity: 'major' },
    ];
    expect(rankErrors(rows).map((r) => r.e.error)).toEqual(['a', 'b']);
  });

  it('treats an unlabelled row as a mistake, not as an upgrade', () => {
    const rows = [
      { error: 'style', kind: 'upgrade' },
      { error: 'old row with no kind' },
    ];
    expect(rankErrors(rows)[0].e.error).toBe('old row with no kind');
  });

  it('survives no errors at all', () => {
    expect(rankErrors(undefined)).toEqual([]);
  });
});

describe('topPriorities', () => {
  it('returns at most three, worst first', () => {
    const errors = [
      ...Array.from({ length: 4 }, () => ({ category: 'conjugation', kind: 'error' })),
      ...Array.from({ length: 2 }, () => ({ category: 'prepositions', kind: 'error' })),
      { category: 'spelling', kind: 'error' },
      { category: 'anglicism', kind: 'error' },
    ];
    const out = topPriorities(errors);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ category: 'conjugation', count: 4 });
    expect(out[1]).toEqual({ category: 'prepositions', count: 2 });
  });

  it('never counts a style suggestion as something to fix', () => {
    expect(topPriorities([
      { category: 'improvement', kind: 'better' },
      { category: 'conjugation', kind: 'upgrade' },
    ])).toEqual([]);
  });
});
