/* Finding a correction's phrase inside the recording's word timings.
 *
 * The negative cases carry the weight. A wrong answer here is not an error —
 * it is a button that plays somebody two seconds of a sentence they were not
 * asking about, which teaches them the wrong thing with total confidence.
 */
import { findClip, hasTimings } from './speechClips';

// « je vais répondre aux questions des clients et je fais certaines tâches »
const WORDS = [
  { t: 'je', s: 1000, e: 1120 },
  { t: 'vais', s: 1120, e: 1300 },
  { t: 'répondre', s: 1300, e: 1800 },
  { t: 'aux', s: 1800, e: 1950 },
  { t: 'questions', s: 1950, e: 2500 },
  { t: 'des', s: 2500, e: 2620 },
  { t: 'clients', s: 2620, e: 3100 },
  { t: 'et', s: 3400, e: 3500 },
  { t: 'je', s: 3500, e: 3620 },
  { t: 'fais', s: 3620, e: 3900 },
  { t: 'certaines', s: 3900, e: 4400 },
  { t: 'tâches', s: 4400, e: 4900 },
];

describe('findClip', () => {
  it('finds a phrase and pads it a little', () => {
    const clip = findClip(WORDS, 'je vais répondre aux questions des clients');
    expect(clip.start).toBeCloseTo(0.92, 2);   // 1000ms, less 80ms
    expect(clip.end).toBeCloseTo(3.25, 2);     // 3100ms, plus 150ms
  });

  it('starts at the right « je » when the word repeats', () => {
    const clip = findClip(WORDS, 'je fais certaines tâches');
    expect(clip.start).toBeCloseTo(3.42, 2);   // the second « je », not the first
  });

  it('matches through punctuation and capitals the grader added', () => {
    const clip = findClip(WORDS, 'Je vais répondre, aux questions.');
    expect(clip.start).toBeCloseTo(0.92, 2);
  });

  it('tolerates a word the grader did not quote exactly', () => {
    const clip = findClip(WORDS, 'je vais répondre aux clients');
    expect(clip).not.toBeNull();
    expect(clip.end).toBeCloseTo(3.25, 2);
  });

  it('refuses a phrase that is not in the recording', () => {
    expect(findClip(WORDS, 'bonjour madame comment allez-vous')).toBeNull();
  });

  it('refuses when only a stray word lines up', () => {
    // 'je' matches; nothing else does. One word in five is a guess.
    expect(findClip(WORDS, 'je pourrais visiter Paris demain')).toBeNull();
  });

  it('refuses rather than spanning half the answer', () => {
    // First and last word both appear, but twenty words apart.
    const spread = [
      { t: 'je', s: 0, e: 100 },
      ...Array.from({ length: 20 }, (_, i) => ({ t: `mot${i}`, s: 200 + i * 100, e: 290 + i * 100 })),
      { t: 'clients', s: 5000, e: 5400 },
    ];
    expect(findClip(spread, 'je clients')).toBeNull();
  });

  it('returns null for missing or empty input', () => {
    expect(findClip([], 'je vais')).toBeNull();
    expect(findClip(WORDS, '')).toBeNull();
    expect(findClip(null, 'je vais')).toBeNull();
    expect(findClip(undefined, undefined)).toBeNull();
  });

  it('ignores words with no usable timing', () => {
    const broken = [{ t: 'je', s: null, e: 100 }, { t: 'vais', s: 'x', e: 200 }];
    expect(findClip(broken, 'je vais')).toBeNull();
  });
});

describe('hasTimings', () => {
  it('is true only for a non-empty list', () => {
    expect(hasTimings(WORDS)).toBe(true);
    expect(hasTimings([])).toBe(false);
    expect(hasTimings(undefined)).toBe(false);
  });
});
