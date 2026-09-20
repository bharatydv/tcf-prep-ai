/* Official TCF Canada task constraints.
 *
 * These mirror backend/server.py (WRITING_TASKS / SPEAKING_TASKS) so the UI
 * shows exactly the limits the grader enforces. If you change one, change both
 * — /api/tcf-spec exposes the backend copy for verification. */

export const WRITING_TASKS = {
  1: { minWords: 60, maxWords: 120, minutes: 15, name: 'Tâche 1 — Message court' },
  2: { minWords: 120, maxWords: 150, minutes: 20, name: 'Tâche 2 — Article, blog ou lettre' },
  3: { minWords: 120, maxWords: 180, minutes: 25, name: 'Tâche 3 — Texte argumentatif' },
};

export const WRITING_TOTAL_SECONDS = 60 * 60;

/* The one-time free trial: 3 writing corrections + 3 speaking evaluations,
 * mirroring FREE_WRITING_LIMIT + FREE_SPEAKING_LIMIT in backend/server.py.
 *
 * Only ever a fallback — every response carries `free_trial_total`, which is
 * authoritative. It lived as a private `const FREE_LIMIT = 6` in four separate
 * pages, and a fifth copy in shared.jsx said 5, so a stale bundle could tell
 * one learner they had 5 attempts and another 6 on the next screen. */
export const FREE_TRIAL_TOTAL = 6;

/* Free writing sits outside the three tâches, so it has no official range.
 *
 * It used to stop accepting input at 200 words, on the reasoning that the exam
 * never asks for more than 180. That reasoning missed who actually uses this
 * box: someone typing up a SPOKEN answer to have it marked. Tâche 3 of the
 * oral is 270 seconds of speech, which is 500 to 700 words written out — so
 * the cap silently truncated the middle of their answer and graded the part
 * that survived.
 *
 * Past 180 the editor now says so and carries on. The real ceiling is the
 * server's, which rejects a submission over MAX_TEXT_CHARS (6000) — that is
 * what bounds the grading cost, and it always did; the word cap was never
 * what stood between us and an expensive request. */
export const FREE_WRITING = { warnWords: 180, maxChars: 6000 };

/* `clockStartsOnSpeech` belongs to a tâche with no preparation: the recorder
   arms on the button, but the countdown holds at zero until the candidate
   actually speaks, so reading the question costs them none of their time. */
export const SPEAKING_TASKS = {
  1: { prepSeconds: 0, speakSeconds: 120, name: 'Tâche 1 — Entretien dirigé' },
  2: { prepSeconds: 120, speakSeconds: 210, name: 'Tâche 2 — Exercice en interaction' },
  3: { prepSeconds: 0, speakSeconds: 270, clockStartsOnSpeech: true,
    name: "Tâche 3 — Expression d'un point de vue" },
};

export const countWords = (text) =>
  (text || '').trim() ? (text || '').trim().split(/\s+/).length : 0;

/* How a word count sits against a tâche's official range.
 * `state` drives the colour; `capped` means the grader will lower the level. */
export function wordStatus(text, taskType) {
  const spec = WRITING_TASKS[taskType];
  const words = countWords(text);
  if (!spec) return { words, state: 'none', key: null, vars: null, capped: false };
  const { minWords: min, maxWords: max } = spec;
  if (words === 0) return { words, state: 'empty', key: 'words.required', vars: { min, max }, capped: false };
  if (words < min) {
    return { words, state: 'under', key: 'words.under', vars: { n: min - words, min }, capped: true };
  }
  if (words > max) {
    const hard = words > max * 1.5;
    return {
      words,
      state: hard ? 'over' : 'warn',
      key: hard ? 'words.overHard' : 'words.over',
      vars: { n: words - max, max },
      capped: hard,
    };
  }
  return { words, state: 'ok', key: 'words.ok', vars: { min, max }, capped: false };
}

