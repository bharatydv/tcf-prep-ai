import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Timer, Lightning, PenNib, Sparkle, BookOpen, ListChecks, ArrowRight, ArrowLeft,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, BACKEND_URL } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AccentToolbar, AnalysisProgress, streamAnalysis } from '../components/shared';

const TACHE_INFO = {
  1: { title: 'Tâche 1 : Écrire un message', range: '60 – 120 mots' },
  2: { title: 'Tâche 2 : Rédiger un article', range: '120 – 150 mots' },
  3: { title: 'Tâche 3 : Comparer deux avis', range: '120 – 180 mots' },
};

export default function PracticeWrite() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tacheNum = parseInt(searchParams.get('tache'), 10);
  const tache = TACHE_INFO[tacheNum] || null;
  const themeId = searchParams.get('theme');
  const [themeQuestion, setThemeQuestion] = useState('');

  const [prompts, setPrompts] = useState([]);
  const [activePrompt, setActivePrompt] = useState(null);
  const [ownQuestion, setOwnQuestion] = useState('');
  const [text, setText] = useState('');
  const [stage, setStage] = useState(null);
  const [timerOn, setTimerOn] = useState(false);
  const [seconds, setSeconds] = useState(60 * 60);
  const taRef = useRef(null);

  useEffect(() => {
    api.get('/api/prompts').then(({ data }) => setPrompts(data.prompts)).catch(() => {});
  }, []);

  // Load a random question from the chosen theme + tâche
  useEffect(() => {
    if (!themeId || !tacheNum) return;
    api.get(`/api/themes/${themeId}/questions?task_type=${tacheNum}`)
      .then(({ data }) => {
        const qs = data.questions || [];
        if (qs.length) {
          const pick = qs[Math.floor(Math.random() * qs.length)];
          setThemeQuestion(pick.prompt_text);
          setOwnQuestion(pick.prompt_text);
        }
      })
      .catch(() => {});
  }, [themeId, tacheNum]);

  useEffect(() => {
    if (!timerOn) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [timerOn]);

  const freeMode = activePrompt === null;

  const selectPrompt = (p) => {
    if (!user) return navigate('/login');
    setActivePrompt(p || null);
    setSeconds(60 * 60);
    setTimeout(() => taRef.current?.focus(), 50);
  };

  const submit = async () => {
    if (!user) return navigate('/login');
    if (!text.trim()) return toast.error('Écrivez quelque chose d\u2019abord !');
    const topic = freeMode ? (ownQuestion.trim() || null) : (activePrompt?.title || null);
    setStage('parsing');
    await streamAnalysis(BACKEND_URL, {
      text,
      prompt_id: activePrompt?.prompt_id || null,
      topic,
      source: 'practice',
    }, {
      onStage: setStage,
      onComplete: async (sub) => {
        await refreshUser();
        toast.success(`Analyse termin\u00e9e \u2014 niveau ${sub.tcf_level}`);
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

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <button
          onClick={() => navigate(themeId ? `/practice/themes?tache=${tacheNum}` : '/practice/tasks')}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          data-testid="back-to-tasks"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* LEFT: test list */}
          <aside className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-soft">
            <p className="flex items-center gap-2 font-heading text-sm font-bold text-gray-900">
              <BookOpen size={18} weight="duotone" className="text-primary" /> Writing tests
            </p>

            <button
              onClick={() => selectPrompt(null)}
              data-testid="start-writing-button"
              className={`mt-4 flex h-[68px] w-full items-center gap-3 rounded-2xl border px-4 text-left transition ${
                freeMode
                  ? 'border-primary bg-white shadow-md shadow-violet-200/60 ring-1 ring-primary'
                  : 'border-violet-100 bg-white/70 hover:bg-white hover:shadow-sm'
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-primary">
                <PenNib size={17} weight="fill" />
              </span>
              <span className="min-w-0">
                <span className="block font-heading text-sm font-bold text-gray-900">Your own question</span>
                <span className="block text-xs text-gray-500">Type a topic and write on it</span>
              </span>
            </button>

            <div className="mt-3 space-y-2.5">
              {prompts.map((p, i) => {
                const active = activePrompt?.prompt_id === p.prompt_id;
                return (
                  <button
                    key={p.prompt_id}
                    onClick={() => selectPrompt(p)}
                    data-testid={`prompt-${p.prompt_id}`}
                    className={`flex h-[68px] w-full items-center gap-3 rounded-2xl border px-4 text-left transition ${
                      active
                        ? 'border-primary bg-white shadow-md shadow-violet-200/60 ring-1 ring-primary'
                        : 'border-violet-100 bg-white/70 hover:bg-white hover:shadow-sm'
                    }`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-heading text-sm font-bold ${
                      active ? 'bg-primary text-white' : 'bg-violet-100 text-primary'
                    }`}>
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-heading text-sm font-bold text-gray-900">Test {i + 1}</span>
                      <span className="block text-xs capitalize text-gray-500">{p.category} · {p.level}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* RIGHT: writing panel */}
          <div className="rounded-3xl border border-violet-100 bg-white p-5 shadow-xl shadow-violet-200/40 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 pb-4">
              <div className="min-w-0 flex-1">
                {freeMode ? (
                  <>
                    {tache && (
                      <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-primary" data-testid="chosen-tache">
                        {tache.title} · {tache.range}
                      </span>
                    )}
                    <label className="flex items-center gap-2 font-heading text-sm font-bold text-gray-900">
                      <ListChecks size={16} weight="duotone" className="text-primary" /> Your question / topic
                    </label>
                    <input
                      value={ownQuestion}
                      maxLength={1000}
                      onChange={(e) => setOwnQuestion(e.target.value)}
                      className="input !rounded-xl mt-2 text-sm"
                      placeholder="Type the question you want to write about\u2026"
                      data-testid="own-question-input"
                    />
                  </>
                ) : (
                  <>
                    <h2 className="font-heading text-lg font-bold text-gray-900">{activePrompt.title}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">{activePrompt.description}</p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <span className="rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-semibold text-primary" data-testid="word-count">
                  {words} mots
                </span>
                <button
                  className={`btn-outline !py-1.5 text-sm ${timerOn ? '!border-primary !text-primary' : ''}`}
                  onClick={() => setTimerOn(!timerOn)}
                  data-testid="timer-toggle"
                >
                  <Timer size={16} /> {timerOn ? `${mm}:${ss}` : '60 min'}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setText(next)} />
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onDrop={(e) => e.preventDefault()}
                lang="fr"
                className="input paper-textarea mt-3 min-h-[340px] p-6 shadow-card"
                placeholder="Commencez \u00e0 \u00e9crire en fran\u00e7ais\u2026"
                data-testid="writing-textarea"
              />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-gray-500">{words} mots</span>
              <div className="flex gap-3">
                <button
                  className="btn-outline"
                  onClick={() => { setText(''); setOwnQuestion(''); setActivePrompt(null); }}
                >
                  Effacer
                </button>
                <button
                  className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600"
                  onClick={submit}
                  data-testid="submit-text-button"
                >
                  <Lightning size={18} weight="fill" /> Analyser mon texte
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RECENT TOPICS (placeholder) */}
        <div className="mt-12">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-heading text-xl font-extrabold text-gray-900">
              <Sparkle size={20} weight="fill" className="text-primary" /> Recent Topics
            </h2>
            <Link to="/combinations" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="recent-see-all">
              See all <ArrowRight size={15} weight="bold" />
            </Link>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <Link
                key={n}
                to="/combinations"
                data-testid={`recent-combo-${n}`}
                className="block overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50"
              >
                <div className="h-1.5 w-full bg-gradient-to-r from-primary to-fuchsia-500" />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-600 text-white">
                      <PenNib size={20} weight="fill" />
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Available
                    </span>
                  </div>
                  <h3 className="mt-4 font-heading text-base font-bold text-gray-900">Combinaison {n}</h3>
                  <p className="mt-1 text-sm text-gray-500">June 2026</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}