import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Microphone, Stop, ArrowClockwise, UploadSimple,
  CheckCircle, XCircle, Sparkle, Lightning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { SPEAKING_TASKS, fmtClock } from '../lib/tcf';
import { useAuth } from '../context/AuthContext';
import { BackLink, CreditsBadge } from '../components/shared';
import { useT } from '../i18n';

// Official TCF Canada timings, shared with the backend grader.
const TACHE_INFO = {
  1: { title: 'Tâche 1 : Entretien Dirigé', range: '2 min' },
  2: { title: 'Tâche 2 : Exercice en Interaction', range: '2 min de préparation + 3 min 30' },
  3: { title: "Tâche 3 : Expression d'un Point de Vue", range: '2 min de préparation + 2 min 30' },
};

const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

export default function SpeakingRecord() {
  const { user, refreshUser } = useAuth();
  const t = useT();
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
  // Preparation phase: tache 2 and 3 give the candidate 2 minutes before
  // speaking, exactly as in the real exam.
  const [prepLeft, setPrepLeft] = useState(null);

  const spec = SPEAKING_TASKS[tacheNum] || null;
  const maxSeconds = spec?.speakSeconds ?? null;

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.title = 'Speaking practice | monfrancais';
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
      return toast.error(t('speak.notAudio'));
    }
    if (file.size > 25 * 1024 * 1024) {
      return toast.error(t('speak.tooBig'));
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
      toast.error(t('speak.micDenied'));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  // The real exam cuts the candidate off at the limit; so does this.
  useEffect(() => {
    if (!recording || !maxSeconds || elapsed < maxSeconds) return;
    stopRecording();
    toast.info(t('speak.timeUp'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, elapsed, maxSeconds]);

  // Preparation countdown, then straight into recording.
  const startPreparation = () => {
    if (!user) return navigate('/login');
    if (!spec?.prepSeconds) return startRecording();
    resetRecording();
    setPrepLeft(spec.prepSeconds);
  };

  useEffect(() => {
    if (prepLeft === null) return;
    if (prepLeft <= 0) {
      setPrepLeft(null);
      startRecording();
      return;
    }
    const id = setTimeout(() => setPrepLeft((p) => p - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepLeft]);

  const submit = async () => {
    if (!audioBlob) return toast.error(mode === 'upload' ? t('speak.chooseFileFirst') : t('speak.recordFirst'));
    setAnalyzing(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('question', question);
      form.append('audio', audioBlob, audioName);
      if (tacheNum) form.append('task_type', String(tacheNum));
      const { data } = await api.post('/api/speaking/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      await refreshUser();
      if (!data.transcript) toast.error(t('speak.noSpeech'));
      else toast.success(t('speak.doneToast', { level: data.tcf_level }));
    } catch (err) {
      const status = err?.response?.status;
      if (status === 402) { toast.error(t('speak.freeLimit')); navigate('/pricing'); }
      else toast.error(t('speak.analyseFailed'));
    } finally {
      setAnalyzing(false);
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <BackLink className="!mb-6"
          fallback={themeId ? `/speaking/themes?tache=${tacheNum}&mode=${mode}` : '/speaking/tasks'} />

        {/* QUESTION CARD */}
        <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-6 shadow-soft">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {tache ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-primary">
                {tache.title} · {tache.range}
              </span>
            ) : <span />}
            <CreditsBadge />
          </div>
          <p className="flex items-center gap-2 font-heading text-sm font-bold text-primary">
            <Sparkle size={16} weight="fill" /> {t('speak.yourQuestion')}
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
                <p className="mt-4 font-heading text-lg font-bold text-gray-900">{t('speak.importRecording')}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {t('speak.importHint')}
                </p>
              </>
            ) : prepLeft !== null ? (
              /* Preparation phase — the candidate does not speak yet. */
              <>
                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-4 border-violet-200 font-heading text-2xl font-bold text-primary">
                  {fmtClock(prepLeft)}
                </div>
                <p className="mt-4 font-heading text-lg font-bold text-gray-900">{t('speak.preparation')}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {t('speak.prepHint')}
                </p>
                <button onClick={() => setPrepLeft(0)} className="btn-outline mt-4">
                  {t('speak.readyNow')}
                </button>
              </>
            ) : (
              <>
                <button onClick={recording ? stopRecording : startPreparation}
                  className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition ${
                    recording ? 'animate-pulse bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-primary to-fuchsia-600 hover:scale-105'
                  }`}>
                  {recording ? <Stop size={36} weight="fill" /> : <Microphone size={36} weight="fill" />}
                </button>
                <p className="mt-4 font-heading text-lg font-bold text-gray-900">
                  {recording
                    ? (maxSeconds
                        ? t('speak.recordingOf', { clock: `${mm}:${ss}`, max: fmtClock(maxSeconds) })
                        : t('speak.recording', { clock: `${mm}:${ss}` }))
                    : spec?.prepSeconds ? t('speak.pressToPrepare') : t('speak.pressToSpeak')}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {recording
                    ? maxSeconds
                      ? t('speak.autoStop', { max: fmtClock(maxSeconds) })
                      : t('speak.pressAgain')
                    : spec?.prepSeconds
                      ? t('speak.prepThenSpeak', { prep: spec.prepSeconds / 60, speak: fmtClock(spec.speakSeconds) })
                      : t('speak.answerAloud')}
                </p>
                {recording && maxSeconds && (
                  <div className="mx-auto mt-4 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full transition-all ${elapsed > maxSeconds * 0.85 ? 'bg-red-500' : 'bg-primary'}`}
                      style={{ width: `${Math.min(100, (elapsed / maxSeconds) * 100)}%` }}
                    />
                  </div>
                )}
              </>
            )
          ) : (
            <>
              <p className="font-heading text-lg font-bold text-gray-900">
                {mode === 'upload' ? t('speak.fileLabel', { name: audioName }) : t('speak.yourRecording', { clock: `${mm}:${ss}` })}
              </p>
              <audio src={audioUrl} controls className="mx-auto mt-4 w-full max-w-md" />
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button onClick={resetRecording} className="btn-outline">
                  {mode === 'upload' ? <><UploadSimple size={18} weight="bold" /> {t('speak.changeFile')}</> : <><ArrowClockwise size={18} /> {t('speak.reRecord')}</>}
                </button>
                <button onClick={submit} disabled={analyzing}
                  className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  {analyzing ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {t('speak.analysing')}</> : <><Lightning size={18} weight="fill" /> {t('speak.analyse')}</>}
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
                  <p className="text-xs uppercase tracking-wide text-gray-400">{t('speak.level')}</p>
                  <p className="font-heading text-3xl font-extrabold text-primary">{result.tcf_level}</p>
                  <p className="text-xs text-gray-400">{result.overall_score}/100</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
              <p className="font-heading text-sm font-bold text-gray-900">{t('speak.transcript')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {result.transcript || 'Aucune parole détectée.'}
              </p>
            </div>

            {Array.isArray(result.errors) && result.errors.length > 0 && (
              <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
                <p className="font-heading text-sm font-bold text-gray-900">{t('speak.corrections')}</p>
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
                <p className="font-heading text-sm font-bold text-gray-900">{t('speak.suggestions')}</p>
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
                <p className="font-heading text-sm font-bold text-gray-900">{t('speak.vocabulary')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.vocabulary_suggestions.map((v, i) => (
                    <span key={i} className="rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-medium text-fuchsia-700">{v}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <button onClick={resetRecording} className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
                <Microphone size={18} weight="fill" /> {t('speak.newAnswer')}
              </button>
            </div>
          </div>
        )}

        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-gray-400">
          {t('speak.disclaimer')}
        </p>
      </section>
    </main>
  );
}