import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Microphone, Stop, X, Lightning, SpeakerHigh, SpeakerSlash,
  Warning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { startRecording as startCapture, appendAudio, isRecordingSupported } from '../lib/recorder';
import { SPEAKING_TASKS } from '../lib/tcf';
import { pickFrenchVoice } from '../lib/speak';
import { stripEcho } from '../lib/echo';
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

/* ---------------- how the examiner listens ----------------
   How long the learner may go quiet mid-sentence before the turn is treated as
   finished. The recogniser's own end-of-speech detection fires at the first
   breath, which handed half-finished questions to the examiner and had it
   answer over the top of the learner. Two seconds is long enough to think of
   the next word and short enough not to feel like a dead line.

   Where the examiner answers back, every millisecond of it is added to the
   wait before the reply, and two seconds on top of the reply itself read as
   the examiner being slow. 1.2 s still covers a breath. The monologue keeps
   the full two: nothing answers it, and the only cost of waiting is none. */
const SILENCE_MS = 2000;
const REPLY_SILENCE_MS = 1200;

/* Tâche 1 is not a roleplay, and treating it as one cost the candidate the
   thing being measured. The agent was asked to open the scene, so the two
   minutes started while a request was in flight and then ran on through ten to
   fifteen seconds of generated preamble — a sixth of the answer, spent
   listening. The real tâche 1 is one instruction and then two minutes that
   belong entirely to the candidate, so that is what this is: a fixed line, no
   request behind it, and no interruption afterwards. */
const TACHE1_OPENING = "Bonjour. Présentez-vous, s’il vous plaît.";

/* Chrome drops or clips the opening of an utterance queued in the same tick as
   cancel() — the engine is still tearing the previous one down and swallows
   whatever arrives during it. That is the examiner's first words going missing
   on every reply, since every reply cancels the last. Queue after it has
   settled, and only pay the delay when there was something to cancel. */
const CANCEL_SETTLE = 300;

/* The examiner has finished speaking when the speakers are quiet, not when
   the last utterance reports that it ended. The end event can come early, or
   the per-chunk deadline can move on while a slow voice is still talking, and
   the microphone opening then heard the examiner's last words and handed them
   to the grader as the candidate's. So the engine is asked until it says it is
   silent, for at most QUIET_MAX_MS — after which it is cancelled, so the voice
   is certainly off before the microphone is on — and ECHO_TAIL_MS more is left
   for the sound still leaving the speakers and the room. */
const QUIET_MAX_MS = 8000;
const ECHO_TAIL_MS = 450;

// Voices differ wildly in quality and the first French one in the list is
// usually the flat local fallback, and a French locale alone does not pick the
// good one. That scoring now lives in lib/speak.js, because the speaking result
// page needs the same voice and a second copy of this would drift: the
// FREE_TRIAL_TOTAL comment in lib/tcf.js is what five copies of one constant
// looks like once they disagree.

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

/* One roleplay turn is recorded only to be transcribed and then thrown away,
   and the candidate waits on its upload before the examiner can say anything.
   The browser's default bitrate records it at a quality nothing downstream
   uses — Whisper works from 16 kHz mono — so on a phone uplink that default
   is seconds of silence bought for nothing. 32 kb/s of Opus is transparent
   for speech and roughly a fifth of the bytes. The tâche's own recording,
   which is kept, played back and marked for pronunciation, is untouched. */
const TURN_BITRATE = 32000;

/* The microphone as a switch, not as an instruction.
   ---------------------------------------------------
   In tâche 2 the candidate owns both ends of their turn: the microphone is
   off until they turn it on, and the examiner does not answer until they turn
   it off again. A button that only ever said what to press next never said
   which of those two states the room was in, so a candidate who had missed a
   press talked into a microphone that was not listening. The switch is the
   state — thrown to the right and red while the mic is live — and the words
   beside it stay the instruction. */
const MicSwitch = ({ on }) => (
  <span aria-hidden="true"
    className={`inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-white/60 p-[2px] transition-colors ${
      on ? 'bg-white' : 'bg-white/25'}`}>
    <span className={`h-3 w-3 rounded-full transition-transform ${
      on ? 'translate-x-[14px] bg-rose-600' : 'translate-x-0 bg-white'}`} />
  </span>
);

// Chrome and Edge expose live recognition; elsewhere we record each turn and
// send it to the backend to be transcribed instead.
const SpeechRec = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const HAS_LIVE_STT = Boolean(SpeechRec);

