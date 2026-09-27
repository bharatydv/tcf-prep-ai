/* The span matcher behind the side-by-side view.
 *
 * All of the logic in TranscriptDiff is here, and it is the kind that fails
 * quietly: a marked span one word out still looks like a marked span, so a
 * candidate reads the wrong half of their sentence as the mistake and nothing
 * anywhere says otherwise.
 */
import { markSpans, candidateText, diffWords, applyCorrections } from './TranscriptDiff';

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

/* A real tâche 1 answer as the browser heard it — lower case, no punctuation,
   two turns — with the corrections the grader returned for it. On a result
   graded before the corrected version was saved, the right-hand column said
   "Nothing to correct here" beside a table of eleven corrections. */
const DANA = [
  "bonjour je m'appelle Dana j'ai 27 ans et je suis origine au monde actuellement j'habite au Toronto au Canada depuis quelques années",
  "on travaille et très variés et m'a permis de gérer plusieurs responsabilités quotidiens par exemple et je vais répondre aux questions des clients je coordonne certaines tâches administrative j'ai je prépare des documents pour le réunion et je demande mon responsable avec ses activités quotidiens j'ai appris au particulièrement cette postale compétente en communication et en gestion du temps en ce qui concerne mes études j'ai obtenu de plombs en réseaux sociaux",
].join('\n');

const DANA_ERRORS = [
  { error: 'je suis origine au monde', correction: "je suis originaire d'un autre pays", kind: 'error' },
  { error: 'on travaille et très variés', correction: 'mon travail est très varié', kind: 'error' },
  { error: 'je demande mon responsable avec ses activités quotidiens',
    correction: "j'aide mon responsable dans ses activités quotidiennes", kind: 'error' },
  { error: 'cette postale compétente', correction: 'dans ce poste à être compétente', kind: 'error' },
  { error: "j'ai obtenu de plombs en réseaux sociaux",
    correction: "j'ai obtenu un diplôme en réseaux sociaux", kind: 'error' },
  { error: 'a sentence nobody said', correction: 'x', kind: 'error' },
];

describe('applyCorrections', () => {
  it('puts every correction from the table into the corrected text, where it was said', () => {
    const out = applyCorrections(DANA, DANA_ERRORS);
    expect(out.applied).toBe(5);
    expect(marked(out.said)).toEqual([
      'je suis origine au monde',
      'on travaille et très variés',
      'je demande mon responsable avec ses activités quotidiens',
      'cette postale compétente',
      "j'ai obtenu de plombs en réseaux sociaux",
    ]);
    expect(marked(out.fixed)).toEqual(DANA_ERRORS.slice(0, 5).map((e) => e.correction));
    expect(out.text).toContain("je suis originaire d'un autre pays actuellement");
    expect(out.text).toContain("j'ai obtenu un diplôme en réseaux sociaux");
  });

  it('leaves the rest of what was said exactly as it was', () => {
    const out = applyCorrections(DANA, DANA_ERRORS);
    expect(rebuild(out.said)).toBe(DANA);
    expect(out.text.startsWith("bonjour je m'appelle Dana j'ai 27 ans et ")).toBe(true);
  });

  it('finds a quote regardless of case, punctuation or a word the grader left out', () => {
    const out = applyCorrections("Je suis allé à Paris, hier.", [
      { error: 'je suis allé Paris', correction: 'je suis allé à Paris' },
    ]);
    expect(marked(out.said)).toEqual(['Je suis allé à Paris']);
    // The capital at the start of the sentence survives the correction.
    expect(out.text).toBe('Je suis allé à Paris, hier.');
  });

  it('never lets two corrections rewrite the same words', () => {
    const out = applyCorrections('le chat est noir', [
      { error: 'le chat est', correction: 'le chien est' },
      { error: 'chat est noir', correction: 'chat est blanc' },
    ]);
    expect(out.applied).toBe(1);
    expect(out.text).toBe('le chien est noir');
  });

  it('keeps the kind, so an upgrade is not painted as a mistake', () => {
    const out = applyCorrections('ça coûte combien', [
      { error: 'ça coûte combien', correction: 'combien cela coûte-t-il', kind: 'upgrade' },
    ]);
    expect(out.fixed.find((p) => p.marked).kind).toBe('upgrade');
  });

  it('applies nothing when there is nothing to find', () => {
    const out = applyCorrections('bonjour', [{ error: 'au revoir', correction: 'x' }]);
    expect(out.applied).toBe(0);
    expect(out.text).toBe('bonjour');
  });
});
