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
 * Used for every tâche. Tâches 1 and 2 are dialogues, so their transcript is
 * cut down to the candidate's own lines first — see candidateText.
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
 * Used when there is no corrected version to compare against, which is the
 * case for a result graded before the corrected version existed.
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

/* The candidate's half of a dialogue.
 *
 * A roleplay is saved as "Candidat : …" and "Agent : …" lines. The agent's
 * lines are not the candidate's French and were never corrected, so comparing
 * them against the corrected version marked every word the agent said as a
 * mistake. The candidate's lines are kept one per line, as they were spoken.
 * A monologue has no such lines and comes back untouched. */
const SPEAKER = /^\s*(Candidat|Agent)\s*:\s*/i;

export function candidateText(transcript) {
  const text = String(transcript || '');
  const lines = text.split('\n');
  if (!lines.some((l) => SPEAKER.test(l))) return text.trim();
  return lines
    .filter((l) => /^\s*Candidat\s*:/i.test(l))
    .map((l) => l.replace(SPEAKER, '').trim())
    .filter(Boolean)
    .join('\n');
}

/* A word for comparing, not for showing: case and punctuation are not what a
   correction is about, and marking "Paris." against "Paris" as a change
   would put red on a word that was right. */
const key = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* Words and the spaces between them, so the text can be put back exactly. */
const tokens = (text) => String(text || '').split(/(\s+)/).filter((x) => x !== '');

/* Which words changed between what was said and the corrected version.
 *
 * A longest-common-subsequence over the words: whatever is in both, in order,
 * is unchanged, and everything else is marked — red on the left for what was
 * said wrongly or should not have been said, green on the right for what
 * replaced it. Finding the grader's quotes by searching for them marked only
 * the ones it quoted character for character, which left most of the changes
 * in the corrected version unmarked.
 *
 * Returns both sides as runs, adjacent changed words merged into one mark. */
export function diffWords(said, fixed) {
  const a = tokens(said);
  const b = tokens(fixed);
  const aw = a.map((x, i) => [x, i]).filter(([x]) => !/^\s+$/.test(x));
  const bw = b.map((x, i) => [x, i]).filter(([x]) => !/^\s+$/.test(x));
  const n = aw.length;
  const m = bw.length;

  // Lengths of the common subsequence from each pair of positions onwards.
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = key(aw[i][0]) === key(bw[j][0]) && key(aw[i][0])
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const keepA = new Set();
  const keepB = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(aw[i][0]) && key(aw[i][0]) === key(bw[j][0])) {
      keepA.add(aw[i][1]); keepB.add(bw[j][1]); i += 1; j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  // Punctuation on its own ("—", "?") is never a change worth marking.
  a.forEach((x, idx) => { if (!/\s/.test(x) && !key(x)) keepA.add(idx); });
  b.forEach((x, idx) => { if (!/\s/.test(x) && !key(x)) keepB.add(idx); });

  const runs = (toks, keep) => {
    const out = [];
    toks.forEach((tok, idx) => {
      const space = /^\s+$/.test(tok);
      // A space belongs to a mark only when the words either side of it are
      // both marked, so "je suis" is one mark rather than two with a gap.
      const marked = space
        ? !keep.has(idx - 1) && idx > 0 && idx < toks.length - 1 && !keep.has(idx + 1)
        : !keep.has(idx);
      const last = out[out.length - 1];
      if (last && last.marked === marked) last.text += tok;
      else out.push({ text: tok, marked });
    });
    return out;
  };
  return { said: runs(a, keepA), fixed: runs(b, keepB) };
}

function Runs({ parts, tone }) {
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
  const said = candidateText(transcript);
  const fixed = String(corrected || '').trim();
  if (!said && !fixed) return null;

  /* With a corrected version, the two are compared word by word. Without one
     — an older result — only the grader's quotes can be marked. */
  const diff = said && fixed ? diffWords(said, fixed) : null;
  const saidParts = diff ? diff.said
    : markSpans(said, errors.map((e) => e.error).filter(Boolean));
  const fixedParts = diff ? diff.fixed
    : markSpans(fixed, errors.map((e) => e.correction).filter(Boolean));

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
            ? <Runs parts={saidParts} tone="wrong" />
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
            ? <Runs parts={fixedParts} tone="fix" />
            : <p className="text-sm italic text-gray-400">{t('speak.diffNoCorrections')}</p>}
        </div>
      </div>
    </div>
  );
}

export default TranscriptDiff;
