import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LockSimple, Eye, Lightning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, BACKEND_URL } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AccentToolbar, AnalysisProgress, BackLink, streamAnalysis, useConfirm } from '../components/shared';
import { useT } from '../i18n';
import { Seo, useSeo } from '../lib/seo';

const TASK_LABELS = { 1: 'topics.task1', 2: 'topics.task2', 3: 'topics.task3' };

export default function RecentTopics() {
  const t = useT();
  const [topics, setTopics] = useState([]);
  const [task, setTask] = useState(0);
  const [month, setMonth] = useState('');

  useEffect(() => {
    api.get('/api/recent-topics', { params: task ? { task_type: task } : {} })
      .then(({ data }) => setTopics(data.topics)).catch(() => {});
  }, [task]);

  const months = [...new Set(topics.map((topic) => topic.month_label).filter(Boolean))];
  const shown = topics.filter((topic) => !month || topic.month_label === month);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Seo titleKey="seo.topics.title" descKey="seo.topics.desc" path="/recent-topics" />
      <BackLink />
      <h1 className="text-3xl font-bold">{t('topics.title')}</h1>
      <p className="mt-2 max-w-2xl text-gray-600">{t('topics.subtitle')}</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} onClick={() => setTask(n)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${task === n ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              data-testid={`filter-task-${n}`}>
              {n === 0 ? t('topics.allTasks') : `Tâche ${n}`}
            </button>
          ))}
        </div>
        {months.length > 0 && (
          <select className="input !w-auto !py-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="month-filter">
            <option value="">{t('topics.allMonths')}</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((topic) => (
          <Link key={topic.topic_id} to={`/recent-topics/${topic.topic_id}`} className="card card-hover flex flex-col p-6" data-testid={`topic-${topic.topic_id}`}>
            <div className="flex flex-wrap gap-2">
              <span className="pill bg-violet-50 text-primary">{TASK_LABELS[topic.task_type] ? t(TASK_LABELS[topic.task_type]) : `Tâche ${topic.task_type}`}</span>
              {topic.month_label && <span className="pill bg-gray-100 text-gray-600">{topic.month_label}</span>}
              <span className="pill bg-green-50 text-green-700">{topic.target_level}</span>
            </div>
            <h3 className="mt-3 font-heading text-lg font-semibold">{topic.title}</h3>
            <p className="mt-2 flex-1 text-sm text-gray-600">{(topic.topic_text || '').slice(0, 140)}…</p>
            <span className="mt-4 text-sm font-semibold text-primary">{t('topics.seeTopic')}</span>
          </Link>
        ))}
        {!shown.length && <p className="col-span-full py-10 text-center text-gray-400">{t('topics.empty')}</p>}
      </div>
    </main>
  );
}

