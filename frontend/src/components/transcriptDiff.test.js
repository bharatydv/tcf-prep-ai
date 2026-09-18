/* The span matcher behind the side-by-side view.
 *
 * All of the logic in TranscriptDiff is here, and it is the kind that fails
 * quietly: a marked span one word out still looks like a marked span, so a
 * candidate reads the wrong half of their sentence as the mistake and nothing
 * anywhere says otherwise.
 */
import { markSpans } from './TranscriptDiff';

const marked = (parts) => parts.filter((p) => p.marked).map((p) => p.text);
const rebuild = (parts) => parts.map((p) => p.text).join('');

describe('markSpans', () => {
  it('marks a needle and leaves the rest alone', () => {
    const parts = markSpans("j'habite au Toronto", ['au Toronto']);
    expect(marked(parts)).toEqual(['au Toronto']);
    expect(parts[0]).toEqual({ text: "j'habite ", marked: false });
  });

  it('never loses or duplicates a character', () => {
    const text = 'je suis origine au monde et je travaille beaucoup';
    const parts = markSpans(text, ['je suis origine', 'beaucoup']);
    expect(rebuild(parts)).toBe(text);
  });

  it('marks several needles, in the order they appear', () => {
    const parts = markSpans('un deux trois quatre', ['trois', 'un']);
    expect(marked(parts)).toEqual(['un', 'trois']);
  });

  it('marks only the first occurrence of a repeated needle', () => {
    /* The grader named one of them and has no way to say which. Marking both
       claims it made two corrections when it made one. */
    const parts = markSpans('le chat et le chien', ['le']);
    expect(marked(parts)).toEqual(['le']);
  });

  it('refuses to nest overlapping spans', () => {
    const parts = markSpans('je suis originaire', ['je suis originaire', 'suis']);
    expect(marked(parts)).toEqual(['je suis originaire']);
  });

  it('skips a needle that is not in the text', () => {
    /* Routine, not exceptional: the grader quotes what it heard, and the
       transcript it is quoting has been through a recogniser. */
    const parts = markSpans('bonjour madame', ['bonsoir']);
    expect(marked(parts)).toEqual([]);
    expect(rebuild(parts)).toBe('bonjour madame');
  });

  it('ignores blank and missing needles', () => {
    const parts = markSpans('bonjour', ['', '   ', null, undefined]);
    expect(marked(parts)).toEqual([]);
  });

  it('handles accents and apostrophes as ordinary characters', () => {
    const parts = markSpans("l'élève a réussi", ["l'élève"]);
    expect(marked(parts)).toEqual(["l'élève"]);
  });

  it('returns nothing for empty text', () => {
    expect(markSpans('', ['x'])).toEqual([]);
    expect(markSpans(null, ['x'])).toEqual([]);
  });

  it('returns the whole text unmarked when there are no needles', () => {
    expect(markSpans('bonjour', [])).toEqual([{ text: 'bonjour', marked: false }]);
    expect(markSpans('bonjour', undefined)).toEqual([{ text: 'bonjour', marked: false }]);
  });

  it('marks a needle sitting at either end', () => {
    expect(marked(markSpans('alpha beta', ['alpha']))).toEqual(['alpha']);
    expect(marked(markSpans('alpha beta', ['beta']))).toEqual(['beta']);
    expect(markSpans('alpha', ['alpha'])).toEqual([{ text: 'alpha', marked: true }]);
  });
});
