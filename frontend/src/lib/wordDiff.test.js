/* The word diff behind the corrections table.
 *
 * Worth testing rather than eyeballing: the failure mode is not a crash but a
 * sentence with the wrong half marked, which looks perfectly normal until you
 * read the French — and the whole point of the table is that the reader can
 * trust the colour.
 */
import { diffWords } from './wordDiff';

// What a reader would see: the coloured text, and the plain text, separately.
const changed = (parts) => parts.filter((p) => p.changed).map((p) => p.text.trim()).filter(Boolean);
const whole = (parts) => parts.map((p) => p.text).join('');

describe('diffWords', () => {
  it('marks only the words that differ', () => {
    const { said, fix } = diffWords(
      'je vais répondre aux questions des clients',
      'je réponds aux questions des clients');
    expect(changed(said)).toEqual(['vais répondre']);
    expect(changed(fix)).toEqual(['réponds']);
  });

  it('marks a single ending, not the whole phrase', () => {
    const { said, fix } = diffWords(
      'plusieurs responsabilités quotidiens',
      'plusieurs responsabilités quotidiennes');
    expect(changed(said)).toEqual(['quotidiens']);
    expect(changed(fix)).toEqual(['quotidiennes']);
  });

  it('keeps every character of both sides', () => {
    const said = "j'habite au Toronto";
    const fix = "j'habite à Toronto";
    const out = diffWords(said, fix);
    expect(whole(out.said)).toBe(said);
    expect(whole(out.fix)).toBe(fix);
  });

  it('treats an apostrophe word as one word', () => {
    const { said } = diffWords("j'habite au Toronto", "j'habite à Toronto");
    expect(changed(said)).toEqual(['au']);
  });

  it('does not mark a word for its capital or its comma', () => {
    const { said } = diffWords('Je suis, ici', 'je suis ici');
    expect(changed(said)).toEqual([]);
  });

  it('does mark an accent, which is a real correction', () => {
    const { said, fix } = diffWords('je vais a Paris', 'je vais à Paris');
    expect(changed(said)).toEqual(['a']);
    expect(changed(fix)).toEqual(['à']);
  });

  it('marks the whole of an addition when there was nothing to compare', () => {
    const { said, fix } = diffWords('', 'je suis originaire du Maroc');
    expect(said).toEqual([]);
    expect(changed(fix)).toEqual(['je suis originaire du Maroc']);
  });

  it('marks everything when nothing at all survives', () => {
    const { said, fix } = diffWords('on travaille', 'mon emploi');
    expect(changed(said)).toEqual(['on travaille']);
    expect(changed(fix)).toEqual(['mon emploi']);
  });

  it('survives null and undefined', () => {
    expect(diffWords(null, undefined)).toEqual({ said: [], fix: [] });
  });

  it('joins neighbouring words of the same state into one run', () => {
    const { said } = diffWords('je suis origine au monde',
      "je suis originaire d'un autre pays");
    // Three separate spans would be three separate strikethroughs.
    expect(said.filter((p) => p.changed)).toHaveLength(1);
  });
});
