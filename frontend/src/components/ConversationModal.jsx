import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Microphone, Stop, X, Lightning, SpeakerHigh, SpeakerSlash,
  Warning, PaperPlaneTilt,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { startRecording as startCapture, appendAudio, isRecordingSupported } from '../lib/recorder';
import { useT } from '../i18n';

/* Tache 2 is a live roleplay: the candidate asks, an examiner answers. This
   modal plays that examiner - live speech in, AI reply spoken back out. */

/* Per-mode timings. Tâche 1 is the guided interview: no preparation, two
   minutes of speaking. Tâche 2's 5 min 30 s includes 2 min of preparation, so
   the exchange gets the remainder. Free practice is a longer, unpressured
   window with no exam framing. */
const TIMINGS = {
  tache1: { prep: 0, speak: 120 },
  tache2: { prep: 120, speak: 210 },
  free: { prep: 0, speak: 600 },
};

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------------- how the examiner sounds ----------------
   A single long utterance comes out flat and hurried, which is the main reason
   the partner sounded like a screen reader. Each clause is spoken as its own
   utterance instead: the browser restarts its intonation contour on every one,
   and the gap we leave between them is a real breath rather than a comma the
   engine races past. */
const SPEECH_RATE = 0.9;        // just under conversational pace, still not sluggish
const PAUSE_SENTENCE = 340;     // ms of silence after . ! ?
const PAUSE_CLAUSE = 150;       // ms after , ; :
const CHUNK_MIN = 18;           // a chunk shorter than this absorbs the next one
const TAIL_MIN = 8;             // « oui. », « merci. » — too small to stand alone

// A queued utterance that never fires onend leaves the caller awaiting speech
// that already stopped — and the learner with no button to talk, because the
// escape hatch only appears once the status falls back to idle. Chrome does
// exactly that with a backgrounded tab, so every chunk carries a deadline:
// roughly twice how long it could plausibly take to say at SPEECH_RATE.
const chunkDeadline = (chunk) => 2000 + chunk.length * 140;

// Voices differ wildly in quality and the first French one in the list is
// usually the flat local fallback. Score by the names the good ones carry.
const VOICE_HINTS = [/natural/i, /neural/i, /google/i, /online/i,
  /denise|d[ée]nise|am[ée]lie|audrey|julie|thomas|paul|c[ée]line/i];

