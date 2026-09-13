/* Does each card actually render, and does it render the right thing.
 *
 * The rule this file exists to hold: the answer must never be legible on the
 * card before it is answered. That was the shipped bug — the stem WAS one of
 * the options — and it is the kind of bug that unit tests on the builder
 * cannot see, because the builder was not the part putting it on screen.
 *
 * No @testing-library here: it is not a dependency of this project, and
 * react-dom/client with act() is enough to mount a card and click it.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import { ExerciseCard } from './reviewExercises';

const SENTENCE = 'Hier je va au marché avec mes amis.';
const CORRECTED = 'Hier je vais au marché avec mes amis.';

const ITEM = {
  mistake_id: 'mst_1',
  category: 'conjugation',
  error_text: 'je va',
  correction: 'je vais',
  explanation: 'aller is irregular: the first person singular is « vais ».',
  context_sentence: SENTENCE,
  times_repeated: 2,
  forms: {
    mcq: { stem: 'Hier ____ au marché avec mes amis.', options: ['je vais', 'je va', "j'allais"], answer: 'je vais' },
    cloze: { stem: 'Hier ____ au marché avec mes amis.', answer: 'je vais' },
    spot: { segments: ['Hier', 'je va', 'au marché avec mes amis.'], answer_index: 1, answer: 'je va' },
    typeit: { context: SENTENCE, prompt: 'je va', answer: 'je vais' },
    pair: { wrong: SENTENCE, right: CORRECTED },
    transfer: { stem: 'Demain nous ____ au cinéma.', answer: 'allons', hint: 'aller, nous' },
  },
};

let container;
let root;

function mount(ui) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<I18nProvider initialLang="en">{ui}</I18nProvider>); });
  return container;
}

function card(mode, props = {}) {
  return mount(<ExerciseCard mode={mode} item={ITEM} onAnswer={() => {}} {...props} />);
}

function click(el) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function buttons(el, testid) {
  return [...el.querySelectorAll(`[data-testid="${testid}"]`)];
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

const MODES = ['flashcards', 'mcq', 'sprint', 'cloze', 'spot', 'typeit', 'pair', 'transfer'];

describe('every mode', () => {
  it.each(MODES)('%s renders without crashing', (mode) => {
    expect(card(mode).textContent.length).toBeGreaterThan(10);
  });

  it.each(MODES)('%s uses no missing translation keys', (mode) => {
    // A key with no string renders as the key itself.
    expect(card(mode).textContent).not.toMatch(/rev\.[a-zA-Z]/);
  });

  // An option may of course print the answer — that is what an option is.
  // What must never happen is the STEM printing it, which is the shipped bug
  // in its general form: the question giving away its own answer.
  it.each([['mcq', 'je vais'], ['cloze', 'je vais'], ['transfer', 'allons']])(
    'the %s stem never contains the answer', (mode, answer) => {
      const stem = card(mode).querySelector('[data-testid="exercise-stem"]');
      expect(stem.textContent).not.toContain(answer);
    });

  it.each(['mcq', 'spot', 'pair'])(
    'nothing on a %s card is marked right or wrong before it is answered', (mode) => {
      const html = card(mode).innerHTML;
      expect(html).not.toContain('bg-green-50');
      expect(html).not.toContain('bg-red-50');
    });

  it.each(['mcq', 'cloze', 'spot', 'typeit', 'pair', 'transfer'])(
    '%s keeps the explanation back until the card is answered', (mode) => {
      expect(card(mode).textContent).not.toContain('aller is irregular');
    });

  it('renders nothing rather than throwing when the form is missing', () => {
    const bare = { ...ITEM, forms: {} };
    const el = mount(<ExerciseCard mode="spot" item={bare} onAnswer={() => {}} />);
    expect(el.textContent).toBe('');
  });
});

describe('choose the correct form', () => {
  it('shows the blank instead of the learner’s wrong form', () => {
    const el = card('mcq');
    const stem = el.querySelector('[data-testid="exercise-stem"]').textContent;
    expect(stem).toContain('Hier');
    expect(stem).not.toContain('je va');
  });

  it('offers all three options', () => {
    expect(buttons(card('mcq'), 'mcq-option')).toHaveLength(3);
  });

  it('reveals the explanation once an option is taken', () => {
    const el = card('mcq');
    expect(el.querySelector('[data-testid="exercise-reveal"]')).toBeNull();
    click(buttons(el, 'mcq-option')[0]);
    const reveal = el.querySelector('[data-testid="exercise-reveal"]');
    expect(reveal.textContent).toContain('aller is irregular');
  });

  it('reports the answer it was given, right or wrong', () => {
    const el = card('mcq');
    const right = buttons(el, 'mcq-option').find((b) => b.textContent === 'je vais');
    click(right);
    expect(el.querySelector('[data-testid="exercise-reveal"]').textContent).toContain('Correct');
  });

  it('hands the picked option back on Next', () => {
    const seen = [];
    const el = mount(<ExerciseCard mode="mcq" item={ITEM} onAnswer={(a) => seen.push(a)} />);
    click(buttons(el, 'mcq-option').find((b) => b.textContent === 'je va'));
    click(el.querySelector('[data-testid="review-next"]'));
    expect(seen).toEqual([{ answer: 'je va', note: undefined }]);
  });

  it('does not wait for Next in the sprint', () => {
    jest.useFakeTimers();
    const seen = [];
    const el = mount(<ExerciseCard mode="sprint" item={ITEM} sprint onAnswer={(a) => seen.push(a)} />);
    click(buttons(el, 'mcq-option')[0]);
    expect(el.querySelector('[data-testid="exercise-reveal"]')).toBeNull();
    act(() => { jest.advanceTimersByTime(800); });
    expect(seen).toHaveLength(1);
    jest.useRealTimers();
  });
});

describe('find the mistake', () => {
  it('lays the sentence out in clickable pieces', () => {
    const segs = buttons(card('spot'), 'spot-segment').map((b) => b.textContent);
    expect(segs).toEqual(['Hier', 'je va', 'au marché avec mes amis.']);
  });

  it('does not mark the guilty piece before it is clicked', () => {
    const el = card('spot');
    expect(el.innerHTML).not.toContain('bg-green-50');
    click(buttons(el, 'spot-segment')[1]);
    expect(el.innerHTML).toContain('bg-green-50');
  });
});

describe('spot the difference', () => {
  it('shows both sentences and asks for a reason before revealing', () => {
    const el = card('pair');
    expect(buttons(el, 'pair-side')).toHaveLength(2);
    expect(el.querySelector('[data-testid="pair-why"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="exercise-reveal"]')).toBeNull();
  });

  it('caps the reason at what the API accepts', () => {
    expect(card('pair').querySelector('[data-testid="pair-why"]').maxLength).toBe(600);
  });
});

describe('the typed cards', () => {
  it.each([['cloze', 'cloze-input'], ['typeit', 'typeit-input'], ['transfer', 'transfer-input']])(
    '%s will not submit an empty answer', (mode, testid) => {
      const el = card(mode);
      expect(el.querySelector(`[data-testid="${testid}"]`)).not.toBeNull();
      expect(el.querySelector('[data-testid="check-button"]').disabled).toBe(true);
    });

  it('tells the learner when only the accent was missing', () => {
    const accented = {
      ...ITEM,
      correction: 'il a mangé',
      explanation: 'After avoir the participle takes -é.',
      forms: { cloze: { stem: '____ une pomme.', answer: 'il a mangé' } },
    };
    const el = mount(<ExerciseCard mode="cloze" item={accented} onAnswer={() => {}} />);
    const input = el.querySelector('[data-testid="cloze-input"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'il a mange');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(el.querySelector('[data-testid="check-button"]'));
    const reveal = el.querySelector('[data-testid="exercise-reveal"]').textContent;
    expect(reveal).toContain('wrong accent');
    expect(reveal).toContain('il a mangé');
  });
});

describe('same rule, new sentence', () => {
  it('names the mistake it was built from, but only after the answer', () => {
    const el = card('transfer');
    expect(el.textContent).not.toContain('je vais');
    const input = el.querySelector('[data-testid="transfer-input"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'allons');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(el.querySelector('[data-testid="check-button"]'));
    expect(el.querySelector('[data-testid="exercise-reveal"]').textContent).toContain('je vais');
  });
});
