/* The card-side answer check.
 *
 * These mirror backend/tests/test_review_exercises.py::TestGrade on purpose:
 * the learner is told right or wrong here, and told it again by the server
 * when the session is submitted, and the two saying different things is worse
 * than either being wrong on its own.
 */
import { canon, loose, compare, expectedAnswer, judge, markSpan, shuffle } from './review';

const ITEM = {
  mistake_id: 'mst_1',
  error_text: 'je va',
  correction: 'je vais',
  forms: {
    mcq: { stem: 'Hier ____ au marché.', options: ['je vais', 'je va'], answer: 'je vais' },
    cloze: { stem: 'Hier ____ au marché.', answer: 'je vais' },
    spot: { segments: ['Hier', 'je va', 'au marché.'], answer_index: 1, answer: 'je va' },
    typeit: { context: 'Hier je va au marché.', prompt: 'je va', answer: 'je vais' },
    pair: { wrong: 'Hier je va au marché.', right: 'Hier je vais au marché.' },
    transfer: { stem: 'Demain nous ____ au cinéma.', answer: 'allons', hint: '' },
  },
};

describe('comparison forms', () => {
  it('canon ignores accents, case and punctuation', () => {
    expect(canon('À côté !')).toBe(canon('a cote'));
  });

  it('loose keeps accents but drops punctuation', () => {
    expect(loose('Vais.')).toBe('vais');
    expect(loose('où')).not.toBe(loose('ou'));
  });

  it('grades an accent slip as its own kind of near miss', () => {
    expect(compare('il a mange', 'il a mangé')).toBe('accent');
    expect(compare('il a mangé', 'il a mangé')).toBe('exact');
    expect(compare('il a mangeait', 'il a mangé')).toBe('no');
  });
});

describe('expectedAnswer', () => {
  it('is the correction for the multiple choice', () => {
    expect(expectedAnswer('mcq', ITEM)).toBe('je vais');
  });

  it('is the guilty segment for spot-the-error', () => {
    expect(expectedAnswer('spot', ITEM)).toBe('je va');
  });

  it('is the corrected sentence for the minimal pair', () => {
    expect(expectedAnswer('pair', ITEM)).toBe('Hier je vais au marché.');
  });

  it('is the drill answer, not the correction, for a rule transfer', () => {
    expect(expectedAnswer('transfer', ITEM)).toBe('allons');
  });
});

describe('markSpan', () => {
  it('finds the fragment it was given', () => {
    const [start, end] = markSpan('Hier je va au marché.', 'je va');
    expect('Hier je va au marché.'.slice(start, end)).toBe('je va');
  });

  it('does not underline part of a longer word', () => {
    // « je va » is a prefix of « je vais ».
    expect(markSpan('Je vais au marché.', 'je va')).toBeNull();
  });

  it('takes the standalone occurrence over the prefix of a longer one', () => {
    const sentence = 'Je vais au marché et je va à la gare.';
    const [start] = markSpan(sentence, 'je va');
    expect(sentence.slice(0, start)).toBe('Je vais au marché et ');
  });

  it('survives a fragment full of regex characters', () => {
    expect(() => markSpan('Il a dit (bonjour).', '(bonjour)')).not.toThrow();
    expect(markSpan('Il a dit (bonjour).', '(bonjour)')).not.toBeNull();
  });

  it('returns null rather than guessing when the fragment is absent', () => {
    expect(markSpan('Hier je va au marché.', 'nous allons')).toBeNull();
  });
});

describe('judge', () => {
  it('accepts a clicked option regardless of its accents', () => {
    // Nobody types on an MCQ; the option was rendered with its accents.
    expect(judge('mcq', ITEM, 'je vais').correct).toBe(true);
    expect(judge('mcq', ITEM, 'je va').correct).toBe(false);
  });

  it('marks a typed answer missing an accent wrong, and says which kind', () => {
    const item = { ...ITEM, correction: 'il a mangé', forms: { cloze: { stem: '____', answer: 'il a mangé' } } };
    expect(judge('cloze', item, 'il a mange')).toEqual({ correct: false, accentOnly: true });
  });

  it('forgives case and punctuation on a typed answer', () => {
    expect(judge('cloze', ITEM, ' Je vais. ').correct).toBe(true);
  });

  it('never counts an empty answer', () => {
    expect(judge('typeit', ITEM, '').correct).toBe(false);
  });
});

describe('shuffle', () => {
  it('keeps every member exactly once', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffle(input).sort()).toEqual(input);
  });

  it('does not mutate its argument', () => {
    const input = ['a', 'b', 'c'];
    shuffle(input);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('puts the first element somewhere other than first at least sometimes', () => {
    // A shuffle that never moves anything would pass the two tests above.
    const moved = Array.from({ length: 200 }, () => shuffle(['a', 'b', 'c'])[0]);
    expect(new Set(moved).size).toBe(3);
  });
});
