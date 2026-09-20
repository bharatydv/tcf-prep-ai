/* Where in the recording a phrase was actually spoken.
 *
 * The grader hands back corrections as text — « je vais répondre aux
 * questions » — and the transcriber hands back every word with a start and an
 * end in milliseconds. This joins the two, so the result page can play the
 * half-second of the candidate's own voice that a correction is about instead
 * of reading the mistake back to them in a synthetic one. Hearing a machine
 * pronounce the sentence correctly teaches nothing about what you said.
 *
 * A leaf module, imports nothing, so the matching can be unit tested — which
 * matters more here than usual: a wrong answer is not an error but a button
 * that confidently plays the wrong two seconds.
 */

/* The grader quotes the candidate, it does not transcribe them, so the two
   strings differ in case and punctuation even when they are the same words.
   Accents are kept: they distinguish real words. */
function key(word) {
  return String(word || '').toLowerCase().replace(/[-.,;:!?«»"'’()]/g, '');
}

function keysOf(text) {
  return String(text || '').split(/\s+/).map(key).filter(Boolean);
}

/* A little room either side, because a word boundary from a recogniser lands
   mid-consonant often enough to clip the first sound off. Small enough not to
   drag in the neighbouring word. */
const PAD_BEFORE_MS = 80;
const PAD_AFTER_MS = 150;

/* How many extra words a window may contain beyond the phrase itself. The
   candidate said something the correction does not quote exactly — that is
   why it is being corrected — so an exact-length window would miss most
   matches, and an unbounded one would match a phrase's first and last word
   twenty seconds apart and play the lot. */
const WINDOW_SLACK = 4;

/* Below this share of the phrase's words, the match is a guess. Better no
   button than a button that plays an unrelated sentence. */
const MIN_MATCH_SHARE = 0.6;

/* The clip for one phrase, or null when it cannot be found confidently.
 *
 * `words` is what the API returns for a graded recording: [{t, s, e}] — text,
 * start ms, end ms — in the order they were spoken.
 */
export function findClip(words, phrase) {
  const list = (Array.isArray(words) ? words : [])
    .filter((w) => w && key(w.t) && Number.isFinite(w.s) && Number.isFinite(w.e));
  const wanted = keysOf(phrase);
  if (!list.length || !wanted.length) return null;

  const spoken = list.map((w) => key(w.t));
  const cap = wanted.length + WINDOW_SLACK;
  let best = null;

  for (let i = 0; i < spoken.length; i += 1) {
    // Walk the phrase against the recording from this word on, in order,
    // allowing the recording to contain words the phrase does not.
    let matched = 0;
    let last = -1;
    let w = 0;
    for (let j = i; j < spoken.length && j - i < cap && w < wanted.length; j += 1) {
      if (spoken[j] === wanted[w]) { matched += 1; last = j; w += 1; }
    }
    // The first word has to be the phrase's first word, or a phrase that
    // begins with « je » matches at every « je » in the answer.
    if (matched && spoken[i] === wanted[0] && (!best || matched > best.matched)) {
      best = { matched, from: i, to: last };
    }
  }

  if (!best || best.matched / wanted.length < MIN_MATCH_SHARE) return null;

  const start = list[best.from].s;
  const end = list[best.to].e;
  if (!(end > start)) return null;
  return {
    start: Math.max(0, start - PAD_BEFORE_MS) / 1000,
    end: (end + PAD_AFTER_MS) / 1000,
  };
}

/* Whether a recording has timings worth looking in at all. Only some
   transcription providers report them, so the caller uses this to decide
   between the real voice and the synthesiser rather than discovering the
   answer one button at a time. */
export function hasTimings(words) {
  return Array.isArray(words) && words.length > 0;
}

export default findClip;
