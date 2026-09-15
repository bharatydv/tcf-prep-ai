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
