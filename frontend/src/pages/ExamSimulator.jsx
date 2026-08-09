import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Timer, WarningCircle, SignOut } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { WRITING_TASKS, WRITING_TOTAL_SECONDS } from '../lib/tcf';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { AccentToolbar, BackLink, ErrorHighlightedText, WordCountBar } from '../components/shared';

const GUIDE = {
  1: { name: WRITING_TASKS[1].name, min: WRITING_TASKS[1].minWords, max: WRITING_TASKS[1].maxWords },
  2: { name: WRITING_TASKS[2].name, min: WRITING_TASKS[2].minWords, max: WRITING_TASKS[2].maxWords },
  3: { name: WRITING_TASKS[3].name, min: WRITING_TASKS[3].minWords, max: WRITING_TASKS[3].maxWords },
};
const TOTAL = WRITING_TOTAL_SECONDS;
// A refresh or a crash used to lose all three texts and restart the clock.
const DRAFT_KEY = 'monfrancais.simulator.draft';

export default function ExamSimulator() {
  const { refreshUser } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | exam | submitting | results
  const [current, setCurrent] = useState(1);
  const [texts, setTexts] = useState({ 1: '', 2: '', 3: '' });
  const [seconds, setSeconds] = useState(TOTAL);
  const [attempt, setAttempt] = useState(null);
  const taRef = useRef(null);
  const warned = useRef({ 10: false, 2: false });
  const restoredRef = useRef(false);

  useEffect(() => {
    api.get('/api/simulator/start').then(({ data }) => setTasks(data)).catch((e) => toast.error(errMsg(e)));
  }, []);

  // Restore an interrupted attempt. The remaining time is recomputed from the
  // stored deadline, so pausing by reloading buys the candidate nothing.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!saved?.endsAt) return;
      const left = Math.round((saved.endsAt - Date.now()) / 1000);
      if (left <= 0) { localStorage.removeItem(DRAFT_KEY); return; }
      setTexts(saved.texts || { 1: '', 2: '', 3: '' });
      setCurrent(saved.current || 1);
      setSeconds(left);
      setPhase('exam');
      toast.info(t('sim.resumed'));
    } catch { /* corrupt draft — start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'exam') return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      texts, current, endsAt: Date.now() + seconds * 1000,
    }));
  }, [phase, texts, current, seconds]);

  const submit = useCallback(async (timeUsed) => {
    setPhase('submitting');
    try {
      const { data } = await api.post('/api/simulator/submit', {
        task1: { prompt: tasks.task1?.text || '', text: texts[1] },
        task2: { prompt: tasks.task2?.text || '', text: texts[2] },
        task3: { prompt: tasks.task3?.text || '', text: texts[3] },
        time_used_seconds: timeUsed,
      });
      setAttempt(data.attempt);
      setPhase('results');
      localStorage.removeItem(DRAFT_KEY);
      await refreshUser();
    } catch (e) {
      toast.error(errMsg(e));
      setPhase('exam');
    }
  }, [tasks, texts, refreshUser]);

  useEffect(() => {
    if (phase !== 'exam') return;
    const id = setInterval(() => {
      setSeconds((s) => {
        const next = s - 1;
        if (next === 600 && !warned.current[10]) { warned.current[10] = true; toast.warning(t('sim.warn10')); }
        if (next === 120 && !warned.current[2]) { warned.current[2] = true; toast.warning(t('sim.warn2')); }
        if (next <= 0) { clearInterval(id); toast.info(t('sim.timeUp')); submit(TOTAL); return 0; }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, submit]);

  /* The draft is restored on reload, but warn anyway: an accidental close in
     the middle of a timed exam is still disruptive. */
  useEffect(() => {
    if (phase !== 'exam') return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  /* Abandons the attempt without submitting — no credit is spent. */
  const quitExam = () => {
    if (!window.confirm(t('sim.quitConfirm'))) return;
    setPhase('intro');
    setSeconds(TOTAL);
    setTexts({ 1: '', 2: '', 3: '' });
    setCurrent(1);
    warned.current = { 10: false, 2: false };
    localStorage.removeItem(DRAFT_KEY);
    navigate('/practice');
  };

  if (!tasks) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  if (phase === 'intro') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <BackLink />
        <h1 className="text-3xl font-bold">{t('sim.title')}</h1>
        <div className="card mt-6 space-y-4 p-8">
          <p className="text-gray-700">{t('sim.conditions')}</p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>⏱️ <strong>{t('sim.rule1Bold')}</strong> {t('sim.rule1')}</li>
            <li>📝 {t('sim.rule2')}</li>
            <li>🚫 {t('sim.rule3')}</li>
            <li>💳 {t('sim.rule4')}</li>
          </ul>
          <button className="btn-primary w-full" onClick={() => setPhase('exam')} data-testid="start-simulator-button">
            {t('sim.start')}
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'submitting') {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
        <p className="text-gray-600">{t('sim.grading')}</p>
      </main>
    );
  }

  if (phase === 'results' && attempt) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t('sim.resultsTitle')}</h1>
        <div className="card mt-6 flex flex-wrap items-center justify-around gap-6 p-8 text-center">
          <div><p className="text-sm text-gray-500">{t('sim.combined')}</p><p className="font-heading text-5xl font-bold text-primary">{attempt.combined_score}</p></div>
          <div><p className="text-sm text-gray-500">{t('sim.cefr')}</p><p className="font-heading text-5xl font-bold">{attempt.tcf_level}</p></div>
          <div><p className="text-sm text-gray-500">{t('sim.timeUsed')}</p><p className="font-heading text-3xl font-bold">{t('sim.minutes', { n: Math.floor(attempt.time_used_seconds / 60) })}</p></div>
        </div>
        {[1, 2, 3].map((i) => {
          const task = attempt[`task${i}`];
          if (!task) return null;
          return (
            <section key={i} className="card mt-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-heading text-xl font-semibold">{GUIDE[i].name}</h2>
                <span className="pill bg-violet-50 text-primary">{t('sim.scorePill', { score: task.analysis.overall_score, level: task.analysis.tcf_level })}</span>
              </div>
              <p className="mt-1 text-sm italic text-gray-500">{task.prompt}</p>
              <div className="mt-4 rounded-xl bg-gray-50 p-5">
                <ErrorHighlightedText text={task.text || t('sim.empty')} errors={task.analysis.errors} />
              </div>
            </section>
          );
        })}
        <section className="card mt-6 p-6">
          <h2 className="font-heading text-xl font-semibold">{t('sim.allErrors')}</h2>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const errs = [1, 2, 3].flatMap((i) => (attempt[`task${i}`]?.analysis.errors || []).filter((e) => e.category === key));
            if (!errs.length) return null;
            return (
              <div key={key} className="mt-5">
                <span className="pill" style={{ background: meta.color }}>{meta.label} · {errs.length}</span>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {errs.map((e, j) => (
                      <tr key={j} className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-3 text-red-600">{e.error}</td>
                        <td className="py-2 pr-3 font-medium text-green-700">{e.correction}</td>
                        <td className="py-2 text-gray-600">{e.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/review" className="btn-primary">{t('sim.reviewErrors')}</Link>
          <Link to="/dashboard" className="btn-outline">{t('common.dashboard')}</Link>
          <Link to="/practice" className="btn-outline">{t('sim.backToPractice')}</Link>
        </div>
      </main>
    );
  }

  /* ------ exam phase: distraction-free full screen ------ */
  const task = tasks[`task${current}`];
  const g = GUIDE[current];
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const low = seconds <= 120;

  return (
    <main className="fixed inset-0 z-40 overflow-y-auto bg-white">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <button onClick={quitExam} data-testid="quit-exam"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-400 hover:text-red-600 hover:underline">
          <SignOut size={16} /> {t('sim.quit')}
        </button>
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <button key={i} onClick={() => setCurrent(i)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${current === i ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                data-testid={`task-tab-${i}`}>
                {t('sim.taskTab', { n: i })}
              </button>
            ))}
          </div>
          <span className={`pill text-base ${low ? 'bg-red-50 text-red-600' : 'bg-violet-50 text-primary'}`} data-testid="exam-timer">
            <Timer size={18} weight="fill" /> {mm}:{ss}
          </span>
        </div>

        <div className="card mt-5 p-5">
          <h2 className="font-heading font-semibold">{g.name}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{task?.text || t('sim.noConsigne')}</p>
        </div>

        <div className="mt-4">
          <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setTexts({ ...texts, [current]: next })} />
        </div>
        <textarea key={current} ref={taRef} value={texts[current]} lang="fr" spellCheck="false"
          onChange={(e) => setTexts({ ...texts, [current]: e.target.value })}
          onPaste={(e) => { e.preventDefault(); toast.error(t('sim.noPaste')); }}
          className="input paper-textarea mt-3 p-6"
          placeholder={t('sim.writePlaceholder', { min: g.min, max: g.max })} data-testid={`task-textarea-${current}`} />

        <WordCountBar text={texts[current]} taskType={current} className="mt-3" />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <WarningCircle size={14} />
            {t('sim.sharedTime')}
          </span>
          {current < 3 ? (
            <button className="btn-primary" onClick={() => setCurrent(current + 1)}>{t('sim.nextTask')}</button>
          ) : (
            <button className="btn-primary" onClick={() => submit(TOTAL - seconds)} data-testid="submit-exam-button">
              {t('sim.finish')}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
