import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Microphone, Stop, X, Lightning, SpeakerHigh, SpeakerSlash,
  Warning, PaperPlaneTilt,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';

/* Tache 2 is a live roleplay: the candidate asks, an examiner answers. This
   modal plays that examiner - live speech in, AI reply spoken back out. */

const TACHE2_PREP_SECONDS = 120;   // the 2 min of preparation the task includes
const TACHE2_SPEAK_SECONDS = 210;  // the remainder of the 5 min 30 s budget
const FREE_TALK_SECONDS = 600;     // open practice: a longer, unpressured window

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// Chrome and Edge expose live recognition; elsewhere we record each turn and
// send it to the backend to be transcribed instead.
const SpeechRec = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const HAS_LIVE_STT = Boolean(SpeechRec);

export default function ConversationModal({
  consigne, tacheTitle, onCancel, onGraded, mode = 'tache2',
}) {
  // Free practice has no exam framing: no preparation, a longer window, and it
  // is metered by its own monthly allowance rather than an AI credit.
  const isFree = mode === 'free';
  const PREP_SECONDS = isFree ? 0 : TACHE2_PREP_SECONDS;
  const SPEAK_SECONDS = isFree ? FREE_TALK_SECONDS : TACHE2_SPEAK_SECONDS;

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
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const scrollRef = useRef(null);
  // Broken out into refs because the recognition callbacks below reference each
  // other, and a plain const would capture a stale version.
  const sendTurnRef = useRef(null);
  const listenRef = useRef(null);
  const goLiveRef = useRef(null);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Voice list loads asynchronously in Chrome; touching it early warms it up.
  useEffect(() => {
    try { window.speechSynthesis?.getVoices(); } catch (e) {}
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, interim, status]);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const teardown = useCallback(() => {
    doneRef.current = true;
    try { recRef.current?.abort?.(); } catch (e) {}
    try { recRef.current?.stop?.(); } catch (e) {}
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    try { if (mrRef.current?.state === 'recording') mrRef.current.stop(); } catch (e) {}
    releaseStream();
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
    if (mutedRef.current || !window.speechSynthesis || !text) return resolve();
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      const voices = window.speechSynthesis.getVoices() || [];
      const fr = voices.find((v) => (v.lang || '').toLowerCase().startsWith('fr'));
      if (fr) u.voice = fr;
      u.rate = 0.98;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch (e) {
      resolve();
    }
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
          setError("Micro refusé. Autorisez le microphone puis relancez la conversation.");
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
  }, []);
  useEffect(() => { listenRef.current = listen; }, [listen]);

  /* ---------------- one exchange ---------------- */
  const exchange = useCallback(async (history) => {
    setStatus('thinking');
    setError('');
    try {
      const { data } = await api.post('/api/speaking/converse', { consigne, history });
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
      setError(errMsg(err, "L'interlocuteur IA n'a pas répondu."));
    }
  }, [consigne, speak]);

  const sendTurn = useCallback((text) => {
    const next = [...turnsRef.current, { role: 'candidate', text }];
    setTurns(next);
    exchange(next);
  }, [exchange]);
  useEffect(() => { sendTurnRef.current = sendTurn; }, [sendTurn]);

  /* ---------------- push-to-talk fallback ---------------- */
  const startPushToTalk = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (!blob.size || doneRef.current) return;
        setStatus('thinking');
        try {
          const form = new FormData();
          form.append('audio', blob, 'turn.webm');
          const { data } = await api.post('/api/speaking/turn/transcribe', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const text = (data?.text || '').trim();
          if (text) sendTurnRef.current?.(text);
          else { setStatus('idle'); toast.error('Aucune parole détectée. Réessayez.'); }
        } catch (err) {
          setStatus('idle');
          setError(errMsg(err, "La transcription a échoué."));
        }
      };
      mr.start();
      mrRef.current = mr;
      setRecording(true);
      setStatus('listening');
    } catch (err) {
      toast.error("Impossible d'accéder au microphone. Vérifiez les autorisations.");
    }
  };

  const stopPushToTalk = () => {
    try { if (mrRef.current?.state === 'recording') mrRef.current.stop(); } catch (e) {}
    setRecording(false);
  };

  /* ---------------- lifecycle ---------------- */
  const begin = async () => {
    setChecking(true);
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setChecking(false);
      return toast.error("Impossible d'accéder au microphone. Vérifiez les autorisations.");
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
        toast.error('Limite gratuite atteinte.');
        onCancel();
        return;
      }
      toast.error(errMsg(err, "L'analyse a échoué."));
      doneRef.current = false;
      setPhase('live');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consigne, onGraded, onCancel, phase, teardown]);

  useEffect(() => {
    if (phase !== 'prep') return;
    if (prepLeft <= 0) { goLive(); return; }
    const id = setTimeout(() => setPrepLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, prepLeft, goLive]);

  useEffect(() => {
    if (phase !== 'live') return;
    if (left <= 0) { finish(); return; }
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, left, finish]);

  const spokenTurns = turns.filter((t) => t.role === 'candidate').length;
  const statusLabel = {
    listening: HAS_LIVE_STT ? 'À vous — parlez' : 'Enregistrement…',
    thinking: 'L\'agent réfléchit…',
    speaking: 'L\'agent parle…',
    idle: HAS_LIVE_STT ? 'En pause' : 'Appuyez sur Parler',
  }[status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Conversation">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* HEADER */}
        <div className="flex items-start gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-6 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Microphone size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-bold leading-snug">{tacheTitle}</p>
            <p className="text-[11px] text-white/80">
              {isFree
                ? `Conversation libre · ${fmt(SPEAK_SECONDS)}`
                : `Conversation en direct · Préparation : ${fmt(PREP_SECONDS)} · Échange : ${fmt(SPEAK_SECONDS)}`}
            </p>
          </div>
          {phase === 'live' && (
            <button onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Activer la voix' : 'Couper la voix'}
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white">
              {muted ? <SpeakerSlash size={18} weight="fill" /> : <SpeakerHigh size={18} weight="fill" />}
            </button>
          )}
          {phase !== 'grading' && (
            <button onClick={cancel} aria-label="Fermer"
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white">
              <X size={18} weight="bold" />
            </button>
          )}
        </div>

        {/* CONSIGNE */}
        {phase !== 'grading' && (
          <div className="border-b border-violet-100 bg-violet-50/40 px-6 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Consigne</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-800">{consigne}</p>
          </div>
        )}

        {/* BODY */}
        {phase === 'brief' && (
          <div className="px-6 py-6 text-center">
            <p className="text-sm leading-relaxed text-gray-600">
              {isFree ? (
                <>Parlez librement en français avec l'IA — elle vous répond et relance la
                  conversation. Vous avez {fmt(SPEAK_SECONDS)}, et vous pouvez arrêter quand vous voulez.</>
              ) : (
                <>C'est un échange à deux : <strong>vous posez les questions</strong>, l'agent vous répond.
                  Vous aurez {fmt(PREP_SECONDS)} de préparation, puis {fmt(SPEAK_SECONDS)} de conversation.</>
              )}
            </p>
            {!HAS_LIVE_STT && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Votre navigateur ne gère pas la transcription en direct : vous appuierez sur « Parler »
                avant chaque réplique. Pour la reconnaissance en direct, utilisez Chrome ou Edge.
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button onClick={begin} disabled={checking}
                className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60">
                {checking
                  ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Micro…</>
                  : <><Microphone size={16} weight="fill" />
                      {isFree ? 'Commencer à parler' : 'Commencer la préparation'}</>}
              </button>
              <button onClick={cancel} className="btn-outline flex-1 justify-center">Annuler</button>
            </div>
          </div>
        )}

        {phase === 'prep' && (
          <div className="px-6 py-6 text-center">
            <p className="font-heading text-5xl font-extrabold tabular-nums text-primary">{fmt(prepLeft)}</p>
            <p className="mt-2 font-heading text-sm font-bold text-gray-900">Préparation</p>
            <p className="mt-1 text-xs text-gray-500">
              Préparez vos questions — ne parlez pas encore.
            </p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-600 transition-all duration-1000"
                style={{ width: `${((PREP_SECONDS - prepLeft) / PREP_SECONDS) * 100}%` }} />
            </div>
            <button onClick={goLive} className="btn-outline mt-5 w-full justify-center">
              Commencer la conversation
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
                <p className="py-8 text-center text-xs text-gray-400">L'agent se prépare…</p>
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
                <button onClick={() => exchange(turnsRef.current)} className="font-bold underline">Réessayer</button>
              </div>
            )}

            {/* controls */}
            <div className="flex flex-col gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row">
              {recording ? (
                <button onClick={stopPushToTalk}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-red-500 !to-rose-600">
                  <Stop size={16} weight="fill" /> Envoyer ma réplique
                </button>
              ) : !HAS_LIVE_STT ? (
                <button onClick={startPushToTalk} disabled={status === 'thinking' || status === 'speaking'}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-50">
                  <PaperPlaneTilt size={16} weight="fill" /> Parler
                </button>
              ) : status === 'idle' ? (
                /* Live recognition exists but stalled (denied mic, no network,
                   a failed exchange) - never leave the learner with no way to talk. */
                <button onClick={() => listenRef.current?.()}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <Microphone size={16} weight="fill" /> Reprendre l'écoute
                </button>
              ) : null}
              <button onClick={finish}
                className={`btn-outline justify-center ${status !== 'idle' && HAS_LIVE_STT && !recording ? 'flex-1' : ''}`}>
                <Lightning size={16} weight="fill" /> Terminer et analyser
              </button>
            </div>
            <p className="px-6 pb-3 text-center text-[10px] text-gray-400">
              {spokenTurns} question{spokenTurns > 1 ? 's' : ''} posée{spokenTurns > 1 ? 's' : ''} · visez au moins 4 échanges
            </p>
          </>
        )}

        {phase === 'grading' && (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
            <p className="mt-4 font-heading text-sm font-bold text-gray-900">Analyse de votre conversation…</p>
            <p className="mt-1 text-xs text-gray-500">Questions posées, registre, informations obtenues.</p>
          </div>
        )}
      </div>
    </div>
  );
}
