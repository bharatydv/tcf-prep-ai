import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, Headphones } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, useT } from '../i18n';
import { Seo } from '../lib/seo';
import { ComingSoon } from '../components/shared';
import AttemptHistory, { useAttempts } from '../components/AttemptHistory';
import { trackPracticeStart, trackPracticeComplete } from '../lib/analytics';

// Mock exams are not open yet. Module scope, so the fetch effect below does
// not take it as a dependency. Flip to false to restore the page.
const NOT_READY = true;

/* The two mock papers, as a skill name the rest of the funnel already uses.
   Keeps 'reading' meaning reading whether it came from a mock, a test or
   untimed practice, instead of splitting one skill across three spellings. */
const SKILL = {
  'reading-comprehension': 'reading',
  'oral-comprehension': 'listening',
};

const TYPES = {
  'reading-comprehension': { label: 'mock.reading', icon: BookOpen },
  'oral-comprehension': { label: 'mock.listening', icon: Headphones },
};

export default function MockExam() {
  const t = useT();
  const { examType } = useParams();
  const { user } = useAuth();
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  // Grading happens on the server; `result` holds what it returned.
  const [result, setResult] = useState(null);
  const [grading, setGrading] = useState(false);
  // The sitting being re-read, when the paper on screen is a past one.
  const [pastAttempt, setPastAttempt] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const meta = TYPES[examType];
  const done = result !== null;

  /* Past sittings of this paper. Gated on NOT_READY with everything else: a
     disabled page should not be fetching a history it cannot show. */
  const { attempts, reload: reloadAttempts } = useAttempts(
    `/api/exam/attempts?exam_type=${examType}`,
    { enabled: !NOT_READY && Boolean(user) });

  useEffect(() => {
    if (NOT_READY) return;
    setQuestions(null); setAnswers({}); setResult(null); setPastAttempt(null);
    api.get(`/api/exam/questions/${examType}`)
      .then(({ data }) => {
        setQuestions(data.questions);
        /* The paper is open. On the resolved promise rather than on mount, so
           a paper the server could not produce is not counted as a sitting
           anybody began. */
        trackPracticeStart({
          skill: SKILL[examType] || 'reading',
          exam: 'tcf',
          exam_type: 'mock',
          paper: examType,
          questions: (data.questions || []).length,
        });
      })
      .catch(() => setQuestions([]));
  }, [examType]);

  const finish = async () => {
    if (!user) return toast.error(t('mock.loginToSave'));
    setGrading(true);
    try {
      const { data } = await api.post('/api/exam/submit', {
        exam_type: examType, answers, time_used_seconds: 0,
      });
      setResult(data);
      /* Graded. Inside the try: the catch below leaves the paper unmarked and
         open, which is not a completion. A score and a total, nothing else. */
      trackPracticeComplete({
        skill: SKILL[examType] || 'reading',
        exam: 'tcf',
        exam_type: 'mock',
        paper: examType,
        score: data.score,
        total: data.total,
      });
      reloadAttempts();   // the paper just handed in belongs in the history
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast.error(errMsg(e, t('mock.gradeFailed')));
    } finally {
      setGrading(false);
    }
  };

  /* Re-open a marked paper: the answer sheet back in `answers` and the key
     back in `result`, which is all the marking below reads. */
  const openAttempt = async (row) => {
    setOpeningId(row.id);
    try {
      const { data } = await api.get(`/api/exam/attempts/${row.id}`);
      setAnswers(data.attempt?.answers || {});
      setResult({ score: data.attempt?.score, total: data.attempt?.total,
                  corrections: data.corrections || {} });
      setPastAttempt(row);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast.error(errMsg(e, t('mock.gradeFailed')));
    } finally {
      setOpeningId(null);
    }
  };

  const restart = () => { setAnswers({}); setResult(null); setPastAttempt(null); };

  /* The map variable used to be named `t`, shadowing the translator. */
  const typeTabs = Object.entries(TYPES).map(([key, type]) => ({ key, ...type }));

  if (!meta) {
    return (
      <main className="px-4 py-20 text-center">
        <Seo titleKey="seo.mock.title" noindex />
        <p className="text-gray-600">{t('mock.unknownType')}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {typeTabs.map(({ key, icon: Icon, label }) => (
            <Link key={key} to={`/exam/${key}`} className="btn-outline">
              <Icon size={16} /> {t(label)}
            </Link>
          ))}
        </div>
      </main>
    );
  }
  /* BEFORE the loading guard, not after.
   *
   * The fetch effect returns early while NOT_READY, so `questions` stays null
   * forever — and the guard below caught that first and rendered a spinner that
   * could never resolve. This branch was unreachable, so every visitor to
   * /exam/* got an infinite spinner instead of the explanation written for
   * them, on a page linked from the header nav, the footer, a landing card and
   * both Listening buttons. */
  if (NOT_READY) {
    return <ComingSoon icon={<Headphones size={30} weight="fill" />}
      title={t('mock.soonTitle')} body={t('mock.soonBody')} />;
  }

  if (!questions) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap gap-2">
        {typeTabs.map(({ key, icon: Icon, label }) => (
          <Link key={key} to={`/exam/${key}`}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${key === examType ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <Icon size={16} /> {t(label)}
          </Link>
        ))}
      </div>
      <h1 className="mt-6 text-3xl font-bold">{t(meta.label)}</h1>
      {examType === 'oral-comprehension' && <p className="mt-1 text-sm text-gray-500">{t('mock.transcriptNote')}</p>}

      {done && (
        <div className="card mt-6 border-l-4 border-l-primary p-6" data-testid="exam-score">
          <p className="font-heading text-2xl font-bold">{t('mock.score', { score: result.score, total: result.total })}</p>
          <p className="text-sm text-gray-600">{t('mock.answersInGreen')}</p>
          {pastAttempt && (
            <p className="mt-2 text-xs font-semibold text-primary" data-testid="mock-past-banner">
              {t('hist.reviewing', { when: formatDateTime(pastAttempt.created_at) })}
            </p>
          )}
        </div>
      )}

      <AttemptHistory
        className="mt-6"
        testid="mock-history"
        attempts={attempts.map((a) => ({
          id: a.mock_attempt_id,
          label: `${a.score}/${a.total}`,
          score: a.score, total: a.total,
          created_at: a.created_at,
        }))}
        opening={openingId}
        busy={grading}
        onOpen={openAttempt}
        onRetake={done ? restart : null} />

      <div className="mt-6 space-y-6">
        {questions.map((q, i) => (
          <section key={q.question_id} className="card p-6" data-testid={`question-${i}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('mock.question', { n: i + 1 })}</p>
            <p className="mt-2 rounded-xl bg-gray-50 p-4 text-sm italic leading-relaxed text-gray-700">{q.text}</p>
            <p className="mt-3 font-medium">{q.question}</p>
            <div className="mt-3 space-y-2">
              {q.options.map((o) => {
                const picked = answers[q.question_id] === o.id;
                const correctId = result?.corrections?.[q.question_id]?.correct_answer;
                const showState = done && (o.id === correctId ? '!border-green-500 bg-green-50' : picked ? '!border-red-400 bg-red-50' : '');
                return (
                  <button key={o.id} disabled={done}
                    onClick={() => setAnswers({ ...answers, [q.question_id]: o.id })}
                    className={`block w-full rounded-xl border-2 px-4 py-2.5 text-left text-sm transition ${picked && !done ? 'border-primary bg-violet-50' : 'border-gray-200 hover:border-primary'} ${showState || ''}`}>
                    <strong className="mr-2 uppercase">{o.id}.</strong>{o.text}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!questions.length && <p className="py-10 text-center text-gray-400">{t('mock.empty')}</p>}
      </div>

      {questions.length > 0 && !done && (
        <button className="btn-primary mt-8 w-full" onClick={finish}
          disabled={grading || Object.keys(answers).length < questions.length} data-testid="finish-exam-button">
          {grading ? t('mock.grading') : t('mock.grade', { done: Object.keys(answers).length, total: questions.length })}
        </button>
      )}
      {done && <button className="btn-outline mt-4 w-full" onClick={restart}>{t('mock.restart')}</button>}
    </main>
  );
}