/* Cut a text down to at most `max` words. Truncating rather than rejecting
 * the whole change keeps a long paste usable: the learner gets the first 200
 * words instead of nothing. Slicing at the offending word's index preserves
 * the paragraph breaks a split/join would flatten. */
export function clampWords(text, max) {
  if (!text) return text;
  const re = /\S+/g;
  let n = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    n += 1;
    if (n > max) return text.slice(0, m.index).replace(/\s+$/, '');
  }
  return text;
}

/* Word count for free writing. No `capped` flag: with no tâche there is no
 * official range for the grader to penalise against — being long here costs
 * the learner nothing, which is why nothing below blocks.
 *
 * `over` is the one state that still refuses, and it counts CHARACTERS rather
 * than words, because that is the limit the server actually enforces. Warning
 * on a word count while the server rejects on a character count is how you get
 * a green editor and a 422. */
export function freeWordStatus(text) {
  const { warnWords: warn, maxChars } = FREE_WRITING;
  const words = countWords(text);
  const chars = (text || '').length;
  if (words === 0) return { words, state: 'empty', key: null, vars: null };
  if (chars > maxChars) {
    return { words, state: 'over', key: 'words.freeTooLong', vars: { max: maxChars, n: chars } };
  }
  if (words > warn) return { words, state: 'warn', key: 'words.freeOver', vars: { n: words - warn, warn } };
  return { words, state: 'ok', key: null, vars: null };
}

export const fmtClock = (s) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/* ---------------------------------------------------------------------------
 * One mark out of 20, and the NCLC/CLB level it converts to.
 *
 * The graders score every answer 0-100 on the CEFR rubric in backend/server.py,
 * but that is a working scale, not what a candidate is told: the real paper
 * reports Expression orale and Expression écrite each as a single mark out of
 * 20, which IRCC then reads as an NCLC (CLB) level. Nothing in this app shows
 * the 0-100 figure any more — every score a user sees goes through the
 * conversion below, so the number on the dashboard is the number the exam
 * would print. The bands below are the published ones — the same
 * expression-orale column as NCLC_ROWS on the TCF Canada pages.
 *
 * The mark is anchored to the CEFR level the grader assigned, not derived from
 * the percentage alone, so it can never contradict the levels shown beside it.
 * Dividing by five would turn 69/100 — the top of B2 — into 14/20, which the
 * table calls NCLC 9 and the rubric calls C1.
 */
const SCORE_BAND = { A1: [5, 19], A2: [20, 39], B1: [40, 54],
                     B2: [55, 69], C1: [70, 84], C2: [85, 100] };
const MARK_BAND = { A1: [1, 3], A2: [4, 6], B1: [7, 9],
                    B2: [10, 13], C1: [14, 17], C2: [18, 20] };

/* Lowest mark for each NCLC level, highest first. Below 4 the official table
 * stops: it publishes no band under NCLC 4, so neither does this. */
const NCLC_FLOORS = [[16, '10+'], [14, '9'], [12, '8'], [10, '7'],
                     [7, '6'], [6, '5'], [4, '4']];

/* One tâche's 0-100 score as a mark out of 20, placed inside its level's band
 * by where the score sits inside that level's own range. */
export function markOutOf20(score, level) {
  const s = SCORE_BAND[level];
  const m = MARK_BAND[level];
  if (!s || !m) return null;
  // Number(null) and Number('') are both 0, which a clamp then lifts to the
  // FLOOR of the level's band — so an attempt whose score never came back
  // would have shown a confident 10/20 next to its B2. Absent is not zero.
  const n = score === null || score === undefined || score === '' ? NaN : Number(score);
  if (!Number.isFinite(n)) return null;
  const span = s[1] - s[0];
  const within = Math.min(Math.max(n, s[0]), s[1]) - s[0];
  return Math.round(m[0] + (span > 0 ? within / span : 0) * (m[1] - m[0]));
}

