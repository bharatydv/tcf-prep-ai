/* Speaking a French line aloud, in the browser.
 *
 * Extracted from ConversationModal, which worked this out the hard way and is
 * now the second caller rather than the only one. Two things here are not
 * obvious and both were bugs before they were code:
 *
 * 1. Chrome populates getVoices() asynchronously. Choosing at mount lands on
 *    the flat default voice, and the good one only appears after
 *    'voiceschanged' fires — so a voice has to be re-chosen when it does.
 * 2. A French locale is not enough. The list usually holds several fr-* voices
 *    of very different quality, and the first is typically the robotic local
 *    fallback, so they are scored rather than filtered.
 *
 * There is no API cost and no server involved: this is the platform's own
 * synthesiser. It is also the one part of a correction a learner cannot get
 * from reading — knowing « Elle peut accepter » is right does not tell you how
 * it sounds. */
import { useCallback, useEffect, useRef, useState } from 'react';

// Voices whose names carry these tend to be the cloud/neural ones; the rest is
// usually the flat local fallback. Score by the names the good ones carry.
const VOICE_HINTS = [/natural/i, /neural/i, /google/i, /online/i,
  /denise|d[ée]nise|am[ée]lie|audrey|julie|thomas|paul|c[ée]line/i];

export const pickFrenchVoice = () => {
  let voices = [];
  try { voices = window.speechSynthesis?.getVoices?.() || []; } catch (e) { return null; }
  const fr = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('fr'));
  if (!fr.length) return null;
  const score = (v) => {
    let s = 0;
    VOICE_HINTS.forEach((re, i) => { if (re.test(v.name || '')) s += (VOICE_HINTS.length - i) * 2; });
    if ((v.lang || '').toLowerCase().replace('_', '-') === 'fr-fr') s += 3;  // the exam plays metropolitan French
    if (v.localService) s -= 1;
    return s;
  };
  return fr.slice().sort((a, b) => score(b) - score(a))[0] || null;
};

export const speechSupported = () => {
  try { return typeof window !== 'undefined' && !!window.speechSynthesis; } catch (e) { return false; }
};

/* Play one French line, and report whether it is currently playing.
 *
 * Only one line plays at a time across the page: pressing a second button
 * cancels the first rather than layering two voices over each other. The
 * `speaking` flag is per-caller, so the button that started it is the one that
 * shows as playing. */
export function useSpeak() {
  const voiceRef = useRef(null);
  const [speakingId, setSpeakingId] = useState(null);
  const idRef = useRef(0);

  useEffect(() => {
    const choose = () => { voiceRef.current = pickFrenchVoice() || voiceRef.current; };
    choose();
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    synth.addEventListener?.('voiceschanged', choose);
    return () => {
      synth.removeEventListener?.('voiceschanged', choose);
      try { synth.cancel(); } catch (e) { /* leaving the page mid-sentence */ }
    };
  }, []);

  const stop = useCallback(() => {
    idRef.current += 1;
    setSpeakingId(null);
    try { window.speechSynthesis?.cancel(); } catch (e) { /* nothing to cancel */ }
  }, []);

  const speak = useCallback((text, id) => {
    const synth = window.speechSynthesis;
    if (!synth || !(text || '').trim()) return;
    // Pressing the button that is already playing stops it, which is what a
    // play button that has turned into a stop button has to do.
    if (speakingId === id) { stop(); return; }
    stop();
    const seq = idRef.current;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (voiceRef.current) u.voice = voiceRef.current;
    // A correction is a model to copy, so it is read a little under
    // conversational speed — fast enough not to sound like a drill, slow
    // enough to hear a liaison.
    u.rate = 0.95;
    const clear = () => { if (idRef.current === seq) setSpeakingId(null); };
    u.onend = clear;
    u.onerror = clear;
    setSpeakingId(id);
    try { synth.speak(u); } catch (e) { setSpeakingId(null); }
  }, [speakingId, stop]);

  return { speak, stop, speakingId, supported: speechSupported() };
}
