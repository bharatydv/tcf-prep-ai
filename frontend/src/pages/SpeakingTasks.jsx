import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChatText, Handshake, Scales, ClockCountdown, ArrowLeft,
  Lock, CaretRight, BookOpen, Microphone, Star, Clock,
  Stop, ArrowClockwise, UploadSimple, Lightning, CheckCircle, XCircle, X, ChatsCircle,
  Question,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { startRecording as startCapture, appendAudio, isRecordingSupported } from '../lib/recorder';
import { useAuth } from '../context/AuthContext';
import { BackLink } from '../components/shared';
import ConversationModal from '../components/ConversationModal';
import { useT } from '../i18n';

/* Module-level, so the copy is held as translation keys and resolved with t()
   at render time rather than baked in at import time. */
const TACHES = [
  { n: 1, title: 'st.t1Title', meta: 'st.t1Meta', focus: 'st.t1Focus', icon: ChatText },
  { n: 2, title: 'st.t2Title', meta: 'st.t2Meta', focus: 'st.t2Focus', icon: Handshake },
  { n: 3, title: 'st.t3Title', meta: 'st.t3Meta', focus: 'st.t3Focus', icon: Scales },
];

const TACHE_DURATION = { 1: '2 min', 2: '5 min 30 s', 3: '4 min 30 s' };

// Open practice: free users get a small monthly allowance (enforced server-side).
const FREE_TALK_LIMIT = 2;
/* The panel offers a run through all three tâches in one sitting, so the brief
   walks the AI through them in order rather than leaving it on an open-ended
   chat — otherwise the session would not deliver what the panel promises. */
const FREE_TALK_CONSIGNE =
  "Séance d'entraînement à l'expression orale du TCF Canada, couvrant les trois tâches "
  + "dans l'ordre : entretien dirigé, exercice en interaction, puis expression d'un point "
  + "de vue.";

/* The combined session is the three tâches back to back, and each one holds
   its own clock. Run as a single ten-minute window with the three tâches named
   only inside one long brief, the agent decided for itself how long to spend on
   each: it filled the whole session with tâches 1 and 2, and the candidate
   never reached tâche 3 at all. A tâche now ends when its own timer does, and
   the agent is handed the next brief whether it was finished or not.

   The three add up to the same ten minutes the session always had. */
const FREE_TALK_SEGMENTS = [
  {
    taskType: 1,
    seconds: 150,
    consigne:
      "Séance d'entraînement à l'expression orale du TCF Canada — Tâche 1 : entretien "
      + "dirigé. Vous êtes l'examinateur et vous ne parlez qu'en français. Annoncez la "
      + "tâche 1, puis demandez au candidat de se présenter et posez-lui des questions "
      + "simples sur son parcours, sa vie quotidienne et ses centres d'intérêt. Une seule "
      + "question à la fois, et rebondissez sur ses réponses pour le faire parler le plus "
      + "possible.",
  },
  {
    taskType: 2,
    seconds: 240,
    consigne:
      "Séance d'entraînement à l'expression orale du TCF Canada — Tâche 2 : exercice en "
      + "interaction. Vous êtes l'examinateur et vous ne parlez qu'en français. Le temps "
      + "de la tâche 1 est écoulé : annoncez brièvement le passage à la tâche 2, proposez "
      + "une situation concrète de la vie courante (réserver, se renseigner, régler un "
      + "problème) et jouez le rôle de l'interlocuteur. C'est le candidat qui mène "
      + "l'échange et qui pose les questions : répondez-lui sans jamais lui souffler ce "
      + "qu'il pourrait demander ensuite.",
  },
  {
    taskType: 3,
    seconds: 210,
    consigne:
      "Séance d'entraînement à l'expression orale du TCF Canada — Tâche 3 : expression "
      + "d'un point de vue. Vous êtes l'examinateur et vous ne parlez qu'en français. Le "
      + "temps de la tâche 2 est écoulé : annoncez brièvement le passage à la tâche 3, "
      + "posez une question d'opinion sur un sujet de société et demandez au candidat de "
      + "justifier sa position. Relancez-le une question à la fois pour qu'il développe "
      + "ses arguments.",
  },
];

