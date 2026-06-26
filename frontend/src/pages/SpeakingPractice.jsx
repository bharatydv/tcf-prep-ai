import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Microphone, Stop, ArrowClockwise,
  CheckCircle, XCircle, Sparkle, Waveform, Lightning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const SPEAKING_PROMPTS = [
  "Présentez-vous : parlez de vous, de votre travail ou de vos études, et de vos centres d'intérêt. (1 à 2 minutes)",
  "Décrivez votre ville ou votre quartier et expliquez ce que vous aimez ou n'aimez pas. (1 à 2 minutes)",
  "Racontez un voyage ou une expérience qui vous a marqué(e). (1 à 2 minutes)",
  "« Le télétravail est-il une bonne chose ? » Donnez votre opinion et justifiez-la. (2 à 3 minutes)",
];

const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

export default function SpeakingPractice() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [promptIdx, setPromptIdx] = useState(0);
  const question = SPEAKING_PROMPTS[promptIdx];

  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    document.title = 'Speaking practice | MonFrancais';
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const resetRecording = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    setElapsed(0);
    setResult(null);
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
    if (!audioBlob) return toast.error("Enregistrez d'abord votre réponse.");
    setAnalyzing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('question', question);
      form.append('audio', audioBlob, 'answer.webm');
      const { data } = await api.post('/api/speaking/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      await refreshUser();
      if (!data.transcript) {
        toast.error('Aucune parole détectée. Réessayez en parlant plus fort.');
      } else {
        toast.success(`Analyse terminée — niveau ${data.tcf_level}`);
      }
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
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-12 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Waveform size={14} weight="fill" /> Speaking practice
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            Speak.{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">Get instant feedback.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-700">
            Record your spoken answer to a French task. Our AI transcribes it, checks whether it answers the question, and gives you corrections and suggestions.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* QUESTION PICKER */}
        <div className="mb-6 flex flex-wrap gap-2">
          {SPEAKING_PROMPTS.map((_, i) => (
            <button
              key={i}
              onClick={() => { setPromptIdx(i); resetRecording(); }}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                promptIdx === i ? 'bg-gradient-to-r from-primary to-fuchsia-600 text-white' : 'border border-violet-200 bg-white text-gray-600 hover:bg-violet-50'
              }`}
            >
              Question {i + 1}
            </button>
          ))}
        </div>

        {/* QUESTION CARD */}
        <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-6 shadow-soft">
          <p className="flex items-center gap-2 font-heading text-sm font-bold text-primary">
            <Sparkle size={16} weight="fill" /> Votre question
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-800">{question}</p>
        </div>

        {/* RECORDER */}
        <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-xl shadow-violet-200/40">
          {!audioBlob ? (
            <>
              <button
                onClick={recording ? stopRecording : startRecording}
                data-testid="record-button"
                className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition ${
                  recording ? 'animate-pulse bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-primary to-fuchsia-600 hover:scale-105'
                }`}
              >
                {recording ? <Stop size={36} weight="fill" /> : <Microphone size={36} weight="fill" />}
              </button>
              <p className="mt-4 font-heading text-lg font-bold text-gray-900">
                {recording ? `Enregistrement… ${mm}:${ss}` : 'Appuyez pour parler'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {recording ? 'Appuyez à nouveau pour arrêter.' : 'Répondez à la question à voix haute.'}
              </p>
            </>
          ) : (
            <>
              <p className="font-heading text-lg font-bold text-gray-900">Votre enregistrement ({mm}:{ss})</p>
              <audio ref={audioRef} src={audioUrl} controls className="mx-auto mt-4 w-full max-w-md" />
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button onClick={resetRecording} className="btn-outline" data-testid="rerecord-button">
                  <ArrowClockwise size={18} /> Réenregistrer
                </button>
                <button onClick={submit} disabled={analyzing} className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600" data-testid="analyze-speaking-button">
                  {analyzing ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Analyse…</> : <><Lightning size={18} weight="fill" /> Analyser ma réponse</>}
                </button>
              </div>
            </>
          )}
        </div>

        {/* RESULT */}
        {result && (
          <div className="mt-8 space-y-5" data-testid="speaking-result">
            {/* Score + relevance */}
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

            {/* Transcript */}
            <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
              <p className="font-heading text-sm font-bold text-gray-900">Transcription</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {result.transcript || 'Aucune parole détectée.'}
              </p>
            </div>

            {/* Errors */}
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

            {/* Suggestions */}
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

            {/* Vocabulary */}
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

        {/* honest note */}
        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-gray-400">
          The AI grades the content and language of your transcribed answer. It does not score pronunciation or accent. This is a practice tool — estimated levels are for guidance only.
        </p>
      </div>
    </main>
  );
}