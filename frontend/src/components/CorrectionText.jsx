/* One side of a correction, with only the words that changed marked.
 *
 * The table used to strike out the whole phrase in red and print the whole
 * fix in green, so « je vais répondre aux questions des clients » →
 * « je réponds aux questions des clients » arrived as nine crossed-out words
 * against six green ones, with nothing to say that the correction was about
 * one verb. Colour every word and you have coloured none of them.
 *
 * Now the unchanged words are ordinary text on both sides and only the change
 * is marked — struck through on the left, highlighted on the right. The
 * strikethrough is what "you did not say this" looks like, so it belongs on
 * the wrong words and nowhere else.
 */
import { diffWords } from '../lib/wordDiff';

const TONE = {
  said: 'text-red-600 line-through decoration-red-400 decoration-2',
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
