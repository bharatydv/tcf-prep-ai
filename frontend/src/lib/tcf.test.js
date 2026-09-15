/* The mark out of 20 is now the only score the app shows, so the conversion
   is the one place a rounding slip would rewrite every number on screen. */
import { markOutOf20, displayMark, markFromCorrect, nclcFromMark } from './tcf';

describe('markOutOf20', () => {
  it('places a score inside the band of the level it was given', () => {
    expect(markOutOf20(55, 'B2')).toBe(10); // floor of B2
    expect(markOutOf20(69, 'B2')).toBe(13); // ceiling of B2
    expect(markOutOf20(40, 'B1')).toBe(7);
    expect(markOutOf20(100, 'C2')).toBe(20);
  });

  it('never contradicts the level beside it', () => {
    // 69/100 is the top of B2. A plain fifth would call it 14, which the
    // official table reads as NCLC 9 — a level above the one shown beside it.
    expect(markOutOf20(69, 'B2')).toBeLessThan(14);
    expect(nclcFromMark(markOutOf20(69, 'B2'))).toBe('8');
  });

  it('clamps a score that falls outside its own level', () => {
    expect(markOutOf20(95, 'B1')).toBe(9);
    expect(markOutOf20(5, 'B1')).toBe(7);
  });

  it('returns null rather than a number it cannot anchor', () => {
    expect(markOutOf20(60, 'Z9')).toBeNull();
    expect(markOutOf20('n/a', 'B2')).toBeNull();
    // Number(null) is 0, and clamping 0 into B2 would have invented a 10.
    expect(markOutOf20(null, 'B2')).toBeNull();
    expect(markOutOf20('', 'B2')).toBeNull();
  });
});

describe('displayMark', () => {
  it('prefers the anchored mark', () => {
    expect(displayMark(69, 'B2')).toBe(13);
  });

  it('falls back to a plain fifth when no level came back', () => {
    expect(displayMark(60, null)).toBe(12);
    expect(displayMark(60, undefined)).toBe(12);
  });

  it('gives null when there is no number at all, so callers can dash it', () => {
    expect(displayMark(null, 'B2')).toBeNull();
    expect(displayMark(undefined, null)).toBeNull();
  });
});

describe('markFromCorrect', () => {
  it('puts right answers on the same scale as a graded answer', () => {
    expect(markFromCorrect(34, 40)).toBe(17);
    expect(markFromCorrect(0, 39)).toBe(0);
    expect(markFromCorrect(39, 39)).toBe(20);
  });

  it('gives null for a paper with no questions rather than dividing by zero', () => {
    expect(markFromCorrect(0, 0)).toBeNull();
    expect(markFromCorrect(3, null)).toBeNull();
  });
});
