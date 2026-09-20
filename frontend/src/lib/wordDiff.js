/* Which words actually changed between what was said and the correction.
 *
 * The corrections table used to strike through the whole phrase in red and
 * print the whole fix in green. « je vais répondre aux questions des clients »
 * became « je réponds aux questions des clients », and six of the nine words
 * were identical — but every one of them was crossed out, so the eye had no
 * way to find the one word the correction was about. Colour everything and
 * you have coloured nothing.
 *
 * A leaf module: it imports nothing, so it can be unit tested. Anything that
 * reaches components/shared.jsx pulls in react-router, whose exports map CRA's
 * Jest cannot resolve — see transcriptDiff.js for the same constraint.
 */

/* Compare on this, display the original.
 *
 * Case and punctuation are not what a correction is about: « Je » becoming
 * « je » at the start of a clause, or a comma appearing, would otherwise mark
 * a word as changed and send the reader hunting for a difference that is not
 * there. Accents are NOT stripped — « a » and « à » is a real correction, and
 * one of the commonest in the exam.
 */
function key(token) {
  return token.toLowerCase().replace(/[.,;:!?«»"'()]/g, '');
}

/* Words and the gaps between them, in order, so the runs can be rebuilt with
   their original spacing. Apostrophes stay inside the word: « j'habite » is
   one word to a reader and splitting it would mark « j' » as unchanged and
   « habite » as changed. */
function tokenise(text) {
  return String(text || '').match(/\s+|[^\s]+/g) || [];
}

const isGap = (token) => /^\s+$/.test(token);

/* Longest common subsequence over the comparable words, as a table of back
 * pointers. Words, not characters: the unit a reader corrects in is the word,
 * and a character diff on French turns « variés » → « varié » into a lone
 * struck-through "s" floating at the end of a word.
 */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const grid = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      grid[i][j] = a[i].k === b[j].k
        ? grid[i + 1][j + 1] + 1
        : Math.max(grid[i + 1][j], grid[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].k === b[j].k) { pairs.push([a[i].at, b[j].at]); i += 1; j += 1; }
    else if (grid[i + 1][j] >= grid[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

/* Mark the runs of both sides.
 *
 * Returns { said, fix }, each a list of { text, changed }. A gap between two
 * unchanged words is unchanged; a gap anywhere else belongs to the change
 * beside it, so a struck-out run reads as one phrase rather than as separate
 * words with clean space between them.
 *
 * Either side being empty means there is nothing to compare against, so the
 * whole of the other is the change — which is the honest answer when a
 * correction adds or removes a phrase outright.
 */
export function diffWords(said, correction) {
  const left = tokenise(said);
  const right = tokenise(correction);

  const leftWords = left.map((text, at) => ({ k: key(text), at }))
    .filter((w, at) => !isGap(left[at]) && w.k);
  const rightWords = right.map((text, at) => ({ k: key(text), at }))
    .filter((w, at) => !isGap(right[at]) && w.k);

  const keptLeft = new Set();
  const keptRight = new Set();
  if (leftWords.length && rightWords.length) {
    lcsPairs(leftWords, rightWords).forEach(([l, r]) => {
      keptLeft.add(l);
      keptRight.add(r);
    });
  }

  return {
    said: runs(left, keptLeft),
    fix: runs(right, keptRight),
  };
}

/* Tokens to display runs: consecutive tokens of the same state are joined, so
   a three-word change is one <span> and not three. */
function runs(tokens, kept) {
  const out = [];
  tokens.forEach((text, at) => {
    // A gap is carried by its neighbours: unchanged only when what came
    // before it survived and what comes after it does too.
    const changed = isGap(text)
      ? !(kept.has(at - 1) && kept.has(at + 1))
      : !kept.has(at);
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += text;
    else out.push({ text, changed });
  });
  return out;
}

export default diffWords;
