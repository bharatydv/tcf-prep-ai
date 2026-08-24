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
