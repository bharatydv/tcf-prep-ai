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

/* Words with where they sit in the text, for finding a quote and replacing
   exactly the characters it covers. Apostrophes split words ("j'habite" is
   "j" and "habite"), so a quote that spelt the elision differently still
   lines up. */
const WORD = /[\p{L}\p{N}]+/gu;

function wordsAt(text) {
  return [...String(text || '').matchAll(WORD)]
    .map((m) => ({ key: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length }));
}

/* Where a correction's quote was said, as a character span, or null.
 *
 * The same rule the server uses to decide a quote is real: the quoted words
 * in order, with at most two unquoted words between two quoted ones, because
 * a grader quoting "allé Paris" out of "allé à Paris" is still quoting the
 * candidate. A span another correction already claimed is skipped, so two
 * corrections never rewrite the same words. */
function locate(words, quote, taken, slack = 2) {
  const wanted = (String(quote || '').match(WORD) || []).map((w) => w.toLowerCase());
  if (!wanted.length) return null;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].key !== wanted[0]) continue; // eslint-disable-line no-continue
    let at = i;
    let ok = true;
    for (let j = 1; j < wanted.length && ok; j += 1) {
      const limit = Math.min(words.length - 1, at + 1 + slack);
      let found = -1;
      for (let x = at + 1; x <= limit; x += 1) {
        if (words[x].key === wanted[j]) { found = x; break; }
      }
      if (found < 0) ok = false;
      else at = found;
    }
    const start = words[i].start;
    const end = words[at].end;
    if (ok && !taken.some(([s, e]) => start < e && end > s)) return [start, end];
  }
  return null;
}

/* The candidate's own words with every correction from the table applied
 * where it was said.
 *
 * The right-hand column used to be the grader's separate "corrected version".
 * That was a second text written by the model: it could fix things the table
 * never mentioned, skip things the table did, and it did not exist at all on
 * a result graded before it was saved — which left "Nothing to correct here"
 * beside a table of eleven corrections. Built from the table instead, the two
 * cannot disagree: every row is a mark in the transcript, and every mark is a
 * row.
 *
 * Returns both sides as runs, each mark carrying the row's kind so an
 * "upgrade" — correct French, said better — is not painted as a mistake. */
export function applyCorrections(text, errors) {
  const source = String(text || '');
  const words = wordsAt(source);
  const taken = [];
  const edits = [];
  (errors || []).forEach((e) => {
    let correction = String(e?.correction || '').trim();
    if (!correction) return;
    const span = locate(words, e?.error, taken);
    if (!span) return;
    taken.push(span);
    // A correction of a sentence's first words keeps its capital letter.
    const first = source[span[0]];
    if (first !== first.toLowerCase() && correction[0] === correction[0].toLowerCase()) {
      correction = correction[0].toUpperCase() + correction.slice(1);
    }
    edits.push({ start: span[0], end: span[1], correction, kind: e.kind || 'error' });
  });
  edits.sort((a, b) => a.start - b.start);

  const said = [];
  const fixed = [];
  let cursor = 0;
  edits.forEach((edit) => {
    if (edit.start > cursor) {
      const plain = source.slice(cursor, edit.start);
      said.push({ text: plain, marked: false });
      fixed.push({ text: plain, marked: false });
    }
    said.push({ text: source.slice(edit.start, edit.end), marked: true, kind: edit.kind });
    fixed.push({ text: edit.correction, marked: true, kind: edit.kind });
    cursor = edit.end;
  });
  if (cursor < source.length) {
    const rest = source.slice(cursor);
    said.push({ text: rest, marked: false });
    fixed.push({ text: rest, marked: false });
  }
  return { applied: edits.length, said, fixed, text: fixed.map((p) => p.text).join('') };
}

const MARK = {
  wrong: 'rounded bg-rose-100 px-0.5 font-semibold text-red-700 underline decoration-red-400 decoration-wavy underline-offset-2',
  fix: 'rounded bg-green-100 px-0.5 font-semibold text-green-800',
  // An upgrade was correct French; it is marked as a suggestion, not an error.
  upgradeWrong: 'rounded bg-blue-50 px-0.5 text-blue-800 underline decoration-blue-300 decoration-dotted underline-offset-2',
  upgradeFix: 'rounded bg-blue-100 px-0.5 font-semibold text-blue-800',
};

function Runs({ parts, tone }) {
  const style = (part) => (part.kind === 'upgrade'
    ? (tone === 'wrong' ? MARK.upgradeWrong : MARK.upgradeFix)
    : MARK[tone]);
  return (
    <p className="whitespace-pre-wrap text-sm leading-7 text-gray-700">
      {parts.map((part, i) => (part.marked
        ? <mark key={i} className={style(part)} data-testid={`diff-${tone}-${i}`}>{part.text}</mark>
        : <span key={i}>{part.text}</span>))}
    </p>
  );
}

/* `action` is given the corrected text, so a play button reads out exactly
   what is on screen. `saidAction` sits beside "What you said": the
   candidate's own recording, when one was kept. */
export function TranscriptDiff({
  transcript, corrected, errors = [], action = null, saidAction = null,
}) {
  const t = useT();
  const said = candidateText(transcript);
  const graderFixed = String(corrected || '').trim();
  if (!said && !graderFixed) return null;

  /* The table's corrections, applied in place, whenever any of them can be
     found in what was said. Only when none can — a result with no
     corrections, or quotes the transcript does not contain — does the
     grader's own corrected version stand in, compared word by word. */
  const applied = said ? applyCorrections(said, errors) : null;
  const diff = !applied?.applied && said && graderFixed ? diffWords(said, graderFixed) : null;
  let saidParts;
  let fixedParts;
  let fixed;
  if (applied?.applied) {
    saidParts = applied.said;
    fixedParts = applied.fixed;
    fixed = applied.text;
  } else if (diff) {
    saidParts = diff.said;
    fixedParts = diff.fixed;
    fixed = graderFixed;
  } else {
    saidParts = markSpans(said, errors.map((e) => e.error).filter(Boolean));
    fixed = graderFixed;
    fixedParts = markSpans(fixed, errors.map((e) => e.correction).filter(Boolean));
  }

  return (
    /* Side by side from md up, stacked below it. Two columns of French at
       phone width are two columns of one word each, which is worse than
       reading them in sequence. */
    <div className="grid gap-px overflow-hidden rounded-2xl bg-violet-100 md:grid-cols-2">
      <div className="bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-red-600">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {t('speak.diffSaid')}
          </p>
          {saidAction}
        </div>
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
          {typeof action === 'function' ? action(fixed) : action}
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
