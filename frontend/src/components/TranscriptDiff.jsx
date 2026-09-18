/* What was said, beside what should have been said.
 *
 * Two columns showing the same answer twice: the candidate's own words on the
 * left with every mistake marked in red, and the corrected version on the
 * right with the repairs marked in green. The value is entirely in the
 * comparison — a list of corrections tells you what was wrong, but reading
 * your own sentence against the right one tells you what you actually do.
 *
 * A leaf module on purpose. It imports nothing but React and the translator,
 * so its matching logic can be unit tested; components/shared.jsx pulls in
 * react-router, whose exports map CRA's Jest cannot resolve, and anything
 * that imports it becomes untestable by association.
 *
 * Only for tâche 3 and free practice. Tâches 1 and 2 are practised and marked
 * without the words on screen — see SpeakingResult — so there is nothing here
 * to render for them and the caller does not ask.
 */
import { useT } from '../i18n';

/* Split a text into marked and unmarked runs.
 *
 * Non-overlapping and first-match-wins, which is the same rule
 * ErrorHighlightedText uses on the writing feedback. Two corrections that name
 * overlapping spans would otherwise produce nested marks, and a needle that
 * appears twice must not mark both occurrences — the grader was talking about
 * one of them and has no way to say which, so the first is the honest guess.
 *
 * Exported for the tests: this is the whole of the logic, and it is the kind
 * of thing that silently marks the wrong half of a sentence.
 */
export function markSpans(text, needles) {
  const source = String(text || '');
  if (!source) return [];
  const taken = [];

  (needles || []).forEach((raw) => {
    const needle = String(raw || '').trim();
    if (!needle) return;
    let from = 0;
    for (;;) {
      const start = source.indexOf(needle, from);
      if (start === -1) break;
      const end = start + needle.length;
      const clashes = taken.some(([s, e]) => start < e && end > s);
      if (!clashes) { taken.push([start, end]); break; }
      from = end;
    }
  });

  taken.sort((a, b) => a[0] - b[0]);

  const parts = [];
  let cursor = 0;
  taken.forEach(([start, end]) => {
    if (start > cursor) parts.push({ text: source.slice(cursor, start), marked: false });
    parts.push({ text: source.slice(start, end), marked: true });
    cursor = end;
  });
  if (cursor < source.length) parts.push({ text: source.slice(cursor), marked: false });
  return parts;
}

function Marked({ text, needles, tone }) {
  const parts = markSpans(text, needles);
  const mark = tone === 'wrong'
    ? 'rounded bg-rose-100 px-0.5 font-semibold text-red-700 underline decoration-red-400 decoration-wavy underline-offset-2'
    : 'rounded bg-green-100 px-0.5 font-semibold text-green-800';
  return (
    <p className="whitespace-pre-wrap text-sm leading-7 text-gray-700">
      {parts.map((part, i) => (part.marked
        ? <mark key={i} className={mark} data-testid={`diff-${tone}-${i}`}>{part.text}</mark>
        : <span key={i}>{part.text}</span>))}
    </p>
  );
}

export function TranscriptDiff({ transcript, corrected, errors = [], action = null }) {
  const t = useT();
  const said = String(transcript || '');
  const fixed = String(corrected || '');
  if (!said && !fixed) return null;

  const wrong = errors.map((e) => e.error).filter(Boolean);
  const right = errors.map((e) => e.correction).filter(Boolean);

  return (
    /* Side by side from md up, stacked below it. Two columns of French at
       phone width are two columns of one word each, which is worse than
       reading them in sequence. */
    <div className="grid gap-px overflow-hidden rounded-2xl bg-violet-100 md:grid-cols-2">
      <div className="bg-white p-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-red-600">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          {t('speak.diffSaid')}
        </p>
        <div className="mt-3">
          {said
            ? <Marked text={said} needles={wrong} tone="wrong" />
            : <p className="text-sm italic text-gray-400">{t('speak.noSpeechLine')}</p>}
        </div>
      </div>

      <div className="bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {t('speak.diffCorrected')}
          </p>
          {action}
        </div>
        <div className="mt-3">
          {fixed
            ? <Marked text={fixed} needles={right} tone="fix" />
            : <p className="text-sm italic text-gray-400">{t('speak.diffNoCorrections')}</p>}
        </div>
      </div>
    </div>
  );
}

export default TranscriptDiff;