/* Tâche 1 is the entretien dirigé: there is no question bank to pick from, the
   examiner simply interviews the candidate about themselves. The AI plays that
   examiner, so the brief below is what drives it. */
const TACHE1_CONSIGNE =
  "Entretien dirigé (Tâche 1 du TCF) : vous êtes l'examinateur. Le candidat se présente "
  + "pendant deux minutes. Posez-lui des questions simples et ouvertes sur lui-même — son "
  + "parcours, sa famille, son travail ou ses études, sa vie quotidienne, ses loisirs et ses "
  + "projets. Rebondissez sur ses réponses avec des questions de relance, une à la fois, "
  + "comme un examinateur du TCF Canada.";

// Tâche 2's 5 min 30 s already includes 2 min of preparation, so speaking time is the remainder.
const TACHE_PREP_SECONDS = { 1: 0, 2: 120, 3: 0 };
const TACHE_SPEAK_SECONDS = { 1: 120, 2: 210, 3: 270 };

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const catKey = (category) => `cat.${category}`;

/* ---- Recording modal: brief → preparation → 3·2·1 → recording ---- */
function RecorderModal({ question, tacheNum, tacheTitle, onCancel, onComplete }) {
  const t = useT();
  const prepSeconds = TACHE_PREP_SECONDS[tacheNum] || 0;
  const speakSeconds = TACHE_SPEAK_SECONDS[tacheNum] || 120;

  const [phase, setPhase] = useState('brief');   // brief | prep | countdown | recording
  const [prepLeft, setPrepLeft] = useState(prepSeconds);
  const [tick, setTick] = useState(3);
  const [left, setLeft] = useState(speakSeconds);
  const [checking, setChecking] = useState(false);

  // The capture handle from lib/recorder.js, which owns the MediaRecorder and
  // the microphone track and reports the container it actually produced.
  const captureRef = useRef(null);
  const canceledRef = useRef(false);
  const leftRef = useRef(speakSeconds);

  useEffect(() => { leftRef.current = left; }, [left]);

  const releaseStream = () => {
    captureRef.current?.cancel();
    captureRef.current = null;
  };

  const cancel = () => {
    canceledRef.current = true;
    try { captureRef.current?.cancel(); } catch (e) {}
    releaseStream();
    onCancel();
  };

  // The countdown and the stop button both land here.
  const finish = () => { finishRecording(); };

  // Lock page scroll while open; Escape abandons the attempt.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      canceledRef.current = true;
      releaseStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask for the mic up front so a denied permission surfaces before the prep timer runs.
  const begin = async () => {
    setChecking(true);
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setChecking(false);
      return toast.error(t('st.micDenied'));
    }
    setChecking(false);
    setPhase(prepSeconds > 0 ? 'prep' : 'countdown');
  };

  const beginRecording = async () => {
    if (!isRecordingSupported()) { toast.error(t('st.micDenied')); return cancel(); }
    try {
      captureRef.current = await startCapture({ basename: 'answer' });
      setPhase('recording');
    } catch (err) {
      toast.error(t('st.micDenied'));
      cancel();
    }
  };

  // Called when the official limit is reached or the candidate stops early.
  const finishRecording = async () => {
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    let recorded;
    try {
      recorded = await capture.stop();
    } catch {
      return cancel();
    }
    if (canceledRef.current) return;
    onComplete(recorded, speakSeconds - leftRef.current);
  };

  // Anchored to a wall-clock deadline rather than a chain of one-second
  // timeouts, so a backgrounded tab cannot extend the official preparation.
  const prepEndsRef = useRef(null);
  const speakEndsRef = useRef(null);

  useEffect(() => {
    if (phase !== 'prep') { prepEndsRef.current = null; return undefined; }
    if (prepEndsRef.current == null) prepEndsRef.current = Date.now() + prepLeft * 1000;

    const read = () => {
      const left = Math.max(0, Math.ceil((prepEndsRef.current - Date.now()) / 1000));
      setPrepLeft(left);
      if (left <= 0) setPhase('countdown');
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
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (tick <= 0) { beginRecording(); return; }
    const id = setTimeout(() => setTick((t) => t - 1), 850);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tick]);

  useEffect(() => {
    if (phase !== 'recording') { speakEndsRef.current = null; return undefined; }
    if (speakEndsRef.current == null) speakEndsRef.current = Date.now() + left * 1000;

    const read = () => {
      const remaining = Math.max(0, Math.ceil((speakEndsRef.current - Date.now()) / 1000));
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
  }, [phase]);

  const spoken = speakSeconds - left;
  const progress = Math.min(100, (spoken / speakSeconds) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={t('st.recordingAria')}>
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* HEADER */}
        <div className="flex items-start gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-6 py-4 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Microphone size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-bold leading-snug">{tacheTitle}</p>
            <p className="text-[11px] text-white/80">
              Préparation : {prepSeconds ? fmt(prepSeconds) : 'aucune'} · Parole : {fmt(speakSeconds)}
            </p>
          </div>
          {phase !== 'recording' && (
            <button onClick={cancel} aria-label={t('st.closeAria')}
              className="rounded-lg p-1 text-white/80 transition hover:bg-white/20 hover:text-white">
              <X size={18} weight="bold" />
            </button>
          )}
        </div>

        {/* QUESTION — always visible except during the 3·2·1 */}
        {phase !== 'countdown' && (
          <div className="border-b border-violet-100 bg-violet-50/40 px-6 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">{t('st.consigne')}</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-800">{question}</p>
          </div>
        )}

        {/* BODY */}
        <div className="px-6 py-6 text-center">
          {phase === 'brief' && (
            <>
              <p className="text-sm leading-relaxed text-gray-600">
                {prepSeconds
                  ? `Vous aurez ${fmt(prepSeconds)} de préparation, puis ${fmt(speakSeconds)} pour répondre.`
                  : `Vous aurez ${fmt(speakSeconds)} pour répondre. L'enregistrement démarre après un décompte de 3 secondes.`}
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
                <button onClick={begin} disabled={checking}
                  className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-60">
                  {checking
                    ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {t('st.mic')}</>
                    : <><Microphone size={16} weight="fill" /> {prepSeconds ? t('st.startPreparation') : t('st.startRecording')}</>}
                </button>
                <button onClick={cancel} className="btn-outline flex-1 justify-center">{t('st.cancel')}</button>
              </div>
            </>
          )}

          {phase === 'prep' && (
            <>
              <p className="font-heading text-5xl font-extrabold tabular-nums text-primary">{fmt(prepLeft)}</p>
              <p className="mt-2 font-heading text-sm font-bold text-gray-900">{t('st.preparation')}</p>
              <p className="mt-1 text-xs text-gray-500">{t('st.prepNotes')}</p>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-600 transition-all duration-1000"
                  style={{ width: `${((prepSeconds - prepLeft) / prepSeconds) * 100}%` }} />
              </div>
              <button onClick={() => setPhase('countdown')} className="btn-outline mt-5 w-full justify-center">
                {t('st.skipPrep')}
              </button>
            </>
          )}

          {phase === 'countdown' && (
            <div className="py-8">
              <p key={tick} className="font-heading text-7xl font-extrabold text-primary animate-pulse">
                {tick > 0 ? tick : 'GO !'}
              </p>
              <p className="mt-4 text-sm font-semibold text-gray-600">{t('st.getReady')}</p>
            </div>
          )}

          {phase === 'recording' && (
            <>
              <button onClick={finish}
                className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg">
                <Stop size={30} weight="fill" />
              </button>
              <p className="mt-4 font-heading text-3xl font-extrabold tabular-nums text-gray-900">{fmt(left)}</p>
              <p className="mt-1 text-xs text-gray-500">{t('st.timeLeft')}</p>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-red-100">
                <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-600 transition-all duration-1000"
                  style={{ width: `${progress}%` }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Inline recorder/uploader + analysis for a single question ---- */
function QuestionCard({ q, duration, tacheNum, tacheTitle, isActive, onActivate, refreshUser, navigate }) {
  const t = useT();
  // Tache 2 is an interaction: it opens a live conversation instead of a monologue.
  const isInteraction = tacheNum === 2;
  const [modalOpen, setModalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioMeta, setAudioMeta] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);

  // Only one question may be open at a time.
  useEffect(() => {
    if (!isActive) { setModalOpen(false); setChatOpen(false); }
  }, [isActive]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const reset = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    setAudioMeta(null);
    setElapsed(0);
    setResult(null);
  };

  const openRecorder = () => {
    onActivate();
    reset();
    if (isInteraction) setChatOpen(true);
    else setModalOpen(true);
  };

  // The conversation grades itself, so it hands back a finished analysis.
  const handleGraded = async (analysis) => {
    setChatOpen(false);
    setResult(analysis);
    await refreshUser();
    if (!analysis?.transcript) toast.error(t('st.noSpeechConv'));
    else toast.success(t('speak.doneToast', { level: analysis.tcf_level }));
  };

  // Handed the finished take by the modal; the analysis path below is unchanged.
  const handleRecorded = (recorded, seconds) => {
    setModalOpen(false);
    setAudioBlob(recorded.blob);
    setAudioMeta({ filename: recorded.filename, mimeType: recorded.mimeType, recorded: true });
    setAudioUrl(URL.createObjectURL(recorded.blob));
    setElapsed(seconds);
  };

  const openFilePicker = () => {
    onActivate();
    reset();
    fileInputRef.current?.click();
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      return toast.error(t('st.notAudio'));
    }
    if (file.size > 25 * 1024 * 1024) {
      return toast.error(t('st.tooBig'));
    }
    reset();
    setAudioBlob(file);
    setAudioMeta({ filename: file.name || 'upload.mp3', mimeType: file.type || '', recorded: false });
    setAudioUrl(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!audioBlob) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('question', q.prompt_text);
      appendAudio(form, {
        blob: audioBlob,
        filename: audioMeta?.filename || 'answer.webm',
        mimeType: audioMeta?.mimeType || audioBlob.type,
      });
      // Which tâche this is decides how the server grades it, and this page
      // was the only recording surface that did not say. Without it the
      // official word floors are skipped entirely, the grader is not told
      // which tâche it is looking at, and a tâche 2 recording does not claim
      // the single free roleplay — so the trial's one-per-account ceiling
      // simply did not apply to answers started from here.
      if (tacheNum) form.append('task_type', String(tacheNum));
      const { data } = await api.post('/api/speaking/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      await refreshUser();
      if (!data.transcript) toast.error(t('st.noSpeech'));
      else toast.success(t('speak.doneToast', { level: data.tcf_level }));
    } catch (err) {
      const status = err?.response?.status;
      if (status === 402) { /* the paywall took it */ }
      // 422 is the server saying it heard nothing AND gave the credit back.
      // Reporting it as a failure made a refunded credit look like a lost one.
      else if (status === 422) toast.error(t('speak.noSpeechRefunded'));
      else toast.error(t('speak.analyseFailed'));
      await refreshUser();
    } finally {
      setAnalyzing(false);
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const showActions = isActive && (audioBlob || analyzing || result);

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-soft transition ${
      isActive ? 'border-violet-300 shadow-lg shadow-violet-100' : 'border-gray-200 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-100'
    }`}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500">
          <Clock size={14} weight="bold" className="text-gray-400" /> {duration}
        </span>
        <Star size={18} className="text-gray-300" />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-gray-800">{q.prompt_text}</p>

      <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFile} className="hidden" />

      {modalOpen && (
        <RecorderModal
          question={q.prompt_text}
          tacheNum={tacheNum}
          tacheTitle={tacheTitle}
          onCancel={() => setModalOpen(false)}
          onComplete={handleRecorded}
        />
      )}

      {chatOpen && (
        <ConversationModal
          consigne={q.prompt_text}
          tacheTitle={tacheTitle}
          onCancel={() => setChatOpen(false)}
          onGraded={handleGraded}
        />
      )}

      {!showActions && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button onClick={openRecorder}
            className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
            {isInteraction
              ? <><ChatsCircle size={16} weight="fill" /> {t('st.startConversation')}</>
              : <><Microphone size={16} weight="fill" /> {t('st.recordAnswer')}</>}
          </button>
          <button onClick={openFilePicker} className="btn-outline flex-1 justify-center">
            <UploadSimple size={16} weight="bold" /> {t('st.uploadRecording')}
          </button>
        </div>
      )}

      {showActions && (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/30 p-5 text-center">
          {audioBlob ? (
            <>
              <p className="font-heading text-sm font-bold text-gray-900">
                {audioMeta?.recorded ? `Votre enregistrement (${mm}:${ss})` : `Fichier : ${audioMeta?.filename || ''}`}
              </p>
              <audio src={audioUrl} controls className="mx-auto mt-3 w-full max-w-sm" />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button onClick={reset} className="btn-outline !py-1.5 text-sm">
                  <ArrowClockwise size={16} /> {t('st.restart')}
                </button>
                <button onClick={submit} disabled={analyzing}
                  className="btn-primary !py-1.5 text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  {analyzing ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {t('st.analysing')}</> : <><Lightning size={16} weight="fill" /> {t('st.analyse')}</>}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-violet-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {result.answers_question
                  ? <CheckCircle size={22} weight="fill" className="text-green-500" />
                  : <XCircle size={22} weight="fill" className="text-amber-500" />}
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {result.answers_question ? t('st.answerRelevant') : t('st.answerOffTopic')}
                  </p>
                  <p className="text-xs text-gray-600">{result.relevance_comment}</p>
                </div>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('st.level')}</p>
                <p className="font-heading text-2xl font-extrabold text-primary">{result.tcf_level}</p>
                <p className="text-[10px] text-gray-400">{result.overall_score}/100</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-white p-4">
            <p className="text-xs font-bold text-gray-900">{t('st.transcript')}</p>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
              {result.transcript || t('st.noSpeechDetected')}
            </p>
          </div>

          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <div className="rounded-2xl border border-violet-100 bg-white p-4">
              <p className="text-xs font-bold text-gray-900">{t('st.corrections')}</p>
              <div className="mt-2 space-y-2">
                {result.errors.map((e, i) => (
                  <div key={i} className="rounded-xl border border-violet-50 bg-violet-50/40 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-red-500 line-through">{e.error}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-semibold text-green-600">{e.correction}</span>
                      <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">{t(catKey(e.category))}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">{e.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* "What more could you have asked?" — tâche 2 only. The questions
              are in French and ready to speak, so they are shown verbatim with
              the English note explaining what each would have obtained. */}
          {Array.isArray(result.missed_questions) && result.missed_questions.length > 0 && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4" data-testid="missed-questions">
              <p className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                <Question size={14} weight="fill" className="text-amber-600" />
                {t('st.missedQuestions')}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500">{t('st.missedQuestionsHint')}</p>
              <ul className="mt-2 space-y-2">
                {result.missed_questions.map((m, i) => (
                  <li key={i} className="rounded-xl border border-amber-100 bg-white p-2.5">
                    <p className="text-xs font-semibold text-gray-900">« {m.question} »</p>
                    {m.why && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{m.why}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
            <div className="rounded-2xl border border-violet-100 bg-white p-4">
              <p className="text-xs font-bold text-gray-900">{t('st.suggestions')}</p>
              <ul className="mt-2 space-y-1.5">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(result.vocabulary_suggestions) && result.vocabulary_suggestions.length > 0 && (
            <div className="rounded-2xl border border-violet-100 bg-white p-4">
              <p className="text-xs font-bold text-gray-900">{t('st.vocabulary')}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.vocabulary_suggestions.map((v, i) => (
                  <span key={i} className="rounded-full bg-fuchsia-50 px-2.5 py-1 text-[11px] font-medium text-fuchsia-700">{v}</span>
                ))}
              </div>
            </div>
          )}

          <button onClick={reset} className="btn-outline w-full justify-center !py-2 text-sm">
            <Microphone size={16} weight="fill" /> {t('st.newAnswer')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SpeakingTasks() {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [activeTache, setActiveTache] = useState(null);
  const [themes, setThemes] = useState([]);
  const [loadingThemes, setLoadingThemes] = useState(false);

  const [activeTheme, setActiveTheme] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [activeQid, setActiveQid] = useState(null);
  const [freeTalkOpen, setFreeTalkOpen] = useState(false);
  const [freeTalkResult, setFreeTalkResult] = useState(null);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewResult, setInterviewResult] = useState(null);

  const isPremiumUser = user?.subscription_status === 'premium';

  const selectTache = (t) => {
    if (!user) return navigate('/login');
    setActiveTache(t.n);
    setActiveTheme(null);
    setQuestions([]);
    setActiveQid(null);
    setThemes([]);
    // Tâche 1 has no theme bank — it is a live interview about the candidate,
    // so there is nothing to fetch and nothing to choose from.
    if (t.n === 1) return;
    setLoadingThemes(true);
    api.get(`/api/themes?task_type=${t.n}&skill=speaking`)
      .then(({ data }) => setThemes(data.themes || []))
      .catch(() => setThemes([]))
      .finally(() => setLoadingThemes(false));
  };

  const startInterview = () => {
    if (!user) return navigate('/login');
    setInterviewOpen(true);
  };

  const onInterviewGraded = async (analysis) => {
    setInterviewOpen(false);
    setInterviewResult(analysis);
    await refreshUser();
    toast.success(t('st.conversationGraded', { level: analysis.tcf_level }));
  };

  const openTheme = (t) => {
    if (!user) return navigate('/login');
    if (t.is_premium && !isPremiumUser) {
      toast.error(t('st.proOnly'));
      return navigate('/pricing');
    }
    setActiveTheme(t);
    setQuestions([]);
    setActiveQid(null);
    setLoadingQuestions(true);
    api.get(`/api/themes/${t.theme_id}/questions?task_type=${activeTache}`)
      .then(({ data }) => setQuestions(data.questions || []))
      .catch(() => setQuestions([]))
      .finally(() => setLoadingQuestions(false));
  };

  const startFreeTalk = () => {
    if (!user) return navigate('/login');
    setFreeTalkOpen(true);
  };

  const onFreeTalkGraded = async (analysis) => {
    setFreeTalkOpen(false);
    setFreeTalkResult(analysis);
    await refreshUser();
    toast.success(t('st.conversationGraded', { level: analysis.tcf_level }));
  };

  const activeTacheObj = TACHES.find((t) => t.n === activeTache);

  return (
    <main className="overflow-x-clip bg-white">
      {freeTalkOpen && (
        <ConversationModal
          mode="free"
          consigne={FREE_TALK_CONSIGNE}
          segments={FREE_TALK_SEGMENTS}
          tacheTitle={t('st.freeTalkTitle')}
          onCancel={() => setFreeTalkOpen(false)}
          onGraded={onFreeTalkGraded}
        />
      )}
      {interviewOpen && (
        <ConversationModal
          mode="tache1"
          consigne={TACHE1_CONSIGNE}
          tacheTitle={t('st.t1Title')}
          onCancel={() => setInterviewOpen(false)}
          onGraded={onInterviewGraded}
        />
      )}
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <BackLink fallback="/speaking" />

        <div className="mb-7">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('st.overview')}</h1>
          <p className="mt-2 max-w-lg text-sm text-gray-600">
            {t('st.overviewSub')}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          {/* LEFT — task list (fixed) */}
          <div className="flex flex-col gap-3">
            {TACHES.map((tache) => {
              const Icon = tache.icon;
              const active = activeTache === tache.n;
              return (
                <button key={tache.n} onClick={() => selectTache(tache)}
                  className={`flex w-full flex-col rounded-2xl border p-5 text-left shadow-soft transition hover:shadow-lg hover:shadow-violet-200/50 ${
                    active ? 'border-primary bg-violet-50/60 ring-2 ring-primary/30' : 'border-violet-100 bg-white'
                  }`}>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      active ? 'bg-primary text-white' : 'bg-violet-100 text-primary'
                    }`}>
                      <Icon size={20} weight="fill" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-sm font-bold leading-snug text-gray-900">{t(tache.title)}</h3>
                      <p className="mt-0.5 text-xs font-semibold text-primary">{t(tache.meta)}</p>
                    </div>
                    <CaretRight size={18} className={`ml-auto shrink-0 ${active ? 'text-primary' : 'text-gray-300'}`} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{t(tache.focus)}</p>
                </button>
              );
            })}
          </div>

          {/* RIGHT — simulator / themes / questions */}
          <div className="min-h-[360px]">
            {activeTache === null ? (
              <div className="flex h-full flex-col justify-center rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-8 shadow-soft">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                  <ChatsCircle size={28} weight="fill" />
                </span>
                <h2 className="mt-4 font-heading text-xl font-extrabold text-gray-900">{t('st.talkToAi')}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600">{t('st.talkToAiBody')}</p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> {t('st.twoWay')}</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> {t('st.aiSpeaks')}</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> {t('st.correctionAtEnd')}</li>
                </ul>
                <button onClick={startFreeTalk}
                  className="btn-primary mt-6 w-fit !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <ChatsCircle size={18} weight="fill" /> {t('st.startSpeaking')}
                </button>
                <p className="mt-3 text-xs text-gray-400">{t('st.freeTalkLimit', { n: FREE_TALK_LIMIT })}</p>

                {freeTalkResult && (
                  <div className="mt-5 rounded-2xl border border-violet-100 bg-white/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-gray-900">{t('st.lastConversation')}</p>
                      <p className="font-heading text-lg font-extrabold text-primary">
                        {freeTalkResult.tcf_level}
                        <span className="ml-1 text-[10px] font-semibold text-gray-400">
                          {freeTalkResult.overall_score}/100
                        </span>
                      </p>
                    </div>
                    {freeTalkResult.relevance_comment && (
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                        {freeTalkResult.relevance_comment}
                      </p>
                    )}
                    {freeTalkResult.submission_id && (
                      <button onClick={() => navigate(`/feedback/${freeTalkResult.submission_id}`)}
                        className="mt-2 text-[11px] font-bold text-primary hover:underline">
                        {t('st.seeDetail')}
                      </button>
                    )}
                  </div>
                )}

                <p className="mt-5 text-xs text-gray-400">{t('st.orPickTask')}</p>
              </div>
            ) : activeTache === 1 ? (
              /* Tâche 1: no theme list, straight into the guided interview. */
              <div className="flex h-full flex-col justify-center rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-8 shadow-soft">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                  <ChatText size={28} weight="fill" />
                </span>
                <h2 className="mt-4 font-heading text-xl font-extrabold text-gray-900">{t('st.t1PanelTitle')}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600">{t('st.t1PanelBody')}</p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> {t('st.t1Step1')}</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> {t('st.t1Step2')}</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> {t('st.t1Step3')}</li>
                </ul>
                <button onClick={startInterview}
                  className="btn-primary mt-6 w-fit !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <Microphone size={18} weight="fill" /> {t('st.t1Start')}
                </button>

                {interviewResult && (
                  <div className="mt-5 rounded-2xl border border-violet-100 bg-white/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-gray-900">{t('st.lastConversation')}</p>
                      <p className="font-heading text-lg font-extrabold text-primary">
                        {interviewResult.tcf_level}
                        <span className="ml-1 text-[10px] font-semibold text-gray-400">
                          {interviewResult.overall_score}/100
                        </span>
                      </p>
                    </div>
                    {interviewResult.relevance_comment && (
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                        {interviewResult.relevance_comment}
                      </p>
                    )}
                    {interviewResult.submission_id && (
                      <button onClick={() => navigate(`/feedback/${interviewResult.submission_id}`)}
                        className="mt-2 text-[11px] font-bold text-primary hover:underline">
                        {t('st.seeDetail')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : activeTheme ? (
              <div>
                <button onClick={() => { setActiveTheme(null); setQuestions([]); setActiveQid(null); }}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  <ArrowLeft size={16} /> {t('st.backToThemes')}
                </button>

                <div className="mb-4 flex items-center gap-3 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
                    <ClockCountdown size={22} weight="fill" />
                  </span>
                  <div>
                    <h2 className="font-heading text-base font-bold text-gray-900">
                      {activeTheme.emoji ? `${activeTheme.emoji} ` : ''}{activeTheme.name}
                    </h2>
                    <p className="text-xs font-semibold text-primary">
                      {t('st.themeMeta', {
                        tache: t(activeTacheObj?.title || ''),
                        prep: TACHE_PREP_SECONDS[activeTache] ? fmt(TACHE_PREP_SECONDS[activeTache]) : t('st.prepNone'),
                        duration: TACHE_DURATION[activeTache],
                      })}
                    </p>
                  </div>
                </div>

                {loadingQuestions ? (
                  <div className="flex items-center justify-center rounded-2xl border border-violet-100 bg-white p-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
                  </div>
                ) : questions.length === 0 ? (
                  <div className="rounded-2xl border border-violet-100 bg-white p-8 text-center text-sm text-gray-500">
                    {t('st.noQuestions')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {questions.map((q) => (
                      <QuestionCard
                        key={q.question_id}
                        q={q}
                        duration={TACHE_DURATION[activeTache]}
                        tacheNum={activeTache}
                        tacheTitle={activeTacheObj ? t(activeTacheObj.title) : `Tâche ${activeTache}`}
                        isActive={activeQid === q.question_id}
                        onActivate={() => setActiveQid(q.question_id)}
                        refreshUser={refreshUser}
                        navigate={navigate}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : loadingThemes ? (
              <div className="flex h-full items-center justify-center rounded-3xl border border-violet-100 bg-white p-8">
                <div className="h-9 w-9 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
              </div>
            ) : themes.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-3xl border border-violet-100 bg-white p-8 text-center text-sm text-gray-500">
                {t('st.noThemes')}
              </div>
            ) : (
              <div>
                <h2 className="mb-4 font-heading text-lg font-extrabold text-gray-900">
                  {t('st.chooseTheme', { n: activeTache })}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* the map variable used to be named `t`, so the t('st.questions')
                      call below invoked the theme object and threw */}
                  {themes.map((theme) => {
                    const locked = theme.is_premium && !isPremiumUser;
                    const count = theme.question_count ?? 0;
                    return (
                      <button key={theme.theme_id} onClick={() => openTheme(theme)}
                        className={`flex flex-col rounded-2xl border bg-white p-5 text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50 ${
                          locked ? 'border-amber-100' : 'border-violet-100'
                        }`}>
                        <div className="flex items-start justify-between">
                          <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${
                            locked ? 'bg-amber-50' : 'bg-violet-100'
                          }`}>
                            {locked ? <Lock size={20} weight="fill" className="text-amber-500" /> : (theme.emoji || <BookOpen size={20} weight="duotone" className="text-primary" />)}
                          </span>
                          {theme.is_premium ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">{t('common.pro')}</span>
                          ) : (
                            <CaretRight size={18} className="text-gray-300" />
                          )}
                        </div>
                        <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{theme.name}</h3>
                        {theme.description && (
                          <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{theme.description}</p>
                        )}
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{t('st.questions')}</span>
                            <span className="font-semibold text-gray-700">{locked ? '—' : count}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}