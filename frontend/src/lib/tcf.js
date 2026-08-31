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
 * Its ceiling is tâche 3's — the exam never asks for more than 180 words — so
 * past 180 the editor warns, and at 200 it stops accepting input entirely. */
export const FREE_WRITING = { warnWords: 180, maxWords: 200 };

export const SPEAKING_TASKS = {
  1: { prepSeconds: 0, speakSeconds: 120, name: 'Tâche 1 — Entretien dirigé' },
  2: { prepSeconds: 120, speakSeconds: 210, name: 'Tâche 2 — Exercice en interaction' },
  3: { prepSeconds: 120, speakSeconds: 150, name: "Tâche 3 — Expression d'un point de vue" },
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

/* Word count against the free-writing ceiling. No `capped` flag: with no
 * tâche there is no official range for the grader to penalise against. */
export function freeWordStatus(text) {
  const { warnWords: warn, maxWords: max } = FREE_WRITING;
  const words = countWords(text);
  if (words === 0) return { words, state: 'empty', key: null, vars: null };
  if (words >= max) return { words, state: 'over', key: 'words.freeMax', vars: { max } };
  if (words > warn) return { words, state: 'warn', key: 'words.freeOver', vars: { n: words - warn, warn } };
  return { words, state: 'ok', key: null, vars: null };
}

export const fmtClock = (s) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/* ---------------------------------------------------------------------------
 * Expression orale: one mark out of 20, and the NCLC/CLB level it converts to.
 *
 * The graders score each tâche 0-100 on the CEFR rubric in backend/server.py,
 * but that is a working scale, not what a candidate is told: the real paper
 * reports Expression orale as a single mark out of 20, which IRCC then reads
 * as an NCLC (CLB) level. The bands below are the published ones — the same
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
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const span = s[1] - s[0];
  const within = Math.min(Math.max(n, s[0]), s[1]) - s[0];
  return Math.round(m[0] + (span > 0 ? within / span : 0) * (m[1] - m[0]));
}

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
