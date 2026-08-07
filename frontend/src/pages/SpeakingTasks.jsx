import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChatText, Handshake, Scales, ClockCountdown, ArrowLeft,
  Lock, CaretRight, BookOpen, Microphone, Star, Clock,
  Stop, ArrowClockwise, UploadSimple, Lightning, CheckCircle, XCircle, X, ChatsCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import ConversationModal from '../components/ConversationModal';

const TACHES = [
  { n: 1, title: 'Tâche 1 : Entretien Dirigé (Guided Interview)', meta: '2 minutes',
    focus: 'Present yourself and talk about your background, habits, or interests.', icon: ChatText },
  { n: 2, title: 'Tâche 2 : Exercice en Interaction (Interactive Roleplay)', meta: '5.5 minutes (includes 2 minutes of preparation time)',
    focus: 'Ask formal and informal questions to obtain specific information in a real-world scenario.', icon: Handshake },
  { n: 3, title: "Tâche 3 : Expression d'un Point de Vue (Opinion Monologue)", meta: '4.5 minutes',
    focus: 'Deliver a structured argument to state and defend your opinion on an abstract societal issue.', icon: Scales },
];

const TACHE_DURATION = { 1: '2 min', 2: '5 min 30 s', 3: '4 min 30 s' };

// Open practice: free users get a small monthly allowance (enforced server-side).
const FREE_TALK_LIMIT = 2;
const FREE_TALK_CONSIGNE =
  "Conversation libre : l'apprenant veut simplement discuter en français pour pratiquer. "
  + "Choisissez un sujet du quotidien (travail, voyages, cuisine, actualité, vie au Canada), "
  + "posez-lui des questions ouvertes et rebondissez sur ses réponses pour le faire parler.";

// Tâche 2's 5 min 30 s already includes 2 min of preparation, so speaking time is the remainder.
const TACHE_PREP_SECONDS = { 1: 0, 2: 120, 3: 0 };
const TACHE_SPEAK_SECONDS = { 1: 120, 2: 210, 3: 270 };

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

