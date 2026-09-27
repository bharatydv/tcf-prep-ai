/* The examiner's own voice, heard back through the microphone.
 *
 * The examiner speaks through the computer's speakers, and the browser's
 * echo cancellation does not cover it: speech synthesis is played by the
 * operating system, outside the page's audio. So if the microphone opens
 * while the last words are still coming out of the speakers, those words are
 * transcribed as the candidate's — and then graded, corrected and scored as
 * French the candidate never said.
 *
 * The modal now waits for the speakers to go quiet before it listens. This is
 * the second line: a turn that begins with the end of what the examiner just
 * said has that echo cut off.
 *
 * Only the START of a turn is examined, and only a run the examiner actually
 * said: the tail of their line (the microphone opened while they were still
 * finishing), or at least five of their words in a row. A candidate who reuses
 * two or three of the examiner's words — « des vélos de ville, s'il vous
 * plaît » — is answering, not echoing, and keeps them.
 *
 * A leaf module, imports nothing, so it can be tested on its own. The server
 * applies the same rule (strip_echo in backend/server.py); change both.
 */

const WORD = /[\p{L}\p{N}]+/gu;

const MIN_TAIL = 3;   // the examiner's last words, from the start of the turn
const MIN_RUN = 5;    // or this many of their words in a row, from anywhere

function words(text) {
  return [...String(text || '').matchAll(WORD)]
    .map((m) => ({ key: m[0].toLowerCase(), end: m.index + m[0].length }));
}

/* How many of the turn's first words repeat a run of the examiner's line, and
   whether that run finished where the examiner finished. */
function leadingEcho(said, agent) {
  let best = { length: 0, toEnd: false };
  for (let start = 0; start < agent.length; start += 1) {
    let n = 0;
    while (n < said.length && start + n < agent.length
           && said[n].key === agent[start + n].key) n += 1;
    const toEnd = start + n === agent.length;
    if (n > best.length || (n === best.length && toEnd)) best = { length: n, toEnd };
  }
  return best;
}

/* The turn without the examiner's echo at its start. Returns '' when the
   whole turn was echo. */
export function stripEcho(text, agentText) {
  const source = String(text || '');
  const said = words(source);
  const agent = words(agentText);
  if (!said.length || !agent.length) return source.trim();
  const { length, toEnd } = leadingEcho(said, agent);
  const isEcho = (toEnd && length >= MIN_TAIL) || length >= MIN_RUN;
  if (!isEcho) return source.trim();
  return source.slice(said[length - 1].end).replace(/^[\s.,;:!?…»«"'’)-]+/u, '').trim();
}

export default stripEcho;
