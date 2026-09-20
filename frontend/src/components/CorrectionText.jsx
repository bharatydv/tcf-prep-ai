/* One side of a correction, with only the words that changed marked.
 *
 * The table used to strike out the whole phrase in red and print the whole
 * fix in green, so « je vais répondre aux questions des clients » →
 * « je réponds aux questions des clients » arrived as nine crossed-out words
 * against six green ones, with nothing to say that the correction was about
 * one verb. Colour every word and you have coloured none of them.
 *
 * Now the unchanged words are ordinary text on both sides and only the change
 * is marked: the wrong words highlighted in red, the repair in green.
 *
 * No strikethrough. A line drawn through a word is a line drawn through the
 * letters the reader is being asked to look at — and the wrong word is small,
 * often a single word like « au » or an ending like « -iens », so the cross
 * covers most of what there is to see. The red says it was wrong; the green
 * beside it says what to say instead. The pair reads without anything being
 * crossed out.
 */
import { diffWords } from '../lib/wordDiff';

/* Matched pair: the same shape and weight on both sides, so the eye reads
   them as one correction with two halves rather than as a punishment and a
   reward. */
const TONE = {
  said: 'rounded bg-rose-100 px-0.5 font-semibold text-red-700',
  fix: 'rounded bg-green-100 px-0.5 font-semibold text-green-800',
};

export function CorrectionText({ said, correction, side, className = '' }) {
  const parts = diffWords(said, correction)[side === 'fix' ? 'fix' : 'said'];
  const plain = side === 'fix' ? 'text-gray-700' : 'text-gray-600';
  return (
    <span className={`min-w-0 ${className}`}>
      {parts.map((part, i) => (
        <span key={i} className={part.changed ? TONE[side] : plain}>
          {part.text}
        </span>
      ))}
    </span>
  );
}

export default CorrectionText;
