import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Microphone, Stop, ArrowClockwise, ArrowLeft, UploadSimple,
  CheckCircle, XCircle, Sparkle, Lightning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const TACHE_INFO = {
  1: { title: 'Tâche 1 : Entretien Dirigé', range: '2 min' },
  2: { title: 'Tâche 2 : Exercice en Interaction', range: '5.5 min' },
  3: { title: "Tâche 3 : Expression d'un Point de Vue", range: '4.5 min' },
};

const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

export default function SpeakingRecord() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tacheNum = parseInt(searchParams.get('tache'), 10);
  const tache = TACHE_INFO[tacheNum] || null;
  const themeId = searchParams.get('theme');
  const mode = searchParams.get('mode') === 'upload' ? 'upload' : 'record';

  const [question, setQuestion] = useState(
    'Présentez-vous : parlez de vous, de votre travail ou de vos études, et de vos centres d’intérêt.');

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

  useEffect(() => {
    document.title = 'Speaking practice | MonFrancais';
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Load the chosen question (passed via ?q=) or a random one from the theme.
  useEffect(() => {
    const passed = searchParams.get('q');
    if (passed) {
      setQuestion(passed);
      return;
    }
    if (!themeId || !tacheNum) return;
    api.get(`/api/themes/${themeId}/questions?task_type=${tacheNum}`)
      .then(({ data }) => {
        const qs = data.questions || [];
        if (qs.length) {
          const pick = qs[Math.floor(Math.random() * qs.length)];
          setQuestion(pick.prompt_text);
        }
      })
      .catch(() => {});
  }, [themeId, tacheNum, searchParams]);

  const resetRecording = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    setAudioName('answer.webm');
    setElapsed(0);
    setResult(null);
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
    resetRecording();
    setAudioBlob(file);
    setAudioName(file.name || 'upload.mp3');
    setAudioUrl(URL.createObjectURL(file));
  };

  const startRecording = async () => {
    if (!user) return navigate('/login');
    resetRecording();
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

  const submit = async () => {
    if (!audioBlob) return toast.error(mode === 'upload' ? "Choisissez d'abord un fichier audio." : "Enregistrez d'abord votre réponse.");
    setAnalyzing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('question', question);
      form.append('audio', audioBlob, audioName);
      const { data } = await api.post('/api/speaking/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      await refreshUser();
      if (!data.transcript) toast.error('Aucune parole détectée. Réessayez en parlant plus fort.');
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

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <button
          onClick={() => navigate(themeId ? `/speaking/themes?tache=${tacheNum}&mode=${mode}` : '/speaking/tasks')}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> Back
        </button>

        {/* QUESTION CARD */}
        <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-6 shadow-soft">
          {tache && (
            <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-primary">
              {tache.title} · {tache.range}
            </span>
          )}
          <p className="flex items-center gap-2 font-heading text-sm font-bold text-primary">
            <Sparkle size={16} weight="fill" /> Votre question
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-800">{question}</p>
        </div>

        {/* RECORDER / UPLOAD */}
        <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-xl shadow-violet-200/40">
          {!audioBlob ? (
            mode === 'upload' ? (
              <>
                <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFile} className="hidden" />
                <button onClick={() => { if (!user) return navigate('/login'); fileInputRef.current?.click(); }}
                  className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-600 text-white shadow-lg transition hover:scale-105">
                  <UploadSimple size={36} weight="bold" />
                </button>
                <p className="mt-4 font-heading text-lg font-bold text-gray-900">Importer un enregistrement</p>
                <p className="mt-1 text-sm text-gray-500">
                  Choisissez un fichier audio (mp3, m4a, wav, webm — max 25 Mo).
                </p>
              </>
            ) : (
              <>
                <button onClick={recording ? stopRecording : startRecording}
                  className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition ${
                    recording ? 'animate-pulse bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-primary to-fuchsia-600 hover:scale-105'
                  }`}>
                  {recording ? <Stop size={36} weight="fill" /> : <Microphone size={36} weight="fill" />}
                </button>
                <p className="mt-4 font-heading text-lg font-bold text-gray-900">
                  {recording ? `Enregistrement… ${mm}:${ss}` : 'Appuyez pour parler'}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {recording ? 'Appuyez à nouveau pour arrêter.' : 'Répondez à la question à voix haute.'}
                </p>
              </>
            )
          ) : (
            <>
              <p className="font-heading text-lg font-bold text-gray-900">
                {mode === 'upload' ? `Fichier : ${audioName}` : `Votre enregistrement (${mm}:${ss})`}
              </p>
              <audio src={audioUrl} controls className="mx-auto mt-4 w-full max-w-md" />
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button onClick={resetRecording} className="btn-outline">
                  {mode === 'upload' ? <><UploadSimple size={18} weight="bold" /> Changer de fichier</> : <><ArrowClockwise size={18} /> Réenregistrer</>}
                </button>
                <button onClick={submit} disabled={analyzing}
                  className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  {analyzing ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Analyse…</> : <><Lightning size={18} weight="fill" /> Analyser ma réponse</>}
                </button>
              </div>
            </>
          )}
        </div>

        {/* RESULT */}
        {result && (
          <div className="mt-8 space-y-5">
            <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {result.answers_question ? (
                    <CheckCircle size={28} weight="fill" className="text-green-500" />
                  ) : (
                    <XCircle size={28} weight="fill" className="text-amber-500" />
                  )}
                  <div>
                    <p className="font-heading text-base font-bold text-gray-900">
                      {result.answers_question ? 'Réponse pertinente' : 'Réponse à améliorer'}
                    </p>
                    <p className="text-sm text-gray-600">{result.relevance_comment}</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Niveau</p>
                  <p className="font-heading text-3xl font-extrabold text-primary">{result.tcf_level}</p>
                  <p className="text-xs text-gray-400">{result.overall_score}/100</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
              <p className="font-heading text-sm font-bold text-gray-900">Transcription</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {result.transcript || 'Aucune parole détectée.'}
              </p>
            </div>

            {Array.isArray(result.errors) && result.errors.length > 0 && (
              <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
                <p className="font-heading text-sm font-bold text-gray-900">Corrections</p>
                <div className="mt-3 space-y-3">
                  {result.errors.map((e, i) => (
                    <div key={i} className="rounded-2xl border border-violet-50 bg-violet-50/40 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-red-500 line-through">{e.error}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-semibold text-green-600">{e.correction}</span>
                        <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{CAT_LABELS[e.category] || e.category}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{e.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
              <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
                <p className="font-heading text-sm font-bold text-gray-900">Suggestions</p>
                <ul className="mt-3 space-y-2">
                  {result.suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(result.vocabulary_suggestions) && result.vocabulary_suggestions.length > 0 && (
              <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
                <p className="font-heading text-sm font-bold text-gray-900">Vocabulaire à enrichir</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.vocabulary_suggestions.map((v, i) => (
                    <span key={i} className="rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-medium text-fuchsia-700">{v}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <button onClick={resetRecording} className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
                <Microphone size={18} weight="fill" /> Nouvelle réponse
              </button>
            </div>
          </div>
        )}

        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-gray-400">
          The AI grades the content and language of your transcribed answer. It does not score pronunciation or accent. This is a practice tool — estimated levels are for guidance only.
        </p>
      </section>
    </main>
  );
}