export default function ConversationModal({
  consigne, tacheTitle, onCancel, onGraded, mode = 'tache2', segments = null,
  /* The Test Mode sitting this roleplay is a tâche of, when it is one. Sent
     with the grade so the answer is findable as part of that paper instead of
     living only in the tab it was spoken in. Absent for free practice. */
  examSet = null,
  /* The theme question this roleplay answers, in Practice mode. Sent with the
     grade for the same reason examSet is: without it the answer is a loose
     correction in the history list, and the card for the question it answered
     cannot say it has been practised or what it scored. Absent for the guided
     interview and for open practice, neither of which comes from the bank. */
  themeId = null,
  questionId = null,
  /* Given by a caller that does not want to hold the candidate while the
     answer is marked — a sitting, where the next tâche should start straight
     away. It receives the in-flight request instead of the grade: the marking
     carries on in the background and the caller decides what to do with it.
     Practice passes nothing and keeps the wait, because there the mark IS the
     point of pressing the button. */
  onSubmitted = null,
}) {
  const t = useT();
  /* A session given `segments` runs them in order, each with its own clock and
     its own brief for the agent; `consigne` stays the whole-session brief, so
     the intro card and the grader still see the session as one thing. */
  const segs = segments?.length ? segments : null;
  const [segIdx, setSegIdx] = useState(0);
  const segment = segs ? segs[segIdx] : null;
  // Free practice has no exam framing: no preparation, a longer window, and it
  // is metered by its own monthly allowance rather than an AI credit.
  const isFree = mode === 'free';
  // Tâche 1: the examiner asks once, then listens for the whole window.
  const isMonologue = mode === 'tache1';
  /* The exam is spoken, so the practice is spoken.
   *
   * Tâches 1 and 2 run with nothing written on screen: the examiner is heard
   * and answered, exactly as on the day. Reading the question instead of
   * listening to it, and reading back what you just said, are both things the
   * real room does not allow — and a candidate who has only ever practised
   * with the words in front of them has practised a different exam.
   *
   * Free practice keeps its transcript. It is not a tâche, nobody is being
   * examined, and being able to see what the recogniser heard is most of why
   * people use it. */
  const showTranscript = isFree;
  /* Tâche 2 is driven by the candidate, not by the microphone.
   *
   * Live recognition decides on its own when a turn has ended, and it decides
   * from silence. In an interaction that is the wrong judge: thinking about
   * how to phrase a request sounds exactly like having finished one, so the
   * examiner answers a question that was still being asked. Two presses — one
   * to start, one when you have actually finished — put the end of the turn
   * where the candidate says it is.
   *
   * Nothing downstream changes. The same recorder, the same transcription
   * call, the same exchange, the same grading: this only decides who closes
   * the turn. It is the path browsers without live recognition have always
   * taken, now taken by tâche 2 on every browser.
   */
  const manualTurns = mode === 'tache2';
  // One name for "the candidate presses to talk", whichever reason applies.
  const pressToTalk = manualTurns || !HAS_LIVE_STT;
  const { prep: PREP_SECONDS, speak: TOTAL_SECONDS } = TIMINGS[mode] || TIMINGS.tache2;
  // With segments the header still announces the whole session; the clock the
  // candidate watches belongs to the tâche actually running.
  const SPEAK_SECONDS = segs
    ? segs.reduce((sum, seg) => sum + seg.seconds, 0)
    : TOTAL_SECONDS;
  const hasPrep = PREP_SECONDS > 0;

  const [phase, setPhase] = useState('brief');      // brief | prep | live | grading
  const [prepLeft, setPrepLeft] = useState(PREP_SECONDS);
  const [left, setLeft] = useState(segment ? segment.seconds : SPEAK_SECONDS);
  const [turns, setTurns] = useState([]);
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState('idle');     // idle | listening | thinking | speaking
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [recording, setRecording] = useState(false);
  /* The candidate's clock does not run while the examiner is still giving the
     instruction. Nobody is being assessed on how long the question takes to
     ask, and before this the answer window opened on the request that produced
     it. */
  const [clockHeld, setClockHeld] = useState(false);

  const turnsRef = useRef([]);
  /* What the candidate has said in the turn still being heard, final words
     and the recogniser's current guess together. A turn only becomes a turn at
     a pause, so without this everything since the last pause was thrown away
     when the tâche ended — in a two-minute monologue that can be most of it,
     which is how a transcript came back missing half the answer. */
  const pendingRef = useRef('');
  // Set while finish() waits for the recogniser's last words.
  const flushRef = useRef(null);
  const finishingRef = useRef(false);
  /* The candidate's voice for the whole tâche, as one recording, sent with
     the answer and kept with the result so every correction can be played
     back as they actually said it. Paused whenever it is not the candidate's
     turn, so the examiner's voice through the speakers is never in it — and
     the recording and its transcript are the candidate alone. */
  const sessionRef = useRef(null);
  // Kept after a failed grade, so pressing Finish again still sends it.
  const lastSessionRef = useRef(null);
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
  // The brief the next agent turn is generated from. A ref because a tâche can
  // change under a turn that is already in flight, and the request must carry
  // the new brief rather than the one React last rendered.
  const consigneRef = useRef(segment ? segment.consigne : consigne);
  // The tâche a turn began under, against the tâche running now: a turn the
  // clock cut off keeps its words in the transcript, but must not be answered
  // under a tâche that is over.
  const segIdxRef = useRef(0);
  const turnSegRef = useRef(0);

  useEffect(() => {
    consigneRef.current = segment ? segment.consigne : consigne;
    segIdxRef.current = segIdx;
  }, [segment, consigne, segIdx]);
  useEffect(() => { turnsRef.current = turns; }, [turns]);

  /* What the examiner said last, for cutting its echo off the start of the
     candidate's next turn. See lib/echo. */
  // Reads only a ref, so it never changes and the callbacks using it do not
  // rebuild.
  const withoutEcho = useCallback((text) => {
    const all = turnsRef.current;
    let agent = '';
    for (let i = all.length - 1; i >= 0 && !agent; i -= 1) {
      if (all[i].role === 'agent') agent = all[i].text;
    }
    return stripEcho(text, agent);
  }, []);
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
    try { sessionRef.current?.cancel(); } catch (e) {}
    sessionRef.current = null;
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
    let settle = 0;
    try {
      if (synth.speaking || synth.pending) { synth.cancel(); settle = CANCEL_SETTLE; }
      // cancel() can leave the engine parked; a queue that is paused plays
      // nothing and the watchdog below then skips the chunk entirely.
      synth.resume();
    } catch (e) {}
    if (!voiceRef.current) voiceRef.current = pickFrenchVoice();
    const chunks = splitForSpeech(text);

    /* Every chunk has been said: wait for real silence before handing the
       turn back. See QUIET_MAX_MS. */
    const finished = () => {
      const since = Date.now();
      const check = () => {
        if (seq !== speakSeqRef.current || doneRef.current || mutedRef.current) return resolve();
        let busy = false;
        try { busy = synth.speaking || synth.pending; } catch (e) { /* no engine left */ }
        if (busy && Date.now() - since < QUIET_MAX_MS) { setTimeout(check, 100); return undefined; }
        if (busy) { try { synth.cancel(); } catch (e) { /* already stopped */ } }
        setTimeout(resolve, ECHO_TAIL_MS);
        return undefined;
      };
      check();
    };

    let i = 0;
    const sayNext = () => {
      // Superseded, muted or closed: stop here and let the caller move on.
      if (seq !== speakSeqRef.current || doneRef.current || mutedRef.current) return resolve();
      if (i >= chunks.length) return finished();
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

    setTimeout(sayNext, settle);
  }), []);

  /* ---------------- speech in ---------------- */
  const listen = useCallback(() => {
    const segAtStart = segIdxRef.current;
    if (doneRef.current) return;
    // Both fallbacks land here: a browser that cannot listen live, and a
    // tâche that has chosen not to. Either way the button owns the turn.
    if (!HAS_LIVE_STT || manualTurns) { setStatus('idle'); return; }
    try {
      const rec = new SpeechRec();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      // Continuous, so a pause for breath does not end the turn. This was
      // false, which made the browser close the session at the first silence
      // it detected — the examiner replied to half a question, and the words
      // spoken after the pause were lost with the session that ended.
      rec.continuous = true;

      let finalText = '';
      let lastLive = '';
      // Both halves: what the recogniser has settled on, and what it is still
      // deciding. The second is a guess, but a guessed word is closer to what
      // was said than a missing one.
      const current = () => `${finalText} ${lastLive}`.replace(/\s+/g, ' ').trim();
      let silence = null;
      let fallback = null;
      // The silence timer and onend can both decide the turn is over. Whoever
      // gets there first wins; without this the turn was sent twice.
      let handed = false;

      const clearSilence = () => {
        if (silence) { clearTimeout(silence); silence = null; }
        if (fallback) { clearTimeout(fallback); fallback = null; }
      };

      const hand = (heard) => {
        if (handed) return;
        handed = true;
        clearSilence();
        setInterim('');
        const text = withoutEcho(heard);
        // finish() is collecting these words itself; leave them for it.
        if (doneRef.current) return;
        pendingRef.current = '';
        if (segAtStart !== segIdxRef.current) {
          // The tâche ran out mid-turn. What the candidate managed to say still
          // belongs in the transcript the grader reads; the answer to it does
          // not, because the next tâche is already opening.
          if (text) {
            turnsRef.current = [...turnsRef.current, { role: 'candidate', text }];
            setTurns(turnsRef.current);
          }
          return;
        }
        if (text) sendTurnRef.current?.(text);
        else listenRef.current?.();   // heard nothing; keep the mic open
      };

      // Restarted on every result, so the countdown measures silence since the
      // last word rather than time since the turn began.
      const armSilence = () => {
        clearSilence();
        silence = setTimeout(() => {
          if (!current()) return;            // nothing said yet — keep waiting
          /* Stopped, then handed over when the recogniser has finished. It
             settles the last phrase only as it stops, and handing the turn
             over first — as this did — dropped those words every time. The
             fallback covers an engine that never reports the end. */
          try { rec.stop(); } catch (e) { /* already stopping */ }
          fallback = setTimeout(() => hand(current()), 1500);
        }, isMonologue ? SILENCE_MS : REPLY_SILENCE_MS);
      };

      rec.onresult = (e) => {
        let live = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else live += r[0].transcript;
        }
        lastLive = live;
        pendingRef.current = current();
        setInterim(live);
        armSilence();
      };
      // Still talking: cancel any countdown armed by the trailing silence of
      // the previous phrase.
      rec.onspeechstart = clearSilence;
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError(t('conv.micDenied'));
          doneRef.current = true;
        }
      };
      rec.onend = () => {
        clearSilence();
        // finish() asked for the last words: they are in pendingRef now.
        if (flushRef.current) flushRef.current();
        // Continuous sessions still end on their own — a network blip, or the
        // mobile engine's own limit. Whatever was captured is the turn.
        hand(current());
      };
      // The status used to be set before start(), so the panel said "listening"
      // while the audio stream was still opening and the first word went into
      // a microphone that was not recording yet. onstart is the browser saying
      // the service is actually live.
      rec.onstart = () => setStatus('listening');
      recRef.current = rec;
      setStatus('starting');
      rec.start();
    } catch (e) {
      setStatus('idle');
    }
    // `t` is memoised on the active language, so this only rebuilds on a
    // language switch — which is exactly when the error copy must change.
    // `manualTurns` comes off the mode prop and never changes for a mounted
    // modal; it is declared so the check above cannot go stale.
  }, [t, manualTurns, withoutEcho, isMonologue]);
  useEffect(() => { listenRef.current = listen; }, [listen]);

  /* ---------------- one exchange ---------------- */
  const exchange = useCallback(async (history) => {
    setStatus('thinking');
    setError('');
    try {
      const { data } = await api.post('/api/speaking/converse',
                                      { consigne: consigneRef.current, history, mode });
      const reply = (data?.reply || '').trim();
      if (!reply) throw new Error('empty reply');
      const after = [...history, { role: 'agent', text: reply }];
      turnsRef.current = after;
      setTurns(after);
      if (doneRef.current) return;
      setStatus('speaking');
      await speak(reply);
      if (!doneRef.current) listenRef.current?.();
    } catch (err) {
      setStatus('idle');
      setError(errMsg(err, t('conv.errNoReply')));
    }
  }, [mode, speak, t]);

  const sendTurn = useCallback((text) => {
    const next = [...turnsRef.current, { role: 'candidate', text }];
    turnsRef.current = next;
    setTurns(next);
    /* Tâche 1 has no second speaker. A two-second breath is a breath, not an
       invitation — answering into it broke the candidate's presentation in
       half and spent their window on a reply nobody asked for. The words are
       kept for the grader and the microphone simply stays open. */
    if (isMonologue) {
      setStatus('idle');
      if (!doneRef.current) listenRef.current?.();
      return;
    }
    exchange(next);
  }, [exchange, isMonologue]);
  useEffect(() => { sendTurnRef.current = sendTurn; }, [sendTurn]);

  /* ---------------- push-to-talk fallback ---------------- */
  const startPushToTalk = async () => {
    if (!isRecordingSupported()) return toast.error(t('conv.micDenied'));
    try {
      // The container is negotiated rather than assumed: Safari records MP4,
      // and labelling that as audio/webm made every iOS turn fail to
      // transcribe. See lib/recorder.js.
      captureRef.current = await startCapture({ basename: 'turn',
                                                audioBitsPerSecond: TURN_BITRATE });
      turnSegRef.current = segIdxRef.current;
      setRecording(true);
      setStatus('listening');
    } catch (err) {
      toast.error(t('conv.micDenied'));
    }
  };

  /* The finished turn, transcribed and — where somebody answers it — answered
     in the SAME request. See /api/speaking/turn/reply.

     This used to be two: the audio went up to be transcribed, the words came
     back, and only then did the dialogue go up to be answered. The candidate
     waited through both round trips with the examiner silent, and the second
     one re-did everything the first had already done — the session, the
     budget check, the trip itself — to add nothing but the reply. Tâche 1
     still asks for the words alone, because nothing answers a monologue. */
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
    // Cleared here rather than in exchange(), which this path no longer goes
    // through: a warning left over from a failed turn must not sit above a
    // turn that is going fine.
    setError('');
    const form = appendAudio(new FormData(), recorded);
    const headers = { 'Content-Type': 'multipart/form-data' };
    try {
      if (isMonologue) {
        const { data } = await api.post('/api/speaking/turn/transcribe', form, { headers });
        const text = withoutEcho((data?.text || '').trim());
        if (turnSegRef.current !== segIdxRef.current) {
          if (text) setTurns((prev) => [...prev, { role: 'candidate', text }]);
          return;                     // the tâche moved on while this uploaded
        }
        if (text) sendTurnRef.current?.(text);
        else { setStatus('idle'); toast.error(t('conv.noSpeech')); }
        return;
      }
      form.append('payload', JSON.stringify({
        consigne: consigneRef.current, history: turnsRef.current, mode,
      }));
      const { data } = await api.post('/api/speaking/turn/reply', form, { headers });
      // The examiner's echo is cut off server-side on this route: the reply is
      // written from these words, so they have to be the candidate's before
      // the model reads them rather than after it has answered them.
      const text = (data?.text || '').trim();
      const reply = (data?.reply || '').trim();
      if (doneRef.current) return;
      if (!text) { setStatus('idle'); toast.error(t('conv.noSpeech')); return; }
      const said = [...turnsRef.current, { role: 'candidate', text }];
      turnsRef.current = said;
      setTurns(said);
      if (turnSegRef.current !== segIdxRef.current) return;
      if (!reply) {
        /* Heard, but unanswered. The words stay in the transcript and the
           error bar's "Try again" asks for the reply on its own — losing a
           spoken turn because the examiner failed would cost the candidate
           more than the reply did. */
        setStatus('idle');
        setError(t('conv.errNoReply'));
        return;
      }
      const after = [...said, { role: 'agent', text: reply }];
      turnsRef.current = after;
      setTurns(after);
      setStatus('speaking');
      await speak(reply);
      if (!doneRef.current) listenRef.current?.();
    } catch (err) {
      setStatus('idle');
      setError(errMsg(err, t('conv.errTranscription')));
    }
  };

  /* ---------------- lifecycle ---------------- */
  const begin = async () => {
    setChecking(true);
    try {
      if (isRecordingSupported()) {
        /* Opening the recording is also the microphone check. Started here,
           inside the press, because some browsers only open a microphone
           from a gesture — and paused at once: nothing is kept until the
           candidate's first turn. */
        const capture = await startCapture({ basename: 'session' });
        try {
          capture.recorder.pause();
          sessionRef.current = capture;
        } catch (e) {
          // A recorder that cannot pause would keep the examiner's voice too.
          // No recording is better than one that is not the candidate's.
          capture.cancel();
        }
      } else {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((track) => track.stop());
      }
    } catch (err) {
      setChecking(false);
      return toast.error(t('conv.micDenied'));
    }
    setChecking(false);
    if (PREP_SECONDS > 0) setPhase('prep');
    else goLiveRef.current?.();
  };

  const goLive = useCallback(async () => {
    setPhase('live');
    // Held across the opening in every mode: the instruction is the examiner's
    // time, and the window the candidate is measured in starts after it.
    setClockHeld(true);
    try {
      if (isMonologue) {
        // No request behind it, so the candidate hears the instruction as soon
        // as they press start rather than after a round trip.
        setTurns([{ role: 'agent', text: TACHE1_OPENING }]);
        setStatus('speaking');
        await speak(TACHE1_OPENING);
      } else {
        await exchange([]);  // the agent opens the scene in character
      }
    } finally {
      setClockHeld(false);
    }
    if (isMonologue && !doneRef.current) listenRef.current?.();
  }, [exchange, isMonologue, speak]);
  useEffect(() => { goLiveRef.current = goLive; }, [goLive]);

  /* The words of the turn still in progress, once the recogniser has let go
     of them. Waits for its end event, which is when the last phrase is
     settled, and no more than a second and a bit for an engine that never
     sends one. */
  const flushSpeech = useCallback(() => new Promise((resolve) => {
    let done = false;
    const take = () => {
      if (done) return;
      done = true;
      flushRef.current = null;
      const text = pendingRef.current.trim();
      pendingRef.current = '';
      resolve(text);
    };
    const rec = recRef.current;
    if (!rec || !pendingRef.current.trim()) { take(); return; }
    flushRef.current = take;
    setTimeout(take, 1200);
    try { rec.stop(); } catch (e) { take(); }
  }), []);

  /* The push-to-talk turn still recording, transcribed rather than thrown
     away. Pressing Finish mid-sentence used to cancel the recording. */
  const flushRecording = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return '';
    captureRef.current = null;
    setRecording(false);
    try {
      const recorded = await capture.stop();
      if (!recorded.blob.size) return '';
      const { data } = await api.post('/api/speaking/turn/transcribe',
        appendAudio(new FormData(), recorded),
        { headers: { 'Content-Type': 'multipart/form-data' } });
      return withoutEcho((data?.text || '').trim());
    } catch (e) {
      return '';
    }
  }, [withoutEcho]);

  /* The tâche's recording, finished. Null when there is none: a browser that
     cannot record, or a recording with nothing in it. */
  const stopSession = useCallback(async () => {
    const capture = sessionRef.current;
    sessionRef.current = null;
    if (!capture) return null;
    try {
      const recorded = await capture.stop();
      return recorded.blob.size ? recorded : null;
    } catch (e) {
      return null;
    }
  }, []);

  const finish = useCallback(async () => {
    if (doneRef.current && phase === 'grading') return;
    if (finishingRef.current) return;
    finishingRef.current = true;
    // Nothing more is answered from here; the words already spoken are
    // collected before the microphone is closed.
    doneRef.current = true;
    const heard = await flushSpeech();
    const last = heard ? withoutEcho(heard) : await flushRecording();
    const session = (await stopSession()) || lastSessionRef.current;
    lastSessionRef.current = session;
    teardown();
    if (last) {
      turnsRef.current = [...turnsRef.current, { role: 'candidate', text: last }];
      setTurns(turnsRef.current);
    }
    finishingRef.current = false;
    const body = {
      consigne, history: turnsRef.current, mode,
      ...(examSet ? { exam_set: examSet } : {}),
      ...(themeId ? { theme_id: themeId } : {}),
      ...(questionId ? { question_id: questionId } : {}),
    };
    /* With the recording when there is one: the server transcribes it, keeps
       it with the result and times every word, which is what lets each
       correction play the candidate's own voice. */
    const send = () => {
      if (!session) return api.post('/api/speaking/converse/grade', body);
      const form = appendAudio(new FormData(), session);
      form.append('payload', JSON.stringify(body));
      return api.post('/api/speaking/converse/grade-audio', form,
        { headers: { 'Content-Type': 'multipart/form-data' } });
    };
    /* Handed over in flight, and this modal is done. The request is already
       on its way, so the marking is not skipped — it simply stops being
       something the candidate sits and watches between two tâches. */
    if (onSubmitted) {
      onSubmitted(send());
      return;
    }
    setPhase('grading');
    try {
      const { data } = await send();
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
  }, [consigne, themeId, questionId, onGraded, onSubmitted, onCancel, phase,
      teardown, flushSpeech, flushRecording, stopSession]);

  /* The recording runs only on the candidate's turn. Listening covers both
     ways of speaking — the live recogniser and the record button — and a
     monologue also records the moments between two of its own turns, when
     the recogniser restarts after a pause, because nobody else speaks in
     tâche 1. The examiner speaking or thinking is never recorded. */
  useEffect(() => {
    const recorder = sessionRef.current?.recorder;
    if (!recorder || phase !== 'live') return;
    const candidateTurn = status === 'listening' || status === 'starting'
      || (isMonologue && status === 'idle');
    try {
      if (candidateTurn && recorder.state === 'paused') recorder.resume();
      else if (!candidateTurn && recorder.state === 'recording') recorder.pause();
    } catch (e) { /* the recorder has already stopped */ }
  }, [status, phase, isMonologue]);

  // Wall-clock deadlines: the official 2 minutes of preparation and 3 min 30
  // of interaction must not stretch because the tab lost focus.
  const prepEndsRef = useRef(null);
  const liveEndsRef = useRef(null);
  // finish() drops back to 'live' when grading fails, and by then the clock is
  // already at zero — so the deadline below fired it again straight away, and
  // again after that: an unbounded retry loop, one error toast per pass. One
  // automatic attempt is enough; the Finish button is still there to retry by
  // hand, which also tells the learner something actually went wrong.
  const autoFinishedRef = useRef(false);

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

  /* A tâche whose clock has run out, handed over to the next one. The agent is
     cut off mid-sentence and the microphone closed, exactly as an examiner
     moving the paper on would: the point of the timer is that the tâche ends
     whether or not the exchange had finished. */
  const nextSegment = useCallback(() => {
    const next = segs?.[segIdx + 1];
    if (!next) return;
    speakSeqRef.current += 1;
    try { recRef.current?.abort?.(); } catch (e) { /* not listening */ }
    try { window.speechSynthesis?.cancel(); } catch (e) { /* not speaking */ }
    try { captureRef.current?.cancel(); } catch (e) { /* no push-to-talk turn */ }
    captureRef.current = null;
    setInterim('');
    consigneRef.current = next.consigne;
    setSegIdx((i) => i + 1);
    setLeft(next.seconds);
    liveEndsRef.current = Date.now() + next.seconds * 1000;
    segIdxRef.current = segIdx + 1;
    // The recogniser reports its final words asynchronously after abort(), so
    // the new tâche opens on the tick after they have landed in the transcript.
    setTimeout(() => { if (!doneRef.current) exchange(turnsRef.current); }, 250);
  }, [segs, segIdx, exchange]);

  useEffect(() => {
    // `clockHeld` clears when the opening has actually been spoken, and the
    // deadline is computed from that moment — so the candidate gets the whole
    // window however long the instruction took to deliver.
    if (phase !== 'live' || clockHeld) { liveEndsRef.current = null; return undefined; }
    if (liveEndsRef.current == null) liveEndsRef.current = Date.now() + left * 1000;

    const read = () => {
      const remaining = Math.max(0, Math.ceil((liveEndsRef.current - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining > 0) return;
      if (segs && segIdx < segs.length - 1) {
        nextSegment();
      } else if (!autoFinishedRef.current) {
        autoFinishedRef.current = true;
        finish();
      }
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
  }, [phase, clockHeld, finish, nextSegment, segIdx]);

  const spokenTurns = turns.filter((t) => t.role === 'candidate').length;
  const statusLabel = {
    starting: t('conv.stStarting'),
    listening: pressToTalk ? t('conv.stRecording') : t('conv.stListening'),
    thinking: t('conv.stThinking'),
    speaking: t('conv.stSpeaking'),
    idle: pressToTalk ? t('conv.stPressSpeak') : t('conv.stPaused'),
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
            {segs && (
              <ul className="mx-auto mt-4 max-w-sm space-y-1.5 text-left">
                {segs.map((seg, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-violet-50/60 px-3 py-2">
                    <span className="text-xs font-semibold text-gray-700">
                      {SPEAKING_TASKS[seg.taskType]?.name}
                    </span>
                    <span className="font-heading text-xs font-bold tabular-nums text-primary">
                      {fmt(seg.seconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
              <span className="flex items-center gap-2">
                {segs && (
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-primary"
                    data-testid="conv-segment">
                    {t('conv.taskOf', { n: segIdx + 1, total: segs.length })}
                  </span>
                )}
                <span className={`font-heading text-sm font-extrabold tabular-nums ${
                  left <= 30 ? 'text-red-600' : 'text-gray-900'}`}>{fmt(left)}</span>
              </span>
            </div>

            {/* The conversation, under exam conditions: heard, not read.
                Everything below is still transcribed server-side and still
                graded — see handleGraded. It is simply never put on screen. */}
            {!showTranscript && (
              <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-4 bg-gray-50/60 px-6 py-8 text-center"
                data-testid="conv-audio-only">
                <div className={`flex h-20 w-20 items-center justify-center rounded-full transition ${
                  status === 'listening' ? 'bg-red-50 ring-4 ring-red-100'
                    : status === 'speaking' ? 'bg-violet-50 ring-4 ring-violet-100'
                      : 'bg-white ring-4 ring-gray-100'}`}>
                  {status === 'speaking'
                    ? <SpeakerHigh size={32} weight="fill" className="animate-pulse text-primary" />
                    : <Microphone size={32} weight="fill" className={
                        status === 'listening' ? 'animate-pulse text-red-500' : 'text-gray-400'} />}
                </div>
                <p className="font-heading text-base font-bold text-gray-900">{statusLabel}</p>
                <p className="max-w-xs text-xs leading-relaxed text-gray-500">
                  {t('conv.audioOnlyHint')}
                </p>
                {turns.length > 0 && (
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-gray-500 ring-1 ring-gray-200"
                    data-testid="conv-exchange-count">
                    {t('conv.exchanges', { n: turns.filter((x) => x.role === 'candidate').length })}
                  </span>
                )}
              </div>
            )}

            {/* transcript */}
            {showTranscript && (
            <div ref={scrollRef} className="min-h-[220px] flex-1 space-y-3 overflow-y-auto bg-gray-50/60 px-6 py-4">
              {turns.length === 0 && status === 'thinking' && (
                <p className="py-8 text-center text-xs text-gray-400">{t('conv.agentThinking')}</p>
              )}
              {/* `turn`, not `t` — the loop variable used to shadow the
                  translator, which is why the two speaker labels below were
                  hardcoded French in an otherwise translated modal: t() was
                  unreachable inside this block. */}
              {turns.map((turn, i) => (
                <div key={i} className={`flex ${turn.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    turn.role === 'candidate'
                      ? 'rounded-br-sm bg-gradient-to-br from-primary to-fuchsia-600 text-white'
                      : 'rounded-bl-sm border border-violet-100 bg-white text-gray-800'}`}>
                    <p className={`mb-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      turn.role === 'candidate' ? 'text-white/70' : 'text-primary'}`}>
                      {turn.role === 'candidate' ? t('conv.speakerYou') : t('conv.speakerAgent')}
                    </p>
                    {turn.text}
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
            )}

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
                /* The same button, pressed a second time — and it carries the
                   switch, so the candidate can see the microphone is live as
                   well as read what pressing it will do. */
                <button onClick={stopPushToTalk}
                  data-testid="conv-stop-speaking"
                  aria-pressed="true"
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-red-500 !to-rose-600">
                  <MicSwitch on />
                  <span className="text-[10px] font-black uppercase tracking-[0.08em]">
                    {t('conv.micOn')}
                  </span>
                  <Stop size={16} weight="fill" /> {t('conv.pressWhenDone')}
                </button>
              ) : pressToTalk ? (
                /* Disabled while the examiner is thinking or talking — the one
                   thing the real room does not let you do is speak over them. */
                <button onClick={startPushToTalk} disabled={status === 'thinking' || status === 'speaking'}
                  data-testid="conv-start-speaking"
                  aria-pressed="false"
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-50">
                  <MicSwitch on={false} />
                  <span className="text-[10px] font-black uppercase tracking-[0.08em]">
                    {t('conv.micOff')}
                  </span>
                  <Microphone size={16} weight="fill" /> {t('conv.pressToSpeak')}
                </button>
              ) : status === 'idle' ? (
                /* Live recognition exists but stalled (denied mic, no network,
                   a failed exchange) - never leave the learner with no way to talk. */
                <button onClick={() => listenRef.current?.()}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <Microphone size={16} weight="fill" /> {t('conv.resumeListening')}
                </button>
              ) : null}
              {/* "Finish", not "Finish and analyse", when the marking is not
                  what happens next: in a sitting the tâche just ends and the
                  next one starts. Promising an analysis and then moving on
                  describes a different button. */}
              <button onClick={finish}
                className={`btn-outline justify-center ${status !== 'idle' && !pressToTalk && !recording ? 'flex-1' : ''}`}>
                <Lightning size={16} weight="fill" /> {onSubmitted ? t('conv.finishOnly') : t('conv.finish')}
              </button>
            </div>
            {pressToTalk && (
              <p className="px-6 pb-1 text-center text-[11px] font-semibold text-gray-500">
                {t('conv.pressHint')}
              </p>
            )}
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
