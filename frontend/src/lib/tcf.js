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

export const fmtClock = (s) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