/* ---- Recording modal: brief → preparation → 3·2·1 → recording ---- */
function RecorderModal({ question, tacheNum, tacheTitle, onCancel, onComplete }) {
  const prepSeconds = TACHE_PREP_SECONDS[tacheNum] || 0;
  const speakSeconds = TACHE_SPEAK_SECONDS[tacheNum] || 120;

  const [phase, setPhase] = useState('brief');   // brief | prep | countdown | recording
  const [prepLeft, setPrepLeft] = useState(prepSeconds);
  const [tick, setTick] = useState(3);
  const [left, setLeft] = useState(speakSeconds);
  const [checking, setChecking] = useState(false);

  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const canceledRef = useRef(false);
  const leftRef = useRef(speakSeconds);

  useEffect(() => { leftRef.current = left; }, [left]);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const cancel = () => {
    canceledRef.current = true;
    try { if (mrRef.current?.state === 'recording') mrRef.current.stop(); } catch (e) {}
    releaseStream();
    onCancel();
  };

  const finish = () => {
    try { if (mrRef.current?.state === 'recording') mrRef.current.stop(); } catch (e) {}
  };

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
      return toast.error("Impossible d'accéder au microphone. Vérifiez les autorisations.");
    }
    setChecking(false);
    setPhase(prepSeconds > 0 ? 'prep' : 'countdown');
  };

  const beginRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        releaseStream();
        if (canceledRef.current) return;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onComplete(blob, speakSeconds - leftRef.current);
      };
      mr.start();
      mrRef.current = mr;
      setPhase('recording');
    } catch (err) {
      toast.error("Impossible d'accéder au microphone. Vérifiez les autorisations.");
      cancel();
    }
  };

  useEffect(() => {
    if (phase !== 'prep') return;
    if (prepLeft <= 0) { setPhase('countdown'); return; }
    const id = setTimeout(() => setPrepLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, prepLeft]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (tick <= 0) { beginRecording(); return; }
    const id = setTimeout(() => setTick((t) => t - 1), 850);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tick]);

  useEffect(() => {
    if (phase !== 'recording') return;
    if (left <= 0) { finish(); return; }
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, left]);

  const spoken = speakSeconds - left;
  const progress = Math.min(100, (spoken / speakSeconds) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Enregistrement">
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
            <button onClick={cancel} aria-label="Fermer"
              className="rounded-lg p-1 text-white/80 transition hover:bg-white/20 hover:text-white">
              <X size={18} weight="bold" />
            </button>
          )}
        </div>

        {/* QUESTION — always visible except during the 3·2·1 */}
        {phase !== 'countdown' && (
          <div className="border-b border-violet-100 bg-violet-50/40 px-6 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Consigne</p>
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
                    ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Micro…</>
                    : <><Microphone size={16} weight="fill" /> {prepSeconds ? 'Commencer la préparation' : "Commencer l'enregistrement"}</>}
                </button>
                <button onClick={cancel} className="btn-outline flex-1 justify-center">Annuler</button>
              </div>
            </>
          )}

          {phase === 'prep' && (
            <>
              <p className="font-heading text-5xl font-extrabold tabular-nums text-primary">{fmt(prepLeft)}</p>
              <p className="mt-2 font-heading text-sm font-bold text-gray-900">Préparation</p>
              <p className="mt-1 text-xs text-gray-500">Prenez des notes — ne parlez pas encore.</p>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-600 transition-all duration-1000"
                  style={{ width: `${((prepSeconds - prepLeft) / prepSeconds) * 100}%` }} />
              </div>
              <button onClick={() => setPhase('countdown')} className="btn-outline mt-5 w-full justify-center">
                Passer la préparation
              </button>
            </>
          )}

          {phase === 'countdown' && (
            <div className="py-8">
              <p key={tick} className="font-heading text-7xl font-extrabold text-primary animate-pulse">
                {tick > 0 ? tick : 'GO !'}
              </p>
              <p className="mt-4 text-sm font-semibold text-gray-600">Préparez-vous à parler…</p>
            </div>
          )}

          {phase === 'recording' && (
            <>
              <button onClick={finish}
                className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg">
                <Stop size={30} weight="fill" />
              </button>
              <p className="mt-4 font-heading text-3xl font-extrabold tabular-nums text-gray-900">{fmt(left)}</p>
              <p className="mt-1 text-xs text-gray-500">Temps restant · appuyez pour terminer</p>
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
  // Tache 2 is an interaction: it opens a live conversation instead of a monologue.
  const isInteraction = tacheNum === 2;
  const [modalOpen, setModalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioName, setAudioName] = useState('answer.webm');
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
    setAudioName('answer.webm');
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
    if (!analysis?.transcript) toast.error('Aucune parole détectée pendant la conversation.');
    else toast.success(`Analyse terminée — niveau ${analysis.tcf_level}`);
  };

  // Handed the finished take by the modal; the analysis path below is unchanged.
  const handleRecorded = (blob, seconds) => {
    setModalOpen(false);
    setAudioBlob(blob);
    setAudioName('answer.webm');
    setAudioUrl(URL.createObjectURL(blob));
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
      return toast.error('Veuillez sélectionner un fichier audio (mp3, m4a, wav, webm).');
    }
    if (file.size > 25 * 1024 * 1024) {
      return toast.error('Fichier trop volumineux (max 25 Mo).');
    }
    reset();
    setAudioBlob(file);
    setAudioName(file.name || 'upload.mp3');
    setAudioUrl(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!audioBlob) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('question', q.prompt_text);
      form.append('audio', audioBlob, audioName);
      const { data } = await api.post('/api/speaking/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      await refreshUser();
      if (!data.transcript) toast.error('Aucune parole détectée. Réessayez.');
      else toast.success(`Analyse terminée — niveau ${data.tcf_level}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 402) { toast.error('Limite gratuite atteinte.'); navigate('/pricing'); }
      else toast.error("L'analyse a échoué. Réessayez.");
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
              ? <><ChatsCircle size={16} weight="fill" /> Start conversation</>
              : <><Microphone size={16} weight="fill" /> Record answer</>}
          </button>
          <button onClick={openFilePicker} className="btn-outline flex-1 justify-center">
            <UploadSimple size={16} weight="bold" /> Upload recording
          </button>
        </div>
      )}

      {showActions && (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/30 p-5 text-center">
          {audioBlob ? (
            <>
              <p className="font-heading text-sm font-bold text-gray-900">
                {audioName === 'answer.webm' ? `Votre enregistrement (${mm}:${ss})` : `Fichier : ${audioName}`}
              </p>
              <audio src={audioUrl} controls className="mx-auto mt-3 w-full max-w-sm" />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button onClick={reset} className="btn-outline !py-1.5 text-sm">
                  <ArrowClockwise size={16} /> Recommencer
                </button>
                <button onClick={submit} disabled={analyzing}
                  className="btn-primary !py-1.5 text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  {analyzing ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Analyse…</> : <><Lightning size={16} weight="fill" /> Analyser</>}
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
                    {result.answers_question ? 'Réponse pertinente' : 'Réponse à améliorer'}
                  </p>
                  <p className="text-xs text-gray-600">{result.relevance_comment}</p>
                </div>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Niveau</p>
                <p className="font-heading text-2xl font-extrabold text-primary">{result.tcf_level}</p>
                <p className="text-[10px] text-gray-400">{result.overall_score}/100</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-white p-4">
            <p className="text-xs font-bold text-gray-900">Transcription</p>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
              {result.transcript || 'Aucune parole détectée.'}
            </p>
          </div>

          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <div className="rounded-2xl border border-violet-100 bg-white p-4">
              <p className="text-xs font-bold text-gray-900">Corrections</p>
              <div className="mt-2 space-y-2">
                {result.errors.map((e, i) => (
                  <div key={i} className="rounded-xl border border-violet-50 bg-violet-50/40 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-red-500 line-through">{e.error}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-semibold text-green-600">{e.correction}</span>
                      <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">{CAT_LABELS[e.category] || e.category}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">{e.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
            <div className="rounded-2xl border border-violet-100 bg-white p-4">
              <p className="text-xs font-bold text-gray-900">Suggestions</p>
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
              <p className="text-xs font-bold text-gray-900">Vocabulaire à enrichir</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.vocabulary_suggestions.map((v, i) => (
                  <span key={i} className="rounded-full bg-fuchsia-50 px-2.5 py-1 text-[11px] font-medium text-fuchsia-700">{v}</span>
                ))}
              </div>
            </div>
          )}

          <button onClick={reset} className="btn-outline w-full justify-center !py-2 text-sm">
            <Microphone size={16} weight="fill" /> Nouvelle réponse
          </button>
        </div>
      )}
    </div>
  );
}

export default function SpeakingTasks() {
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

  const isPremiumUser = user?.subscription_status === 'premium';

  const selectTache = (t) => {
    if (!user) return navigate('/login');
    setActiveTache(t.n);
    setActiveTheme(null);
    setQuestions([]);
    setActiveQid(null);
    setThemes([]);
    setLoadingThemes(true);
    api.get(`/api/themes?task_type=${t.n}&skill=speaking`)
      .then(({ data }) => setThemes(data.themes || []))
      .catch(() => setThemes([]))
      .finally(() => setLoadingThemes(false));
  };

  const openTheme = (t) => {
    if (!user) return navigate('/login');
    if (t.is_premium && !isPremiumUser) {
      toast.error('Ce thème est réservé aux membres Pro.');
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
    toast.success(`Conversation analysée — niveau ${analysis.tcf_level}`);
  };

  const activeTacheObj = TACHES.find((t) => t.n === activeTache);

  return (
    <main className="overflow-x-clip bg-white">
      {freeTalkOpen && (
        <ConversationModal
          mode="free"
          consigne={FREE_TALK_CONSIGNE}
          tacheTitle="Parler avec l'IA — conversation libre"
          onCancel={() => setFreeTalkOpen(false)}
          onGraded={onFreeTalkGraded}
        />
      )}
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <button onClick={() => navigate('/speaking')}
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="mb-7">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">Practice Task Overview</h1>
          <p className="mt-2 max-w-lg text-sm text-gray-600">
            Choose a speaking task on the left to see its themes, or run the full exam simulator.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          {/* LEFT — task list (fixed) */}
          <div className="flex flex-col gap-3">
            {TACHES.map((t) => {
              const Icon = t.icon;
              const active = activeTache === t.n;
              return (
                <button key={t.n} onClick={() => selectTache(t)}
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
                      <h3 className="font-heading text-sm font-bold leading-snug text-gray-900">{t.title}</h3>
                      <p className="mt-0.5 text-xs font-semibold text-primary">{t.meta}</p>
                    </div>
                    <CaretRight size={18} className={`ml-auto shrink-0 ${active ? 'text-primary' : 'text-gray-300'}`} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{t.focus}</p>
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
                <h2 className="mt-4 font-heading text-xl font-extrabold text-gray-900">Parler avec l'IA</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600">
                  Une vraie conversation en français : vous parlez, l'IA vous répond à voix haute et
                  relance l'échange, exactement comme la Tâche 2 — mais sans consigne imposée.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> Échange à deux, en direct</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> L'IA répond à voix haute</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-primary" /> Correction et niveau à la fin</li>
                </ul>
                <button onClick={startFreeTalk}
                  className="btn-primary mt-6 w-fit !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <ChatsCircle size={18} weight="fill" /> Commencer à parler
                </button>
                <p className="mt-3 text-xs text-gray-400">
                  {FREE_TALK_LIMIT} conversations gratuites par mois.
                </p>

                {freeTalkResult && (
                  <div className="mt-5 rounded-2xl border border-violet-100 bg-white/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-gray-900">Dernière conversation</p>
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
                        Voir le détail →
                      </button>
                    )}
                  </div>
                )}

                <p className="mt-5 text-xs text-gray-400">Or pick a task on the left to practice one at a time.</p>
              </div>
            ) : activeTheme ? (
              <div>
                <button onClick={() => { setActiveTheme(null); setQuestions([]); setActiveQid(null); }}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  <ArrowLeft size={16} /> Back to themes
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
                      {activeTacheObj?.title.split(' (')[0]} · Preparation: {TACHE_PREP_SECONDS[activeTache] ? fmt(TACHE_PREP_SECONDS[activeTache]) : 'None'} · Duration: {TACHE_DURATION[activeTache]}
                    </p>
                  </div>
                </div>

                {loadingQuestions ? (
                  <div className="flex items-center justify-center rounded-2xl border border-violet-100 bg-white p-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
                  </div>
                ) : questions.length === 0 ? (
                  <div className="rounded-2xl border border-violet-100 bg-white p-8 text-center text-sm text-gray-500">
                    No questions available for this theme yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {questions.map((q) => (
                      <QuestionCard
                        key={q.question_id}
                        q={q}
                        duration={TACHE_DURATION[activeTache]}
                        tacheNum={activeTache}
                        tacheTitle={activeTacheObj?.title || `Tâche ${activeTache}`}
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
                No themes available for this task yet.
              </div>
            ) : (
              <div>
                <h2 className="mb-4 font-heading text-lg font-extrabold text-gray-900">
                  Choose a theme — Tâche {activeTache}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {themes.map((t) => {
                    const locked = t.is_premium && !isPremiumUser;
                    const count = t.question_count ?? 0;
                    return (
                      <button key={t.theme_id} onClick={() => openTheme(t)}
                        className={`flex flex-col rounded-2xl border bg-white p-5 text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50 ${
                          locked ? 'border-amber-100' : 'border-violet-100'
                        }`}>
                        <div className="flex items-start justify-between">
                          <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${
                            locked ? 'bg-amber-50' : 'bg-violet-100'
                          }`}>
                            {locked ? <Lock size={20} weight="fill" className="text-amber-500" /> : (t.emoji || <BookOpen size={20} weight="duotone" className="text-primary" />)}
                          </span>
                          {t.is_premium ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">Pro</span>
                          ) : (
                            <CaretRight size={18} className="text-gray-300" />
                          )}
                        </div>
                        <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t.name}</h3>
                        {t.description && (
                          <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{t.description}</p>
                        )}
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>Questions</span>
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