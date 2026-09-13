/* The eight review modes, and the answer check that runs on the card.
 *
 * The server grades the session — /api/review/submit rebuilds every exercise
 * from the stored mistake and decides what the XP was worth. This file exists
 * for the half-second before that: the learner presses an option and has to be
 * told there and then whether it was right, which cannot wait for a session
 * that is not over yet.
 *
 * So these rules mirror backend/review_exercises.py deliberately, and the two
 * have to be changed together. Where they ever disagree, the server is the one
 * that counted: it is the only side that knows which sentence the mistake was
 * really made in.
 */

export const PLACEHOLDER = '____';

/* Which stored form each mode needs. flashcards needs none — it shows the
   error and the correction, which every mistake has by definition. */
export const FORM_FOR_MODE = {
  flashcards: null,
  mcq: 'mcq',
  sprint: 'mcq',
  cloze: 'cloze',
  spot: 'spot',
  typeit: 'typeit',
  pair: 'pair',
  transfer: 'transfer',
};

/* Hub order: the two that work on any mistake, then the ones that need the
   sentence back, then the timed one. */
export const MODES = ['flashcards', 'mcq', 'cloze', 'spot', 'typeit', 'pair', 'transfer', 'sprint'];

/* Modes where the answer was typed from memory rather than clicked. An accent
   the learner did not type is an accent they would not have written, so these
   are marked wrong — but named, not just refused. */
export const TYPED_MODES = ['cloze', 'typeit', 'transfer'];

export const MODE_META = {
  flashcards: { title: 'rev.modeFlashTitle', desc: 'rev.modeFlashDesc' },
  mcq: { title: 'rev.modeMcqTitle', desc: 'rev.modeMcqDesc' },
  cloze: { title: 'rev.modeClozeTitle', desc: 'rev.modeClozeDesc' },
  spot: { title: 'rev.modeSpotTitle', desc: 'rev.modeSpotDesc' },
  typeit: { title: 'rev.modeTypeTitle', desc: 'rev.modeTypeDesc' },
  pair: { title: 'rev.modePairTitle', desc: 'rev.modePairDesc' },
  transfer: { title: 'rev.modeTransferTitle', desc: 'rev.modeTransferDesc' },
  sprint: { title: 'rev.modeSprintTitle', desc: 'rev.modeSprintDesc' },
};

/* The mode's cards are written on demand, so the hub cannot count them before
   the learner opens it. See the transfer branch of /api/review/queue. */
export const ON_DEMAND_MODES = ['transfer'];

const PUNCTUATION = /[^\p{L}\p{N}_\s]/gu;
const SPACES = /\s+/g;

/* Accent-blind comparison form. œ and æ fold to one letter to match the
   server's length-preserving table; both sides fold the same way. */
export function canon(text) {
  return (text || '')
    .toLowerCase()
    .replace(/œ/g, 'o')
    .replace(/æ/g, 'a')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(PUNCTUATION, ' ')
    .replace(SPACES, ' ')
    .trim();
}

/* Comparison form for a typed answer: punctuation forgiven, accents not. */
export function loose(text) {
  return (text || '')
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(SPACES, ' ')
    .trim();
}

/* 'exact' | 'accent' | 'no' — how close an answer came. */
export function compare(given, expected) {
  if (!(given || '').trim() || !(expected || '').trim()) return 'no';
  if (loose(given) === loose(expected)) return 'exact';
  if (canon(given) === canon(expected)) return 'accent';
  return 'no';
}

/* Where a fragment sits inside a sentence, or null — whole words only.
 *
 * A plain indexOf finds « je va » inside « Je vais » and underlines two thirds
 * of a verb the learner wrote correctly. Same rule as locate() in
 * backend/review_exercises.py, and the same reason.
 *
 * Written with a leading capture group rather than a lookbehind: lookbehind
 * only reached Safari in 16.4, and an unsupported one is a SyntaxError at
 * construction — it would take the card down, not just the highlight.
 */
export function markSpan(sentence, fragment) {
  const words = String(fragment || '').trim().split(/\s+/).filter(Boolean);
  if (!sentence || !words.length) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = new RegExp(`(^|[^\\w])(${escaped.join('\\s+')})(?![\\w])`, 'i').exec(sentence);
  if (!match) return null;
  const start = match.index + match[1].length;
  return [start, start + match[2].length];
}

export function formFor(mode, item) {
  const key = FORM_FOR_MODE[mode];
  return key ? (item?.forms || {})[key] : null;
}

/* What the card is answered against. Not always the correction: spot-the-error
   wants the guilty segment, the minimal pair wants the corrected sentence, and
   a rule-transfer drill wants its own answer rather than the one it was
   modelled on. */
export function expectedAnswer(mode, item) {
  const form = formFor(mode, item);
  if (!form) return item?.correction || '';
  if (mode === 'pair') return form.right;
  return form.answer || item?.correction || '';
}

/* Whether to count the card as got-it, and what kind of miss it was. */
export function judge(mode, item, given) {
  const result = compare(given, expectedAnswer(mode, item));
  if (TYPED_MODES.includes(mode)) {
    return { correct: result === 'exact', accentOnly: result === 'accent' };
  }
  return { correct: result !== 'no', accentOnly: false };
}

/* Fisher–Yates, not `sort(() => Math.random() - 0.5)`.
 *
 * A comparator that returns a random sign is not a shuffle: sort assumes a
 * consistent ordering, and given an inconsistent one it produces a
 * systematically skewed permutation. Measured on the three options an MCQ
 * actually builds, the correct answer landed first 43.7% of the time and
 * second only 18.8%, against 33.3% for each if it were uniform — so answering
 * "the first one" every time scored 44% without reading anything.
 *
 * This is the same problem reading_bank/_balance.py exists to solve for the
 * question bank, for the reason its docstring gives: a candidate who noticed
 * could score above their real level by guessing, which makes the measure
 * useless. The review MCQ is where mastery is decided and XP is awarded, so it
 * needs the same guarantee. Fisher–Yates is uniform by construction.
 *
 * It now also shuffles the two sides of a minimal pair, which has the same
 * hole in a smaller space: with a fixed order, "the second one is the correct
 * one" is a perfect strategy.
 */
export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
