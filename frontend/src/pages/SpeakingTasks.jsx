import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChatText, Handshake, Scales, ClockCountdown, ArrowLeft,
  Lock, CaretRight, BookOpen, Microphone, Star, Clock,
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

export default function SpeakingTasks() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTache, setActiveTache] = useState(null);
  const [themes, setThemes] = useState([]);
  const [loadingThemes, setLoadingThemes] = useState(false);

  // question-list view state
  const [activeTheme, setActiveTheme] = useState(null); // theme object
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const isPremiumUser = user?.subscription_status === 'premium';

  const selectTache = (t) => {
    if (!user) return navigate('/login');
    setActiveTache(t.n);
    setActiveTheme(null);
    setQuestions([]);
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
    setLoadingQuestions(true);
    api.get(`/api/themes/${t.theme_id}/questions?task_type=${activeTache}`)
      .then(({ data }) => setQuestions(data.questions || []))
      .catch(() => setQuestions([]))
      .finally(() => setLoadingQuestions(false));
  };

  const recordQuestion = (q) => {
    if (!user) return navigate('/login');
    const params = new URLSearchParams({
      tache: String(activeTache),
      theme: activeTheme.theme_id,
      q: q.prompt_text,
    });
    navigate(`/speaking/record?${params.toString()}`);
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
              /* DEFAULT: simulator */
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
              /* QUESTION LIST for the selected theme */
              <div>
                <button onClick={() => { setActiveTheme(null); setQuestions([]); }}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  <ArrowLeft size={16} /> Back to themes
                </button>

                {/* task header card */}
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
                      <div key={q.question_id}
                        className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft transition hover:border-violet-200 hover:shadow-lg hover:shadow-violet-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-xs font-semibold text-gray-500">
                            <span className="inline-flex items-center gap-1.5">
                              <Clock size={14} weight="bold" className="text-gray-400" /> {TACHE_DURATION[activeTache]}
                            </span>
                          </div>
                          <Star size={18} className="text-gray-300" />
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-gray-800">{q.prompt_text}</p>
                        <button onClick={() => recordQuestion(q)}
                          className="btn-primary mt-4 w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
                          <Microphone size={16} weight="fill" /> Record answer
                        </button>
                      </div>
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
              /* THEME GRID */
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