export function RecentTopicDetail() {
  const t = useT();
  const [confirm, confirmDialog] = useConfirm();
  const { topicId } = useParams();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState(null);
  const [error, setError] = useState('');
  /* useSeo, not <Seo>, because every branch below returns early — signed out,
     errored, still loading — and an element form would only have rendered on
     the success path. This page had no metadata at all: no title of its own and
     no canonical, so it inherited whatever the previously visited route left in
     the head. It is also noindex: the model answer is the product, and the page
     needs an account to show anything, so it has no business in an index. */
  useSeo({ titleKey: 'seo.topics.title', descKey: 'seo.topics.desc',
           path: `/recent-topics/${topicId}`, noindex: true });
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [stage, setStage] = useState(null);
  const [showModel, setShowModel] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [lastSubmission, setLastSubmission] = useState(null);
  const taRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    api.get(`/api/recent-topics/${topicId}`)
      .then(({ data }) => setTopic(data.topic))
      .catch((e) => setError(errMsg(e)));
  }, [topicId, user]);

  if (!user) {
    return (
      <main className="px-4 py-20 text-center">
        <p className="text-gray-600">{t('topics.loginPrompt')}</p>
        <Link to="/login" className="btn-primary mt-4 inline-flex">{t('auth.loginButton')}</Link>
      </main>
    );
  }
  if (error) return <main className="px-4 py-20 text-center text-gray-600">{error}</main>;
  if (!topic) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  const submit = async () => {
    if (!text.trim()) return toast.error(t('topics.writeFirst'));
    // The progress dialog now sits over the form rather than replacing it,
    // so the button behind it still exists and can be reached from the
    // keyboard. A second submit would spend a second credit.
    if (stage) return;
    setStage('parsing');
    await streamAnalysis(BACKEND_URL, { text, source: 'practice', label: topic.title }, {
      t,
      onStage: setStage,
      onComplete: async (sub) => {
        await refreshUser();
        setStage(null); setWriting(false); setAttempted(true); setLastSubmission(sub);
        toast.success(t('topics.analysedToast', { level: sub.tcf_level }));
      },
      onError: (detail, status) => {
        setStage(null); toast.error(detail);
        // 402 opens the paywall in place; nothing to do here.
      },
    });
  };

  const remaining = topic.model_answers_remaining;
  const hasRemaining = remaining !== null && remaining !== undefined;
  const modelVisible = Boolean(topic.model_answer) && (attempted || showModel);

  /* Opening this page used to spend one of the three free unlocks silently,
     so browsing three topics burned the whole allowance. It is now deliberate. */
  const revealModel = async () => {
    if (topic.model_answer) { setShowModel(true); return; }
    if (hasRemaining && remaining <= 0) {
      return navigate('/pricing');
    }
    if (hasRemaining && !(await confirm(t('topics.confirmReveal', { n: remaining })))) {
      return;
    }
    try {
      const { data } = await api.post(`/api/recent-topics/${topicId}/reveal`);
      setTopic((prev) => ({ ...prev, model_answer: data.model_answer,
                            model_answer_locked: false,
                            model_answers_remaining: data.model_answers_remaining }));
      setShowModel(true);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 402) { /* the paywall took it */ }
      else toast.error(errMsg(e, t('topics.revealFailed')));
    }
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {stage && <AnalysisProgress current={stage} />}
      {confirmDialog}
      <BackLink to="/recent-topics" label={t('topics.allTopics')} />
      <div className="flex flex-wrap gap-2">
        <span className="pill bg-violet-50 text-primary">{TASK_LABELS[topic.task_type] ? t(TASK_LABELS[topic.task_type]) : `Tâche ${topic.task_type}`}</span>
        {topic.month_label && <span className="pill bg-gray-100 text-gray-600">{topic.month_label}</span>}
        <span className="pill bg-green-50 text-green-700">{t('topics.targetLevel', { level: topic.target_level })}</span>
      </div>
      <h1 className="mt-3 text-3xl font-bold">{topic.title}</h1>

      <section className="card mt-6 p-6">
        <h2 className="font-heading font-semibold">{t('topics.consigne')}</h2>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed text-gray-700">{topic.topic_text}</p>
      </section>

      {writing ? (
        <section className="mt-6">
          <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setText(next)} />
          <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} lang="fr"
            className="input paper-textarea mt-3 p-6 shadow-card" placeholder={t('topics.answerPlaceholder')} data-testid="topic-textarea" />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">{t('topics.words', { n: wordCount })}</span>
            <div className="flex gap-3">
              <button className="btn-outline" onClick={() => setWriting(false)}>{t('topics.cancel')}</button>
              <button className="btn-primary" onClick={submit} data-testid="submit-topic-button"><Lightning size={18} weight="fill" /> {t('topics.analyse')}</button>
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => setWriting(true)} data-testid="write-answer-button">{t('topics.writeAnswer')}</button>
          {lastSubmission && (
            <Link to={`/feedback/${lastSubmission.submission_id}`} className="btn-outline">{t('topics.viewFeedback')}</Link>
          )}
          {!attempted && (
            showModel ? (
              <button className="btn-outline" onClick={() => setShowModel(false)} data-testid="show-model-toggle">
                <Eye size={18} /> {t('topics.hideModel')}
              </button>
            ) : (
              <button className="btn-outline" onClick={revealModel} data-testid="show-model-toggle">
                <Eye size={18} /> {t('topics.showModel')}
                {hasRemaining && (
                  <span className="ml-1 text-xs text-gray-500">
                    {remaining === 1 ? t('topics.remainingFreeOne') : t('topics.remainingFreeMany', { n: remaining })}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}

      {topic.model_answer_locked && !topic.model_answer && showModel ? (
        <section className="card mt-6 border-amber-200 bg-amber-50/60 p-8 text-center">
          <LockSimple size={28} className="mx-auto text-amber-500" />
          <h2 className="mt-2 font-heading font-semibold">{t('topics.lockedTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('topics.lockedBody')}</p>
          <Link to="/pricing" className="btn-primary mt-4 inline-flex">{t('topics.seePlans')}</Link>
        </section>
      ) : modelVisible ? (
        <section className="card mt-6 border-green-200 p-6" data-testid="model-answer">
          <h2 className="font-heading font-semibold text-green-700">{t('topics.modelAnswer', { level: topic.target_level })}</h2>
          <p className="mt-3 whitespace-pre-wrap leading-relaxed text-gray-800">{topic.model_answer}</p>
        </section>
      ) : (
        <p className="mt-6 text-sm text-gray-500">{t('topics.hint')}</p>
      )}
    </main>
  );
}
