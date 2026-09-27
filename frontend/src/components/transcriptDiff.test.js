/* The span matcher behind the side-by-side view.
 *
 * All of the logic in TranscriptDiff is here, and it is the kind that fails
 * quietly: a marked span one word out still looks like a marked span, so a
 * candidate reads the wrong half of their sentence as the mistake and nothing
 * anywhere says otherwise.
 */
import { markSpans, candidateText, diffWords } from './TranscriptDiff';

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

describe('candidateText', () => {
  it("keeps only the candidate's lines of a dialogue", () => {
    const dialogue = [
      'Agent : Bonjour, je vous écoute.',
      'Candidat : Bonjour, je voudrais des informations.',
      'Agent : Bien sûr.',
      'Candidat : Quel est le prix ?',
    ].join('\n');
    expect(candidateText(dialogue)).toBe(
      ['Bonjour, je voudrais des informations.', 'Quel est le prix ?'].join('\n'));
  });

  it('leaves a monologue as it is', () => {
    expect(candidateText('Je pense que le stress motive.')).toBe('Je pense que le stress motive.');
  });

  it('is empty for nothing', () => {
    expect(candidateText(null)).toBe('');
  });
});

describe('diffWords', () => {
  it('marks the changed words on both sides and nothing else', () => {
    const d = diffWords("J'ai allé à Paris hier.", 'Je suis allé à Paris hier.');
    expect(marked(d.said)).toEqual(["J'ai"]);
    expect(marked(d.fixed)).toEqual(['Je suis']);
  });

  it('never loses or duplicates a character on either side', () => {
    const said = 'Je habite au Toronto depuis deux ans,  et je travaille.';
    const fixed = "J'habite à Toronto depuis deux ans, et je travaille.";
    const d = diffWords(said, fixed);
    expect(rebuild(d.said)).toBe(said);
    expect(rebuild(d.fixed)).toBe(fixed);
  });

  it('does not mark case or punctuation differences', () => {
    const d = diffWords('bonjour madame', 'Bonjour, madame.');
    expect(marked(d.said)).toEqual([]);
    expect(marked(d.fixed)).toEqual([]);
  });

  it('marks words that were added', () => {
    const d = diffWords('je vais Paris', 'je vais à Paris');
    expect(marked(d.said)).toEqual([]);
    expect(marked(d.fixed)).toEqual(['à']);
  });

  it('marks nothing when the answer was already right', () => {
    const d = diffWords('Tout va bien.', 'Tout va bien.');
    expect(marked(d.said)).toEqual([]);
    expect(marked(d.fixed)).toEqual([]);
  });
});
