/* The three tâche results of one speaking sitting, held across a navigation.
 *
 * Tâche 3 is a prepared monologue, so Test Mode hands it to the recorder on
 * its own route rather than reimplementing the preparation timer in a modal.
 * That navigation unmounts the exam page, and with it the results of tâches 1
 * and 2 — which left the sitting permanently one tâche short of the combined
 * Expression orale result it exists to produce. The recorder writes tâche 3's
 * grade back into the same bucket, so returning shows the finished paper.
 *
 * sessionStorage, not local: a sitting belongs to the tab it was taken in, and
 * a stale paper mark reappearing next week would be worse than none.
 */
const key = (setNumber) => `prepfrancais.speakingExam.${setNumber}`;

export function readSitting(setNumber) {
  if (!setNumber) return {};
  try {
    return JSON.parse(sessionStorage.getItem(key(setNumber))) || {};
  } catch {
    /* Storage blocked, or a half-written entry. Start the sitting over. */
    return {};
  }
}

export function writeSitting(setNumber, results) {
  if (!setNumber) return;
  try {
    sessionStorage.setItem(key(setNumber), JSON.stringify(results));
  } catch {
    /* Nothing persisted: the sitting still works, tâche 3 just cannot report
       back into it. Better than failing the grade the candidate paid for. */
  }
}

/* One graded tâche into an existing sitting, without disturbing the others.
 * Returns the sitting as it now stands, so the caller can tell whether that
 * grade was the one that finished the paper. */
export function saveTask(setNumber, taskType, result) {
  const sitting = { ...readSitting(setNumber), [taskType]: result };
  writeSitting(setNumber, sitting);
  return sitting;
}

/* The three tâches are the paper. Anything short of all three is a sitting in
 * progress, however good the answers in it are. */
export const TASKS = [1, 2, 3];

export const sittingComplete = (sitting) =>
  TASKS.every((n) => sitting && sitting[n]);

/* How a set is named on screen.
 *
 * The bank is in groups: the general practice series, and the official
 * Expression orale series of each month of 2026. A set carries its global
 * number (what the URL and the database use) and its `index` within its
 * group (what the candidate reads). "Test 3" under "September 2026" is what
 * the page prints; "Exam set 23" would be a number nobody chose.
 *
 * `month` is a "YYYY-MM" key from the server, turned into an English month
 * name here so the dictionary does not need a row per month. */
export function monthLabel(month) {
  if (!month) return '';
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return String(month);
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
}

/* t is the page's translator; `set` is a row from /api/speaking/exam-sets or
   the sitting itself. Falls back to the plain set number for rows that carry
   no group — older API shapes, or a general set. */
/* Which of the four papers a graded submission belongs to.
 *
 * The row says so itself — /api/submissions returns `skill` — and reading it
 * is the whole point: this used to be decided on the client from a set of
 * source names written out in two separate pages, and when the backend added
 * `speaking_exam` for Test Mode neither page heard about it. Every spoken
 * answer given in a speaking paper was filed as writing.
 *
 * The fallback is for a response cached by a browser from before the field
 * existed, and mirrors ALL_SPEAKING_SOURCES in backend/server.py. It is not
 * the answer, only the last resort: the server's is.
 */
const SPOKEN_SOURCES = new Set(['speaking', 'speaking_exam', 'conversation']);

export function submissionSkill(row) {
  if (row?.skill === 'speaking' || row?.skill === 'writing') return row.skill;
  return SPOKEN_SOURCES.has(row?.source || '') ? 'speaking' : 'writing';
}

export function setLabel(t, set) {
  if (!set) return '';
  if (set.month) return `${monthLabel(set.month)} · ${t('sexam.testN', { n: set.index })}`;
  return t('sexam.setN', { n: set.index || set.set_number });
}
