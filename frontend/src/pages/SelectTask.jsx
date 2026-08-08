import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChatText, Article, Scales, ArrowLeft,
  Lock, CaretRight, BookOpen, PenNib, Lightning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const TACHES = [
  { n: 1, title: 'Tâche 1 : Écrit Court (Short Message)', meta: '60 – 120 mots',
    focus: 'Presenting, describing, or summarizing an event to a friend or relative.', icon: ChatText },
  { n: 2, title: 'Tâche 2 : Article / Lettre (Extended Text)', meta: '120 – 150 mots',
    focus: 'Writing an article, a letter of complaint, or a professional response to a public forum.', icon: Article },
  { n: 3, title: 'Tâche 3 : Synthèse et Opinion (Document Comparison & Essay)', meta: '120 – 180 mots',
    focus: 'Comparing two viewpoints and defending an abstract position clearly.', icon: Scales },
];

export default function SelectTask() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTache, setActiveTache] = useState(null);
  const [themes, setThemes] = useState([]);
  const [loadingThemes, setLoadingThemes] = useState(false);

  // Writing on a topic the learner brings themselves. This is what the page
  // leads with, so it shows whenever no tâche is selected.
  const [ownQuestion, setOwnQuestion] = useState('');
  const [ownText, setOwnText] = useState('');
  const ownMode = activeTache === null;

  const isPremiumUser = user?.subscription_status === 'premium';

  // Arriving from the landing simulator: prefill the topic and answer.
  const { state: navState } = useLocation();
  useEffect(() => {
    if (!navState) return;
    if (navState.ownQuestion || navState.text) {
      setActiveTache(null);
      setOwnQuestion(navState.ownQuestion || '');
      setOwnText(navState.text || '');
    }
  }, [navState]);

  const startOwn = () => {
    if (!user) return navigate('/login');
    if (!ownQuestion.trim() && !ownText.trim()) {
      return toast.error('Écrivez votre sujet ou votre texte d’abord.');
    }
    navigate('/practice/write', {
      state: {
        ownQuestion: ownQuestion.trim(),
        text: ownText.trim(),
        autostart: Boolean(ownText.trim()),
      },
    });
  };

  const selectTache = (t) => {
    if (!user) return navigate('/login');
    setActiveTache(t.n);
    setThemes([]);
    setLoadingThemes(true);
    api.get(`/api/themes?task_type=${t.n}&skill=writing`)
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
    navigate(`/practice/write?tache=${activeTache}&theme=${t.theme_id}`);
  };

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <button onClick={() => navigate('/practice')}
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="mb-7">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">Practice Task Overview</h1>
          <p className="mt-2 max-w-lg text-sm text-gray-600">
            Choose a writing task on the left to see its themes, or run the full exam simulator.
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

          {/* RIGHT — own question, simulator by default, or themes */}
          <div className="min-h-[360px]">
            {ownMode ? (
              <div className="flex h-full flex-col rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-soft sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-600 text-white shadow-md shadow-violet-300/50">
                    <PenNib size={22} weight="fill" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-heading text-xl font-extrabold leading-tight text-gray-900">Your own question</h2>
                    <p className="mt-0.5 text-[13px] leading-snug text-gray-600">
                      Paste your topic, then your answer — or leave it blank to write on the next page.
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-baseline justify-between gap-3">
                  <label htmlFor="own-question" className="text-xs font-bold uppercase tracking-wide text-primary">Question</label>
                  <span className="text-[11px] tabular-nums text-gray-400">{ownQuestion.length} / 1000</span>
                </div>
                <input
                  id="own-question"
                  className="input !rounded-xl mt-1.5 text-sm" maxLength={1000}
                  placeholder="Paste your topic or question here…"
                  value={ownQuestion} onChange={(e) => setOwnQuestion(e.target.value)}
                  data-testid="own-question-input"
                />

                <div className="mt-4 flex items-baseline justify-between gap-3">
                  <label htmlFor="own-answer" className="text-xs font-bold uppercase tracking-wide text-primary">
                    Answer <span className="font-semibold normal-case tracking-normal text-gray-400">· optional</span>
                  </label>
                  <span className="text-[11px] tabular-nums text-gray-400">
                    {ownText.trim() ? ownText.trim().split(/\s+/).length : 0} mots · {ownText.length} / 3000
                  </span>
                </div>
                <textarea
                  id="own-answer"
                  className="input !rounded-xl mt-1.5 min-h-[150px] flex-1 resize-none text-sm" maxLength={3000}
                  placeholder="Write your answer here… (leave blank to start fresh on the next page)"
                  value={ownText} onChange={(e) => setOwnText(e.target.value)}
                  data-testid="own-answer-input"
                />

                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-violet-100 pt-4">
                  <button onClick={startOwn} data-testid="own-start-button"
                    className="btn-primary w-fit !bg-gradient-to-r !from-primary !to-fuchsia-600 shadow-lg shadow-violet-300/50 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-300/60">
                    <Lightning size={18} weight="fill" />
                    {ownText.trim() ? 'Analyser mon texte' : 'Commencer à écrire'}
                  </button>
                  <p className="text-xs text-gray-500">Or pick a tâche on the left to practice a real exam format.</p>
                </div>
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
                <button onClick={() => { setActiveTache(null); setThemes([]); }}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  <ArrowLeft size={16} /> Écrire sur mon propre sujet
                </button>
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
                            <span>Attempted questions</span>
                            <span className="font-semibold text-gray-700">{locked ? '—' : `0/${count}`}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: '0%' }} />
                          </div>
                          <p className="mt-1 text-right text-[10px] text-gray-400">{locked ? 'Upgrade to unlock' : '0% completed'}</p>
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