/* Play what the candidate actually said, from their own recording.
 *
 * Sits where the synthesiser button sat in the "You said" column, and falls
 * back to it: a recording is only there when it was kept, only searchable
 * when the transcriber reported word timings, and only findable when the
 * phrase the grader quoted can be located in it. Any of those missing and
 * `clip` is null, so the caller renders the SpeakButton instead and the
 * column still plays something.
 *
 * Deliberately a different icon from the synthesiser's speaker: one of these
 * is the learner's own voice and the other is a machine reading a model
 * answer, and a table where both are the same button hides the distinction
 * that makes the left one worth pressing.
 */
import { Microphone, Stop } from '@phosphor-icons/react';
import { useT } from '../i18n';

export function OwnVoiceButton({ clip, id, play, playingId, supported, className = '' }) {
  const t = useT();
  if (!supported || !clip) return null;
  const playing = playingId === id;
  return (
    <button type="button" onClick={() => play(clip, id)}
      aria-label={playing ? t('speak.stopAudio') : t('speak.playOwn')}
      title={playing ? t('speak.stopAudio') : t('speak.playOwn')}
      data-testid={`own-voice-${id}`}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
        playing
          ? 'bg-rose-500 text-white'
          : 'bg-rose-100 text-rose-600 hover:bg-rose-200'} ${className}`}>
      {playing ? <Stop size={13} weight="fill" /> : <Microphone size={14} weight="fill" />}
    </button>
  );
}

export default OwnVoiceButton;
