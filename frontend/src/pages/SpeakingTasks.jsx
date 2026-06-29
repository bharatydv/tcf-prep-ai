import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChatText, Handshake, Scales, ClockCountdown, ArrowLeft,
  Lock, CaretRight, BookOpen, Microphone, Star, Clock,
  Stop, ArrowClockwise, UploadSimple, Lightning, CheckCircle, XCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const TACHES = [
  { n: 1, title: 'Tâche 1 : Entretien Dirigé (Guided Interview)', meta: '2 minutes',
    focus: 'Present yourself and talk about your background, habits, or interests.', icon: ChatText },
  { n: 2, title: 'Tâche 2 : Exercice en Interaction (Interactive Roleplay)', meta: '5.5 minutes (includes 2 minutes of preparation time)',
    focus: 'Ask formal and informal questions to obtain specific information in a real-world scenario.', icon: Handshake },
  { n: 3, title: "Tâche 3 : Expression d'un Point de Vue (Opinion Monologue)", meta: '4.5 minutes',
    focus: 'Deliver a structured argument to state and defend your opinion on an abstract societal issue.', icon: Scales },
];

const TACHE_DURATION = { 1: '2 min', 2: '5 min 30 s', 3: '4 min 30 s' };

const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

/* ---- Inline recorder/uploader + analysis for a single question ---- */
function QuestionCard({ q, duration, isActive, onActivate, refreshUser, navigate }) {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioName, setAudioName] = useState('answer.webm');
  const [elapsed, setElapsed] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  // If another card becomes active, stop & reset this one
  useEffect(() => {
    if (!isActive) {
      if (mediaRecorderRef.current && recording) {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
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

  const startRecording = async () => {
    onActivate();
    reset();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioName('answer.webm');
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      toast.error("Impossible d'accéder au microphone. Vérifiez les autorisations.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
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
  const showActions = isActive && (recording || audioBlob || analyzing || result);

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

      {/* Two action buttons */}
      {!showActions && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button onClick={startRecording}
            className="btn-primary flex-1 justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <Microphone size={16} weight="fill" /> Record answer
          </button>
          <button onClick={openFilePicker} className="btn-outline flex-1 justify-center">
            <UploadSimple size={16} weight="bold" /> Upload recording
          </button>
        </div>
      )}

      {/* Inline recorder / playback / analyze */}
      {showActions && (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/30 p-5 text-center">
          {recording ? (
            <>
              <button onClick={stopRecording}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg animate-pulse">
                <Stop size={26} weight="fill" />
              </button>
              <p className="mt-3 font-heading text-sm font-bold text-gray-900">Enregistrement… {mm}:{ss}</p>
              <p className="text-xs text-gray-500">Appuyez pour arrêter.</p>
            </>
          ) : audioBlob ? (
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

      {/* Inline results */}
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

  const startSimulator = () => {
    if (!user) return navigate('/login');
    navigate('/exam-simulator');
  };

  const activeTacheObj = TACHES.find((t) => t.n === activeTache);

  return (
    <main className="overflow-x-clip bg-white">
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
              <div className="flex h-full flex-col justify-center rounded-3xl border border-pink-100 bg-gradient-to-br from-pink-50 to-fuchsia-50 p-8 shadow-soft">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pink-100 text-pink-700">
                  <ClockCountdown size={28} weight="fill" />
                </span>
                <h2 className="mt-4 font-heading text-xl font-extrabold text-gray-900">AI Exam Simulator</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600">
                  Sit all three tâches under one continuous 12-minute timer, exactly like exam day, and get a CLB score prediction for your complete test.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-pink-600" /> Timed, back-to-back tasks</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-pink-600" /> Real exam conditions</li>
                  <li className="flex items-center gap-2"><CaretRight size={14} weight="bold" className="text-pink-600" /> CLB score prediction</li>
                </ul>
                <button onClick={startSimulator}
                  className="btn-primary mt-6 w-fit !bg-gradient-to-r !from-pink-600 !to-fuchsia-600">
                  <ClockCountdown size={18} weight="fill" /> Start Exam Simulator
                </button>
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
                      {activeTacheObj?.title.split(' (')[0]} · Preparation: None · Duration: {TACHE_DURATION[activeTache]}
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