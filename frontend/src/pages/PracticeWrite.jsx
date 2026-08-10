import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Lightning, PenNib, Sparkle, BookOpen, ArrowRight,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, BACKEND_URL } from '../lib/api';
import { WRITING_TASKS, wordStatus } from '../lib/tcf';
import { useAuth } from '../context/AuthContext';
import { AnalysisProgress, BackLink, CreditsBadge, WordCountBar, streamAnalysis } from '../components/shared';
import { useT } from '../i18n';

export default function PracticeWrite() {
  const { user, refreshUser } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // No ?tache= in the URL means Tâche 1, the default writing task.
  const tacheNum = parseInt(searchParams.get('tache'), 10) || 1;
  const themeId = searchParams.get('theme');
  // Free writing has no official length; a tâche does.
  const taskType = WRITING_TASKS[tacheNum] ? tacheNum : null;

  const [prompts, setPrompts] = useState([]);
  const [activePrompt, setActivePrompt] = useState(null);
  // The chosen theme's topics for this tâche. They replace the generic test
  // list in the sidebar, so the learner can work through all of them instead
  // of being handed a single one.
  const [topics, setTopics] = useState([]);
  const [activeTopicId, setActiveTopicId] = useState(null);
  const [ownQuestion, setOwnQuestion] = useState('');
  const [text, setText] = useState('');
  const [stage, setStage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef(null);

  // Carried in from the landing simulator or the own-question panel.
  const { state: navState } = useLocation();
  const autoStartedRef = useRef(false);
  const defaultedRef = useRef(false);

  useEffect(() => {
    api.get('/api/prompts').then(({ data }) => setPrompts(data.prompts)).catch(() => {});
  }, []);

  // Open on Test 1 so the page always shows a question, unless the learner
  // brought their own topic (landing simulator, own-question panel, a theme).
  useEffect(() => {
    if (defaultedRef.current || !prompts.length) return;
    if (themeId || navState?.ownQuestion || navState?.text) return;
    defaultedRef.current = true;
    setActivePrompt(prompts[0]);
  }, [prompts, themeId, navState]);

  // Load every topic of the chosen theme + tâche, and open on the first one.
  // It used to pick one at random and drop the other nineteen, which left no
  // way to reach them short of reloading the page.
  useEffect(() => {
    if (!themeId || !tacheNum) return;
    let cancelled = false;
    api.get(`/api/themes/${themeId}/questions?task_type=${tacheNum}`)
      .then(({ data }) => {
        if (cancelled) return;
        const qs = data.questions || [];
        setTopics(qs);
        if (!qs.length) return;
        // Don't clobber a topic carried in from the simulator or own-question
        // panel — that is the learner's own text, not a default.
        if (navState?.ownQuestion || navState?.text) return;
        setActivePrompt(null);
        setActiveTopicId(qs[0].question_id);
        setOwnQuestion(qs[0].prompt_text);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // navState is read only to skip the default; it must not retrigger a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, tacheNum]);

  const freeMode = activePrompt === null;

  const selectPrompt = (p) => {
    if (!user) return navigate('/login');
    setActivePrompt(p || null);
    setTimeout(() => taRef.current?.focus(), 50);
  };

  // A theme topic rides the same path as a hand-typed question: no prompt_id,
  // the text goes out as the topic. Grading is unchanged.
  const selectTopic = (q) => {
    if (!user) return navigate('/login');
    setActivePrompt(null);
    setActiveTopicId(q.question_id);
    setOwnQuestion(q.prompt_text);
    setTimeout(() => taRef.current?.focus(), 50);
  };

  const submit = async () => {
    if (!user) return navigate('/login');
    if (!text.trim()) return toast.error(t('write.writeFirst'));
    if (submitting) return;
    // The official range is enforced by the grader; warn before spending a
    // credit on a text the real exam would penalise anyway.
    const status = wordStatus(text, taskType);
    if (status.capped && !window.confirm(
      `${t(status.key, status.vars)}. ${t('write.capConfirm')}`)) {
      return;
    }
    const topic = freeMode ? (ownQuestion.trim() || null) : (activePrompt?.title || null);
    setSubmitting(true);
    setStage('parsing');
    await streamAnalysis(BACKEND_URL, {
      text,
      prompt_id: activePrompt?.prompt_id || null,
      topic,
      task_type: taskType,
      source: 'practice',
    }, {
      t,
      onStage: setStage,
      onComplete: async (sub) => {
        await refreshUser();
        toast.success(t('write.doneToast', { level: sub.tcf_level }));
        navigate(`/feedback/${sub.submission_id}`);
      },
      onError: (detail, httpStatus) => {
        setStage(null);
        setSubmitting(false);
        toast.error(detail);
        if (httpStatus === 402) navigate('/pricing');
      },
    });
  };

  // Prefill the question and answer when arriving from the landing simulator
  // or the own-question panel on the task overview.
  useEffect(() => {
    if (!navState) return;
    if (navState.ownQuestion) setOwnQuestion(navState.ownQuestion);
    if (navState.text) setText(navState.text);
  }, [navState]);

  // ...and analyse straight away when they already wrote their answer there,
  // so "Start Simulator" is one click to the result rather than two.
  useEffect(() => {
    if (!navState?.autostart || autoStartedRef.current) return;
    if (!user || !text.trim()) return;
    autoStartedRef.current = true;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navState, user, text]);

  if (stage) return <main className="px-4 py-16"><AnalysisProgress current={stage} /></main>;

  // What the learner is writing about: their own topic, or the selected test's consigne.
  const question = freeMode ? ownQuestion.trim() : (activePrompt?.description || '');
  const activeTopicIndex = topics.findIndex((q) => q.question_id === activeTopicId);

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <BackLink className="!mb-6" testid="back-to-tasks"
          fallback={themeId ? `/practice/themes?tache=${tacheNum}` : '/practice/tasks'} />

        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* LEFT: the theme's topics, or the generic test list off-theme */}
          <aside className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-soft">
            <p className="flex items-center gap-2 font-heading text-sm font-bold text-gray-900">
              <BookOpen size={18} weight="duotone" className="text-primary" />
              {themeId ? t('write.topicsList') : t('write.testsList')}
              {themeId && topics.length > 0 && (
                <span className="ml-auto rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold text-primary">
                  {t('write.topicsCount', { n: topics.length })}
                </span>
              )}
            </p>

            {themeId ? (
              /* Twenty topics do not fit on screen, so the list scrolls inside
                 the card rather than stretching the page past the editor. */
              <div className="mt-4 max-h-[560px] space-y-2.5 overflow-y-auto pr-1">
                {topics.map((q, i) => {
                  const active = activeTopicId === q.question_id;
                  return (
                    <button
                      key={q.question_id}
                      onClick={() => selectTopic(q)}
                      data-testid={`topic-${q.question_id}`}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
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
                        <span className="block font-heading text-sm font-bold text-gray-900">
                          {t('write.topicN', { n: i + 1 })}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-gray-500">
                          {q.prompt_text}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
            <div className="mt-4 space-y-2.5">
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
                      <span className="block font-heading text-sm font-bold text-gray-900">{t('write.testN', { n: i + 1 })}</span>
                      <span className="block text-xs capitalize text-gray-500">{p.category} · {p.level}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            )}
          </aside>

          {/* RIGHT: writing panel */}
          <div className="rounded-3xl border border-violet-100 bg-white p-5 shadow-xl shadow-violet-200/40 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              {taskType ? (
                <p className="text-sm font-bold text-gray-900">
                  {WRITING_TASKS[taskType].name}
                  <span className="ml-2 font-normal text-gray-500">
                    {t('write.taskMeta', { min: WRITING_TASKS[taskType].minWords, max: WRITING_TASKS[taskType].maxWords, minutes: WRITING_TASKS[taskType].minutes })}
                  </span>
                </p>
              ) : <span />}
              <CreditsBadge />
            </div>

            {question && (
              <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50/40 p-4" data-testid="question-display">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                  {!freeMode ? activePrompt.title
                    : activeTopicIndex >= 0 ? t('write.topicN', { n: activeTopicIndex + 1 })
                    : t('write.yourQuestion')}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-800">{question}</p>
              </div>
            )}

            <div>
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onDrop={(e) => e.preventDefault()}
                lang="fr"
                className="input paper-textarea min-h-[340px] p-6 shadow-card"
                placeholder={t('write.placeholder')}
                data-testid="writing-textarea"
              />
            </div>

            <WordCountBar text={text} taskType={taskType} className="mt-4" />

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                className="btn-outline"
                /* Inside a theme, Clear wipes the draft but keeps the selected
                   topic — clearing it too would leave the page with nothing to
                   write about. */
                onClick={() => {
                  setText('');
                  setActivePrompt(null);
                  if (!themeId) setOwnQuestion('');
                }}
              >
                {t('write.clear')}
              </button>
              <button
                className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600"
                onClick={submit}
                disabled={submitting}
                data-testid="submit-text-button"
              >
                <Lightning size={18} weight="fill" /> {t('write.analyse')}
              </button>
            </div>
          </div>
        </div>

        {/* RECENT TOPICS (placeholder) */}
        <div className="mt-12">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-heading text-xl font-extrabold text-gray-900">
              <Sparkle size={20} weight="fill" className="text-primary" /> {t('write.recentTopics')}
            </h2>
            <Link to="/combinations" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="recent-see-all">
              {t('write.seeAll')} <ArrowRight size={15} weight="bold" />
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
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> {t('write.available')}
                    </span>
                  </div>
                  <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t('write.combination', { n })}</h3>
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