/* The mark for any display, including the ones that have no CEFR level beside
 * them to anchor against — an admin row, or an older attempt stored before the
 * grader returned a level. Anchoring is always preferred, because it is the
 * only version that cannot contradict the level shown next to it; the plain
 * fifth is the fallback, not the rule.
 *
 * Returns null only when there is no usable number at all, so a caller can
 * print an em dash rather than a confident "0/20". */
export function displayMark(score, level) {
  const anchored = markOutOf20(score, level);
  if (anchored !== null) return anchored;
  const n = score === null || score === undefined || score === '' ? NaN : Number(score);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(Math.max(n, 0), 100) / 5);
}

/* A count of right answers as a mark out of 20. A comprehension paper is
 * scored out of however many questions it had, and 34/40 next to a 12/20 on
 * the same chart compares nothing — this puts both on the reported scale. */
export function markFromCorrect(score, total) {
  if (!total) return null;
  const n = score === null || score === undefined || score === '' ? NaN : Number(score);
  return Number.isFinite(n) ? Math.round((n / total) * 20) : null;
}

/* The next band up the mark ladder, and how far away it is: {level, points}.
 *
 * Derived from MARK_BAND rather than written out again, so the ladder cannot
 * drift from the bands the mark itself is placed in. Null at the top of the
 * table — there is nothing above C2 to aim at, and "+0 pts to nowhere" reads
 * as a bug.
 */
const MARK_LADDER = Object.entries(MARK_BAND).map(([level, [floor]]) => [level, floor]);

export function nextMarkBand(mark) {
  if (!Number.isFinite(mark)) return null;
  const step = MARK_LADDER.find(([, floor]) => floor > mark);
  return step ? { level: step[0], points: step[1] - mark } : null;
}

/* The five columns of the level chart. C1 and C2 share one, as the official
 * expression orale reporting does: above NCLC 10 the table stops splitting
 * them, so a chart that did would be inventing a distinction. */
/* The CEFR band one criterion's score falls in.
 *
 * The same bands the graders are given in backend/server.py — A1 (5-19),
 * A2 (20-39), B1 (40-54), B2 (55-69), C1 (70-84), C2 (85-100) — so a
 * criterion card and the rubric that produced the number agree. Change one,
 * change both.
 *
 * Nothing sits below A1, so a score under 5 reads A1 rather than blank: the
 * candidate said something, and "no level" is not a thing the scale has.
 */
export function levelFromScore(score) {
  // Before Number(), not after: Number(null) and Number('') are both 0, so a
  // criterion the grader did not mark would have come back A1 — telling a
  // candidate they scored the bottom band on something nobody assessed.
  if (score === null || score === undefined || score === '') return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 85) return 'C2';
  if (n >= 70) return 'C1';
  if (n >= 55) return 'B2';
  if (n >= 40) return 'B1';
  if (n >= 20) return 'A2';
  return 'A1';
}

export const LEVEL_COLUMNS = ['A1', 'A2', 'B1', 'B2', 'C1/C2'];

export const levelColumn = (level) =>
  (level === 'C1' || level === 'C2' ? 4 : LEVEL_COLUMNS.indexOf(level));

/* The NCLC/CLB level a mark out of 20 converts to, or null below the table. */
export function nclcFromMark(mark) {
  if (!Number.isFinite(mark)) return null;
  const band = NCLC_FLOORS.find(([floor]) => mark >= floor);
  return band ? band[1] : null;
}

/* The whole Expression orale paper from its three graded tâches: the mean of
 * the three marks, as the exam reports one result for the skill rather than
 * three. Returns null until every tâche has been graded — a paper mark from a
 * partial sitting would read as a real result. */
export function speakingPaperMark(results) {
  const marks = results.map((r) => markOutOf20(r?.overall_score, r?.tcf_level));
  if (marks.length !== 3 || marks.some((m) => m === null)) return null;
  const mark = Math.round(marks.reduce((a, b) => a + b, 0) / marks.length);
  return { mark, nclc: nclcFromMark(mark) };
}
