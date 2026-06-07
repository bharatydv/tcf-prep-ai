import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Timer, ClipboardText, Lightning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, BACKEND_URL, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AccentToolbar, AnalysisProgress, streamAnalysis } from '../components/shared';

const FREE_LIMIT = 5;

export default function Practice() {
  const { promptId } = useParams();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState([]);
  const [activePrompt, setActivePrompt] = useState(null);
  const [text, setText] = useState('');
  const [writing, setWriting] = useState(false);
  const [stage, setStage] = useState(null);
  const [timerOn, setTimerOn] = useState(false);
  const [seconds, setSeconds] = useState(60 * 60);
  const taRef = useRef(null);

  useEffect(() => {
    api.get('/api/prompts').then(({ data }) => setPrompts(data.prompts)).catch(() => {});
  }, []);

  useEffect(() => {
    if (promptId) {
      api.get(`/api/prompts/${promptId}`)
        .then(({ data }) => { setActivePrompt(data.prompt); setWriting(true); })
        .catch(() => navigate('/practice'));
    }
  }, [promptId, navigate]);

  useEffect(() => {
    if (!timerOn || !writing) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [timerOn, writing]);

  const startWriting = (p) => {
    if (!user) return navigate('/login');
    setActivePrompt(p || null);
    setWriting(true);
    setSeconds(60 * 60);
  };

  const submit = async () => {
    if (!text.trim()) return toast.error('Écrivez quelque chose d’abord !');
    setStage('parsing');
    await streamAnalysis(BACKEND_URL, { text, prompt_id: activePrompt?.prompt_id || null, source: 'practice' }, {
      onStage: setStage,
      onComplete: async (sub) => {
        await refreshUser();
        toast.success(`Analyse terminée — niveau ${sub.tcf_level}`);
        navigate(`/feedback/${sub.submission_id}`);
      },
      onError: (detail, status) => {
        setStage(null);
        toast.error(detail);
        if (status === 402) navigate('/pricing');
      },
    });
  };

  if (stage) return <main className="px-4 py-16"><AnalysisProgress current={stage} /></main>;

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  if (writing) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{activePrompt ? activePrompt.title : 'Écriture libre'}</h1>
            {activePrompt && <p className="mt-1 max-w-2xl text-sm text-gray-600">{activePrompt.description}</p>}
          </div>
          <div className="flex items-center gap-3">
            {user && user.subscription_status !== 'premium' && (
              <span className="pill bg-violet-50 text-primary" data-testid="attempts-badge">
                {user.free_submissions_used} / {FREE_LIMIT} free attempts
              </span>
            )}
            <button className={`btn-outline !py-1.5 text-sm ${timerOn ? '!border-primary !text-primary' : ''}`}
              onClick={() => setTimerOn(!timerOn)} data-testid="timer-toggle">
              <Timer size={16} /> {timerOn ? `${mm}:${ss}` : 'Minuteur 60 min'}
            </button>
          </div>
        </div>

        <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setText(next)} />
        <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} lang="fr"
          className="input paper-textarea mt-3 p-6 shadow-card" placeholder="Rédigez votre texte en français ici…"
          data-testid="writing-textarea" />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-gray-500">{words} mots</span>
          <div className="flex gap-3">
            <button className="btn-outline" onClick={() => { setWriting(false); setText(''); navigate('/practice'); }}>Annuler</button>
            <button className="btn-primary" onClick={submit} data-testid="submit-text-button">
              <Lightning size={18} weight="fill" /> Analyser mon texte
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Writing Assistant</h1>
          <p className="mt-2 text-gray-600">Choose a C1 prompt, write freely, or check writing you did elsewhere.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {user && user.subscription_status !== 'premium' && (
            <span className="pill self-center bg-violet-50 text-primary" data-testid="attempts-badge">
              {user.free_submissions_used} / {FREE_LIMIT} free attempts
            </span>
          )}
          <Link to="/check-writing" className="btn-outline" data-testid="check-writing-button">
            <ClipboardText size={18} /> Check my writing
          </Link>
          <button className="btn-primary" onClick={() => startWriting(null)} data-testid="start-writing-button">
            Start Writing
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {prompts.map((p) => (
          <div key={p.prompt_id} className="card card-hover flex flex-col p-6">
            <span className="pill mb-3 self-start bg-violet-50 capitalize text-primary">{p.category} · {p.level}</span>
            <h3 className="font-heading text-lg font-semibold">{p.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{p.description}</p>
            <button className="btn-primary mt-4 self-start !py-2 text-sm"
              onClick={() => { startWriting(p); }} data-testid={`prompt-${p.prompt_id}`}>
              Écrire sur ce sujet
            </button>
          </div>
        ))}
      </div>

      <div className="card mt-10 flex flex-col items-center gap-4 p-8 text-center sm:flex-row sm:text-left">
        <span className="text-4xl">📝</span>
        <div className="flex-1">
          <h3 className="font-heading text-lg font-semibold">Full exam conditions?</h3>
          <p className="text-sm text-gray-600">Run the 3-task TCF Canada simulator: 60 strict minutes, no spellcheck, no paste.</p>
        </div>
        <Link to="/exam-simulator" className="btn-primary" data-testid="exam-simulator-link">Exam Simulator</Link>
      </div>
    </main>
  );
}
