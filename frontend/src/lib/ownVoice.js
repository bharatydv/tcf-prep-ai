/* Playing back a slice of the candidate's own recording.
 *
 * The corrections table reads each mistake aloud. It used to read it in the
 * browser's synthesiser, which is the one voice that cannot teach
 * pronunciation: hearing a machine say « je suis originaire » correctly tells
 * a candidate nothing about what came out of their own mouth. This plays the
 * real half-second instead, and the synthesiser keeps the other column — the
 * correction, which by definition was never spoken and has no recording.
 *
 * Why Web Audio rather than an <audio> element with currentTime: the file is
 * whatever MediaRecorder produced, and a WebM stream from MediaRecorder
 * carries no cues, so seeking into it is unreliable-to-broken depending on the
 * browser and on how much has buffered. Decoding once into an AudioBuffer
 * makes every seek exact and instant, which is what a button pressed twelve
 * times down a table of corrections needs. A minute of speech is a couple of
 * megabytes decoded; it is fetched once, on the first press, and released with
 * the page.
 *
 * Mirrors the shape of useSpeak() on purpose — { play, stop, playingId,
 * supported } — so a button can take either and not know the difference.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function audioSupported() {
  try {
    return typeof window !== 'undefined'
      && !!(window.AudioContext || window.webkitAudioContext);
  } catch (e) {
    return false;
  }
}

export function useOwnVoice(submissionId, available = true) {
  const ctxRef = useRef(null);
  const bufferRef = useRef(null);
  const sourceRef = useRef(null);
  const loadingRef = useRef(null);
  const [playingId, setPlayingId] = useState(null);
  // Set when the recording turns out not to be fetchable — deleted by an
  // admin, or a session that has since expired. Hides the button rather than
  // leaving one that fails silently every time it is pressed.
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    // A new submission is a different recording; drop what was decoded.
    bufferRef.current = null;
    loadingRef.current = null;
    setBroken(false);
  }, [submissionId]);

  const stop = useCallback(() => {
    const src = sourceRef.current;
    sourceRef.current = null;
    setPlayingId(null);
    if (src) {
      try { src.onended = null; src.stop(); } catch (e) { /* already ended */ }
    }
  }, []);

  useEffect(() => () => {
    // Leaving the page mid-clip: stop it, and let go of the decoded audio.
    const src = sourceRef.current;
    if (src) { try { src.onended = null; src.stop(); } catch (e) { /* ended */ } }
    const ctx = ctxRef.current;
    if (ctx) { try { ctx.close(); } catch (e) { /* already closed */ } }
    ctxRef.current = null;
    bufferRef.current = null;
  }, []);

  const load = useCallback(async () => {
    if (bufferRef.current) return bufferRef.current;
    // Two buttons pressed before the first fetch lands must not start two
    // downloads of the same file.
    if (!loadingRef.current) {
      loadingRef.current = (async () => {
        const res = await fetch(`/api/submissions/${submissionId}/audio`,
          { credentials: 'include' });
        if (!res.ok) throw new Error(`audio ${res.status}`);
        const bytes = await res.arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!ctxRef.current) ctxRef.current = new Ctx();
        // Safari's decodeAudioData is callback-only in older versions; the
        // promise form is what every browser that reaches this supports.
        const buffer = await ctxRef.current.decodeAudioData(bytes);
        bufferRef.current = buffer;
        return buffer;
      })();
    }
    return loadingRef.current;
  }, [submissionId]);

  /* Play one clip: { start, end } in seconds. */
  const play = useCallback(async (clip, id) => {
    if (!clip || !submissionId) return;
    // Pressing the button that is already playing stops it — the same
    // contract as the synthesiser's, because it is the same button.
    if (playingId === id) { stop(); return; }
    stop();
    setPlayingId(id);
    let buffer;
    try {
      buffer = await load();
    } catch (e) {
      loadingRef.current = null;
      setPlayingId(null);
      setBroken(true);
      return;
    }
    try {
      const ctx = ctxRef.current;
      // A context created before a gesture starts suspended on some browsers.
      if (ctx.state === 'suspended') await ctx.resume();
      const from = Math.max(0, Math.min(clip.start, buffer.duration));
      const to = Math.max(from, Math.min(clip.end, buffer.duration));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => {
        // Only if this clip is still the one playing: a second press has
        // already moved the state on, and clearing it here would leave the
        // new button looking idle while it plays.
        if (sourceRef.current === src) { sourceRef.current = null; setPlayingId(null); }
      };
      sourceRef.current = src;
      src.start(0, from, Math.max(0.05, to - from));
    } catch (e) {
      setPlayingId(null);
    }
  }, [load, playingId, stop, submissionId]);

  return {
    play,
    stop,
    playingId,
    supported: Boolean(submissionId) && available && audioSupported() && !broken,
  };
}

export default useOwnVoice;
