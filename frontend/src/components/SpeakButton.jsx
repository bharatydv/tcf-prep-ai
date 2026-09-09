import { SpeakerHigh, Stop } from '@phosphor-icons/react';
import { useT } from '../i18n';

/* Play one French line aloud. Renders nothing where the browser has no
   synthesiser, rather than a button that would do nothing when pressed. */
export function SpeakButton({ text, id, speak, speakingId, supported, className = '' }) {
  const t = useT();
  if (!supported || !(text || '').trim()) return null;
  const playing = speakingId === id;
  return (
    <button type="button" onClick={() => speak(text, id)}
      aria-label={playing ? t('speak.stopAudio') : t('speak.playAudio')}
      title={playing ? t('speak.stopAudio') : t('speak.playAudio')}
      data-testid={`speak-${id}`}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
        playing
          ? 'bg-primary text-white'
          : 'bg-violet-100 text-primary hover:bg-violet-200'} ${className}`}>
      {playing ? <Stop size={13} weight="fill" /> : <SpeakerHigh size={14} weight="fill" />}
    </button>
  );
}

export default SpeakButton;