const pickFrenchVoice = () => {
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

const splitForSpeech = (text) => {
  const pieces = text.match(/[^.!?…,;:]+[.!?…,;:]*/g) || [text];
  const out = [];
  pieces.forEach((raw) => {
    const piece = raw.trim();
    if (!piece) return;
    const prev = out[out.length - 1];
    // « Alors, » on its own sounds clipped, so glue tiny fragments to their
    // neighbour — but never across a full stop, where the pause belongs, and
    // never once the running chunk is long enough to carry the pause itself.
    if (prev && !/[.!?…]$/.test(prev)
        && (prev.length < CHUNK_MIN || piece.length < TAIL_MIN)) {
      out[out.length - 1] = `${prev} ${piece}`;
    } else {
      out.push(piece);
    }
  });
  return out;
};

// Chrome and Edge expose live recognition; elsewhere we record each turn and
// send it to the backend to be transcribed instead.
const SpeechRec = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const HAS_LIVE_STT = Boolean(SpeechRec);

export default function ConversationModal({
  consigne, tacheTitle, onCancel, onGraded, mode = 'tache2',
}) {
  const t = useT();
  // Free practice has no exam framing: no preparation, a longer window, and it
  // is metered by its own monthly allowance rather than an AI credit.
  const isFree = mode === 'free';
  const { prep: PREP_SECONDS, speak: SPEAK_SECONDS } = TIMINGS[mode] || TIMINGS.tache2;
  const hasPrep = PREP_SECONDS > 0;

  const [phase, setPhase] = useState('brief');      // brief | prep | live | grading
  const [prepLeft, setPrepLeft] = useState(PREP_SECONDS);
  const [left, setLeft] = useState(SPEAK_SECONDS);
  const [turns, setTurns] = useState([]);
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState('idle');     // idle | listening | thinking | speaking
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [recording, setRecording] = useState(false);

  const turnsRef = useRef([]);
  const mutedRef = useRef(false);
  const doneRef = useRef(false);
  const recRef = useRef(null);
  // The push-to-talk capture handle from lib/recorder.js, which owns the
  // MediaRecorder and the microphone track it opened.
  const captureRef = useRef(null);
  const scrollRef = useRef(null);
  // Broken out into refs because the recognition callbacks below reference each
  // other, and a plain const would capture a stale version.
  const sendTurnRef = useRef(null);
  const listenRef = useRef(null);
  const goLiveRef = useRef(null);
  // Bumped whenever speech is superseded (new reply, mute, teardown) so the
  // chunk queue of an older utterance stops instead of talking over the mic.
  const speakSeqRef = useRef(0);
  const voiceRef = useRef(null);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // The voice list loads asynchronously in Chrome, and picking before it
  // arrives lands on the default robotic voice — so choose again when it fires.
  useEffect(() => {
    const choose = () => { voiceRef.current = pickFrenchVoice() || voiceRef.current; };
    choose();
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    synth.addEventListener?.('voiceschanged', choose);
    return () => synth.removeEventListener?.('voiceschanged', choose);
  }, []);

  // Muting mid-reply must silence the reply in progress, not just the next one.
  useEffect(() => {
    if (!muted) return;
    speakSeqRef.current += 1;
    try { window.speechSynthesis?.cancel(); } catch (e) {}
  }, [muted]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, interim, status]);

  const teardown = useCallback(() => {
    doneRef.current = true;
    speakSeqRef.current += 1;
    try { recRef.current?.abort?.(); } catch (e) {}
    try { recRef.current?.stop?.(); } catch (e) {}
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    // cancel() stops the recorder and releases the microphone track, so
    // closing the modal mid-turn never leaves the mic indicator lit.
    try { captureRef.current?.cancel(); } catch (e) {}
    captureRef.current = null;
  }, []);

  const cancel = () => { teardown(); onCancel(); };

  // Lock page scroll; Escape abandons.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- speech out ---------------- */
  const speak = useCallback((text) => new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (mutedRef.current || !synth || !text) return resolve();
    const seq = (speakSeqRef.current += 1);
    try { synth.cancel(); } catch (e) {}
    if (!voiceRef.current) voiceRef.current = pickFrenchVoice();
    const chunks = splitForSpeech(text);

    let i = 0;
    const sayNext = () => {
      // Superseded, muted or closed: stop here and let the caller move on.
      if (seq !== speakSeqRef.current || doneRef.current || mutedRef.current
          || i >= chunks.length) return resolve();
      const chunk = chunks[i];
      i += 1;
      const endsSentence = /[.!?…]$/.test(chunk);
      try {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = 'fr-FR';
        if (voiceRef.current) u.voice = voiceRef.current;
        u.rate = SPEECH_RATE;
        // A question lifts at the end; statements alternate by a hair so a run
        // of them does not settle into a monotone.
        u.pitch = /\?$/.test(chunk) ? 1.08 : 1 - (i % 2) * 0.04;
        let settled = false;
        const after = () => {
          if (settled) return undefined;          // onend and the deadline can race
          settled = true;
          clearTimeout(watchdog);
          if (seq !== speakSeqRef.current) return resolve();
          setTimeout(sayNext, endsSentence ? PAUSE_SENTENCE : PAUSE_CLAUSE);
          return undefined;
        };
        const watchdog = setTimeout(after, chunkDeadline(chunk));
        u.onend = after;
        u.onerror = after;
        synth.speak(u);
      } catch (e) {
        resolve();
      }
      return undefined;
    };

    sayNext();
  }), []);

  /* ---------------- speech in ---------------- */
  const listen = useCallback(() => {
    if (doneRef.current) return;
    if (!HAS_LIVE_STT) { setStatus('idle'); return; }   // fallback uses the button
    try {
      const rec = new SpeechRec();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      rec.onresult = (e) => {
        let live = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else live += r[0].transcript;
        }
        setInterim(live);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError(t('conv.micDenied'));
          doneRef.current = true;
        }
      };
      rec.onend = () => {
        setInterim('');
        if (doneRef.current) return;
        const text = finalText.trim();
        if (text) sendTurnRef.current?.(text);
        else listenRef.current?.();   // heard nothing; keep the mic open
      };
      recRef.current = rec;
      setStatus('listening');
      rec.start();
    } catch (e) {
      setStatus('idle');
    }
    // `t` is memoised on the active language, so this only rebuilds on a
    // language switch — which is exactly when the error copy must change.
  }, [t]);
  useEffect(() => { listenRef.current = listen; }, [listen]);

  /* ---------------- one exchange ---------------- */
  const exchange = useCallback(async (history) => {
    setStatus('thinking');
    setError('');
    try {
      const { data } = await api.post('/api/speaking/converse', { consigne, history, mode });
      const reply = (data?.reply || '').trim();
      if (!reply) throw new Error('empty reply');
      const after = [...history, { role: 'agent', text: reply }];
      setTurns(after);
      if (doneRef.current) return;
      setStatus('speaking');
      await speak(reply);
      if (!doneRef.current) listenRef.current?.();
    } catch (err) {
      setStatus('idle');
      setError(errMsg(err, t('conv.errNoReply')));
    }
  }, [consigne, mode, speak, t]);

  const sendTurn = useCallback((text) => {
    const next = [...turnsRef.current, { role: 'candidate', text }];
    setTurns(next);
    exchange(next);
  }, [exchange]);
  useEffect(() => { sendTurnRef.current = sendTurn; }, [sendTurn]);

  /* ---------------- push-to-talk fallback ---------------- */
  const startPushToTalk = async () => {
    if (!isRecordingSupported()) return toast.error(t('conv.micDenied'));
    try {
      // The container is negotiated rather than assumed: Safari records MP4,
      // and labelling that as audio/webm made every iOS turn fail to
      // transcribe. See lib/recorder.js.
      captureRef.current = await startCapture({ basename: 'turn' });
      setRecording(true);
      setStatus('listening');
    } catch (err) {
      toast.error(t('conv.micDenied'));
    }
  };

  const stopPushToTalk = async () => {
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    setRecording(false);
    let recorded;
    try {
      recorded = await capture.stop();
    } catch {
      setStatus('idle');
      return;
    }
    if (!recorded.blob.size || doneRef.current) { setStatus('idle'); return; }
    setStatus('thinking');
    try {
      const { data } = await api.post('/api/speaking/turn/transcribe',
        appendAudio(new FormData(), recorded),
        { headers: { 'Content-Type': 'multipart/form-data' } });
      const text = (data?.text || '').trim();
      if (text) sendTurnRef.current?.(text);
      else { setStatus('idle'); toast.error(t('conv.noSpeech')); }
    } catch (err) {
      setStatus('idle');
      setError(errMsg(err, t('conv.errTranscription')));
    }
  };

  /* ---------------- lifecycle ---------------- */
  const begin = async () => {
    setChecking(true);
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setChecking(false);
      return toast.error(t('conv.micDenied'));
    }
    setChecking(false);
    if (PREP_SECONDS > 0) setPhase('prep');
    else goLiveRef.current?.();
  };

  const goLive = useCallback(() => {
    setPhase('live');
    exchange([]);            // the agent opens the scene in character
  }, [exchange]);
  useEffect(() => { goLiveRef.current = goLive; }, [goLive]);

  const finish = useCallback(async () => {
    if (doneRef.current && phase === 'grading') return;
    teardown();
    setPhase('grading');
    try {
      const { data } = await api.post('/api/speaking/converse/grade', {
        consigne, history: turnsRef.current, mode,
      });
      onGraded(data);
    } catch (err) {
      if (err?.response?.status === 402) {
        // The paywall is already up; close the roleplay behind it rather than
        // stacking an error toast on top.
        onCancel();
        return;
      }
      toast.error(errMsg(err, t('conv.errAnalysis')));
      doneRef.current = false;
      setPhase('live');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consigne, onGraded, onCancel, phase, teardown]);

  // Wall-clock deadlines: the official 2 minutes of preparation and 3 min 30
  // of interaction must not stretch because the tab lost focus.
  const prepEndsRef = useRef(null);
  const liveEndsRef = useRef(null);

  useEffect(() => {
    if (phase !== 'prep') { prepEndsRef.current = null; return undefined; }
    if (prepEndsRef.current == null) prepEndsRef.current = Date.now() + prepLeft * 1000;

    const read = () => {
      const remaining = Math.max(0, Math.ceil((prepEndsRef.current - Date.now()) / 1000));
      setPrepLeft(remaining);
      if (remaining <= 0) goLive();
    };

    read();
    const id = setInterval(read, 250);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, goLive]);

  useEffect(() => {
    if (phase !== 'live') { liveEndsRef.current = null; return undefined; }
    if (liveEndsRef.current == null) liveEndsRef.current = Date.now() + left * 1000;

    const read = () => {
      const remaining = Math.max(0, Math.ceil((liveEndsRef.current - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0) finish();
    };

    read();
    const id = setInterval(read, 250);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, finish]);

  const spokenTurns = turns.filter((t) => t.role === 'candidate').length;
  const statusLabel = {
    listening: HAS_LIVE_STT ? t('conv.stListening') : t('conv.stRecording'),
    thinking: t('conv.stThinking'),
    speaking: t('conv.stSpeaking'),
    idle: HAS_LIVE_STT ? t('conv.stPaused') : t('conv.stPressSpeak'),
  }[status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={t('conv.titleAria')}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* HEADER */}
        <div className="flex items-start gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-6 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Microphone size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-bold leading-snug">{tacheTitle}</p>
            <p className="text-[11px] text-white/80">
              {hasPrep
                ? t('conv.metaRoleplay', { prep: fmt(PREP_SECONDS), speak: fmt(SPEAK_SECONDS) })
                : isFree
                  ? t('conv.metaAllTasks', { speak: fmt(SPEAK_SECONDS) })
                  : t('conv.metaInterview', { speak: fmt(SPEAK_SECONDS) })}
            </p>
          </div>
          {phase === 'live' && (
            <button onClick={() => setMuted((m) => !m)} aria-label={muted ? t('conv.unmuteAria') : t('conv.muteAria')}
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white">
              {muted ? <SpeakerSlash size={18} weight="fill" /> : <SpeakerHigh size={18} weight="fill" />}
            </button>
          )}
          {phase !== 'grading' && (
            <button onClick={cancel} aria-label={t('conv.closeAria')}
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white">
              <X size={18} weight="bold" />
            </button>
          )}
        </div>

        {/* CONSIGNE */}
        {phase !== 'grading' && (
          <div className="border-b border-violet-100 bg-violet-50/40 px-6 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">{t('conv.consigne')}</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-800">{consigne}</p>
          </div>
        )}

        {/* BODY */}
        {phase === 'brief' && (
          <div className="px-6 py-6 text-center">
            <p className="text-sm leading-relaxed text-gray-600">
              {isFree ? (
                t('conv.briefAllTasks', { speak: fmt(SPEAK_SECONDS) })
              ) : hasPrep ? (
                <>{t('conv.twoWayA')} <strong>{t('conv.twoWayB')}</strong>
                  {t('conv.twoWayC', { prep: fmt(PREP_SECONDS), speak: fmt(SPEAK_SECONDS) })}</>
              ) : (
                t('conv.briefInterview', { speak: fmt(SPEAK_SECONDS) })
              )}
            </p>
            {!HAS_LIVE_STT && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {t('conv.noLiveStt')}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button onClick={begin} disabled={checking}
                className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60">
                {checking
                  ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {t('conv.mic')}</>
                  : <><Microphone size={16} weight="fill" />
                      {hasPrep ? t('conv.startPrep') : t('conv.startSpeak')}</>}
              </button>
              <button onClick={cancel} className="btn-outline flex-1 justify-center">{t('conv.cancel')}</button>
            </div>
          </div>
        )}

        {phase === 'prep' && (
          <div className="px-6 py-6 text-center">
            <p className="font-heading text-5xl font-extrabold tabular-nums text-primary">{fmt(prepLeft)}</p>
            <p className="mt-2 font-heading text-sm font-bold text-gray-900">{t('conv.preparation')}</p>
            <p className="mt-1 text-xs text-gray-500">
              {t('conv.prepHint')}
            </p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-600 transition-all duration-1000"
                style={{ width: `${((PREP_SECONDS - prepLeft) / PREP_SECONDS) * 100}%` }} />
            </div>
            <button onClick={goLive} className="btn-outline mt-5 w-full justify-center">
              {t('conv.start')}
            </button>
          </div>
        )}

        {phase === 'live' && (
          <>
            {/* timer + status */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-2.5">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                status === 'listening' ? 'bg-red-50 text-red-600'
                  : status === 'speaking' ? 'bg-violet-50 text-primary'
                  : status === 'thinking' ? 'bg-gray-100 text-gray-500'
                  : 'bg-gray-100 text-gray-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  status === 'listening' ? 'bg-red-500 animate-pulse'
                    : status === 'speaking' ? 'bg-primary animate-pulse' : 'bg-gray-400'}`} />
                {statusLabel}
              </span>
              <span className={`font-heading text-sm font-extrabold tabular-nums ${
                left <= 30 ? 'text-red-600' : 'text-gray-900'}`}>{fmt(left)}</span>
            </div>

            {/* transcript */}
            <div ref={scrollRef} className="min-h-[220px] flex-1 space-y-3 overflow-y-auto bg-gray-50/60 px-6 py-4">
              {turns.length === 0 && status === 'thinking' && (
                <p className="py-8 text-center text-xs text-gray-400">{t('conv.agentThinking')}</p>
              )}
              {turns.map((t, i) => (
                <div key={i} className={`flex ${t.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    t.role === 'candidate'
                      ? 'rounded-br-sm bg-gradient-to-br from-primary to-fuchsia-600 text-white'
                      : 'rounded-bl-sm border border-violet-100 bg-white text-gray-800'}`}>
                    <p className={`mb-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      t.role === 'candidate' ? 'text-white/70' : 'text-primary'}`}>
                      {t.role === 'candidate' ? 'Vous' : 'Agent'}
                    </p>
                    {t.text}
                  </div>
                </div>
              ))}
              {interim && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-dashed border-violet-300 bg-white px-3.5 py-2.5 text-sm italic text-gray-500">
                    {interim}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-6 py-2.5 text-xs text-amber-800">
                <Warning size={15} weight="fill" className="mt-0.5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={() => exchange(turnsRef.current)} className="font-bold underline">{t('conv.retry')}</button>
              </div>
            )}

            {/* controls */}
            <div className="flex flex-col gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row">
              {recording ? (
                <button onClick={stopPushToTalk}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-red-500 !to-rose-600">
                  <Stop size={16} weight="fill" /> {t('conv.sendTurn')}
                </button>
              ) : !HAS_LIVE_STT ? (
                <button onClick={startPushToTalk} disabled={status === 'thinking' || status === 'speaking'}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-50">
                  <PaperPlaneTilt size={16} weight="fill" /> {t('conv.speak')}
                </button>
              ) : status === 'idle' ? (
                /* Live recognition exists but stalled (denied mic, no network,
                   a failed exchange) - never leave the learner with no way to talk. */
                <button onClick={() => listenRef.current?.()}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <Microphone size={16} weight="fill" /> {t('conv.resumeListening')}
                </button>
              ) : null}
              <button onClick={finish}
                className={`btn-outline justify-center ${status !== 'idle' && HAS_LIVE_STT && !recording ? 'flex-1' : ''}`}>
                <Lightning size={16} weight="fill" /> {t('conv.finish')}
              </button>
            </div>
            <p className="px-6 pb-3 text-center text-[10px] text-gray-400">
              {t('conv.turnHint', { n: spokenTurns })}
            </p>
          </>
        )}

        {phase === 'grading' && (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
            <p className="mt-4 font-heading text-sm font-bold text-gray-900">{t('conv.analysing')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('conv.gradedOn')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
