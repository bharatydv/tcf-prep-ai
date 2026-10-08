import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Timer, WarningCircle, SignOut, PenNib } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { WRITING_TASKS, WRITING_TOTAL_SECONDS, displayMark, nclcFromMark } from '../lib/tcf';
import { monthLabel } from '../lib/speakingExam';
import ExamSetRow from '../components/ExamSetRow';
import CorrectionsTable from '../components/CorrectionsTable';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, useT } from '../i18n';
import { Seo } from '../lib/seo';
import AttemptHistory, { useAttempts } from '../components/AttemptHistory';
import { AccentToolbar, BackLink, ErrorHighlightedText, WordCountBar, useConfirm } from '../components/shared';
import { trackPracticeStart, trackPracticeComplete } from '../lib/analytics';

const GUIDE = {
  1: { name: WRITING_TASKS[1].name, min: WRITING_TASKS[1].minWords, max: WRITING_TASKS[1].maxWords },
  2: { name: WRITING_TASKS[2].name, min: WRITING_TASKS[2].minWords, max: WRITING_TASKS[2].maxWords },
  3: { name: WRITING_TASKS[3].name, min: WRITING_TASKS[3].minWords, max: WRITING_TASKS[3].maxWords },
};
const TOTAL = WRITING_TOTAL_SECONDS;
// A refresh or a crash used to lose all three texts and restart the clock.
const DRAFT_KEY = 'prepfrancais.simulator.draft';

export default function ExamSimulator() {
  const { refreshUser, user } = useAuth();
  const t = useT();
  const [confirm, confirmDialog] = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState(null);
  const [sets, setSets] = useState([]);
  const [setNumber, setSetNumber] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | exam | submitting | results
  const [current, setCurrent] = useState(1);
  const [texts, setTexts] = useState({ 1: '', 2: '', 3: '' });
  const [seconds, setSeconds] = useState(TOTAL);
  const [attempt, setAttempt] = useState(null);
  // The sitting being re-read, when `attempt` is a past one rather than the
  // paper just handed in.
  const [pastAttempt, setPastAttempt] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const taRef = useRef(null);
  const warned = useRef({ 10: false, 2: false, expired: false });
  const restoredRef = useRef(false);
  // Wall-clock deadline for the sitting, so a throttled or suspended tab loses
  // resolution but never loses time. See lib/clock.js for the reasoning.
  const deadlineRef = useRef(null);
  // Read inside the timer effect without making `seconds` one of its
  // dependencies, which would restart the interval on every tick.
  const secondsRef = useRef(TOTAL);

  // A numbered set is a fixed paper: the same three tâches every time, so two
  // attempts at set 7 can be compared. Without one the endpoint still draws at
  // random, which is what the old simulator did.
  useEffect(() => {
    if (!setNumber) return;
    api.get(`/api/simulator/start?set_number=${setNumber}`)
      .then(({ data }) => setTasks(data)).catch((e) => toast.error(errMsg(e)));
  }, [setNumber]);

  useEffect(() => {
    api.get('/api/simulator/sets').then(({ data }) => setSets(data.sets || [])).catch(() => setSets([]));
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
      // A draft with no set number cannot be resumed: the paper is fetched by
      // set, so restoring straight into 'exam' left the timer running over a
      // null `tasks` while the render showed the set chooser — and when the
      // hour expired, the auto-submit dereferenced it and the page died
      // silently inside setInterval. Drafts written before numbered sets
      // existed all look like this.
      if (!saved.setNumber) { localStorage.removeItem(DRAFT_KEY); return; }
      setTexts(saved.texts || { 1: '', 2: '', 3: '' });
      setCurrent(saved.current || 1);
      setSetNumber(saved.setNumber);
      setSeconds(left);
      setPhase('exam');
      toast.info(t('sim.resumed'));
    } catch { /* corrupt draft — start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The sitting's deadline, anchored once when the exam starts — from the full
     hour on a fresh run, or from the restored remainder after a reload. It is
     set here rather than inside the timer effect so that everything below can
     rely on it existing for the whole of the exam phase. */
  useEffect(() => {
    if (phase !== 'exam') { deadlineRef.current = null; return; }
    if (deadlineRef.current == null) {
      deadlineRef.current = Date.now() + seconds * 1000;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* Saved on change, not on every tick.
   *
   * `seconds` used to be a dependency here, so the effect re-ran once a second
   * and serialised all three texts about 3,600 times per sitting — synchronous
   * main-thread writes, which on a modest phone is typing latency in the one
   * screen where it matters. The deadline is absolute, so nothing about it
   * needs re-saving as the clock moves. */
  useEffect(() => {
    if (phase !== 'exam' || deadlineRef.current == null) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      texts, current, setNumber, endsAt: deadlineRef.current,
    }));
  }, [phase, texts, current, setNumber]);

  /* Every simulator sitting this candidate has handed in, newest first. */
  const { attempts, reload: reloadAttempts } = useAttempts(
    '/api/simulator/attempts', { enabled: Boolean(user) });

  /* Where this candidate stands on each numbered paper, for the cards.
     Newest first, so the first attempt found for a set is where that set now
     stands and the earlier ones are behind it in the list above. A writing
     paper is graded in one go, so there is no part-way state: it has either
     been handed in or it has not. Attempts from before the set was recorded,
     and the random-prompt sitting, carry no set_number and place nowhere —
     which is honest, since nobody can say which paper they were. */
  /* Set number -> the row the chooser holds for it, so an attempt can be
     named by its paper rather than by its date alone. */
  const setsByNumber = useMemo(() => Object.fromEntries(
    (sets || []).map((x) => [x.set_number, x])), [sets]);

  const paperName = (n) => {
    const x = setsByNumber[n];
    if (!x) return null;
    return x.month
      ? `${monthLabel(x.month)} · ${t('sim.testN', { n: x.index })}`
      : t('sim.setN', { n: x.index || x.set_number });
  };

  const cardResults = useMemo(() => {
    const out = {};
    (attempts || []).forEach((a) => {
      if (!a.set_number || out[a.set_number]) return;
      const mark = displayMark(a.combined_score, a.tcf_level);
      out[a.set_number] = { state: 'done', mark, nclc: nclcFromMark(mark) };
    });
    return out;
  }, [attempts]);

  /* The bank, by group: the official series of each month, newest month
     first, and the general practice sets after them. The server sends a flat
     list carrying each set's month, so the order of the page is decided here
     and a fourth month appears on its own the day the bank gains one. The
     same shape, and the same reasoning, as the speaking chooser. */
  const groups = useMemo(() => {
    const byMonth = new Map();
    const general = [];
    (sets || []).forEach((x) => {
      if (!x.month) { general.push(x); return; }
      if (!byMonth.has(x.month)) byMonth.set(x.month, []);
      byMonth.get(x.month).push(x);
    });
    const months = [...byMonth.keys()].sort().reverse()
      .map((m) => ({ key: m, month: m, sets: byMonth.get(m) }));
    return general.length ? [...months, { key: 'general', month: null, sets: general }] : months;
  }, [sets]);

  const openAttempt = async (row) => {
    setOpeningId(row.id);
    try {
      const { data } = await api.get(`/api/simulator/attempts/${row.id}`);
      setAttempt(data);
      // The row the history list holds carries the date; one arriving by
      // ?attempt= is just an id, so the banner reads the date off the sitting
      // itself rather than printing "Reviewing Invalid Date".
      setPastAttempt({ ...row, created_at: row.created_at || data.created_at });
      setPhase('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOpeningId(null);
    }
  };

  /* Opened straight onto one sitting's report, by ?attempt=<id>.
   *
   * The dashboard lists written papers beside spoken ones now, and a row that
   * only got the candidate as far as this page's set chooser is not a result
   * they can read — the sitting they clicked was in a history list they would
   * then have to find again. The parameter is dropped once the report is up,
   * so the back button leaves the review rather than reopening it and a
   * reload does not fight the chooser for the page. */
  const deepLinked = params.get('attempt');
  const openedRef = useRef(null);
  useEffect(() => {
    if (!deepLinked || !user || openedRef.current === deepLinked) return;
    openedRef.current = deepLinked;
    setParams({}, { replace: true });
    openAttempt({ id: deepLinked });
    // openAttempt is redefined on every render and setParams is stable; this
    // runs once per id, which is what openedRef enforces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinked, user]);

  const submit = useCallback(async (timeUsed) => {
    // The paper is what gets graded; without it there is nothing to submit.
    // Reachable from the expiry path, which fires from a timer that does not
    // know whether the fetch has landed.
    if (!tasks) return;
    setPhase('submitting');
    try {
      const { data } = await api.post('/api/simulator/submit', {
        task1: { prompt: tasks.task1?.text || '', text: texts[1] },
        task2: { prompt: tasks.task2?.text || '', text: texts[2] },
        task3: { prompt: tasks.task3?.text || '', text: texts[3] },
        // Which numbered paper this was, so the chooser can show where this
        // candidate stands on it. The attempt never recorded it before.
        set_number: setNumber || undefined,
        time_used_seconds: timeUsed,
      });
      setAttempt(data.attempt);
      setPastAttempt(null);
      setPhase('results');
      /* Marked, and the report is on screen. Not moved any earlier: the catch
         below puts the candidate back in the exam, so anything counted before
         the server answered would count papers that were never graded.
         The CEFR band and the clock only — never the three texts. */
      trackPracticeComplete({
        skill: 'writing',
        exam: 'tcf',
        exam_type: 'simulator',
        level: data.attempt?.tcf_level,
        set_number: setNumber || undefined,
        time_used_seconds: timeUsed,
      });
      reloadAttempts();   // the paper just handed in belongs in the history
      localStorage.removeItem(DRAFT_KEY);
      await refreshUser();
    } catch (e) {
      toast.error(errMsg(e));
      setPhase('exam');
    }
    // reloadAttempts is stable for a given list and would re-create submit on
    // every history refresh, which the expiry timer holds a reference to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, texts, refreshUser, setNumber]);

  useEffect(() => { secondsRef.current = seconds; }, [seconds]);

  useEffect(() => {
    if (phase !== 'exam') return undefined;
    // The deadline is anchored by the effect above, which runs first. Kept as a
    // fallback for the render in which both fire together.
    if (deadlineRef.current == null) deadlineRef.current = Date.now() + secondsRef.current * 1000;

    const read = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSeconds(left);
      // Threshold crossings rather than equality: a backgrounded tab can jump
      // straight past a given second. The `warned` ref already makes each
      // warning fire at most once.
      if (left <= 600 && !warned.current[10]) { warned.current[10] = true; toast.warning(t('sim.warn10')); }
      if (left <= 120 && !warned.current[2]) { warned.current[2] = true; toast.warning(t('sim.warn2')); }
      if (left <= 0 && !warned.current.expired) {
        warned.current.expired = true;
        toast.info(t('sim.timeUp'));
        submit(TOTAL);
      }
    };

    read();
    const id = setInterval(read, 250);
    // Returning to a suspended tab corrects the clock at once, not on the
    // next tick.
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
  const quitExam = async () => {
    if (!(await confirm(t('sim.quitConfirm'), { danger: true }))) return;
    setPhase('intro');
    setSeconds(TOTAL);
    secondsRef.current = TOTAL;
    deadlineRef.current = null;
    warned.current = { 10: false, 2: false, expired: false };
    setTexts({ 1: '', 2: '', 3: '' });
    setCurrent(1);
    localStorage.removeItem(DRAFT_KEY);
    navigate('/practice');
  };

  /* A finished paper, before either guard below.
   *
   * It reads nothing but `attempt`, and it has to render for a sitting opened
   * from the history — where no set has been chosen and no tâches have been
   * fetched, so both guards below would have swallowed it. */
  if (phase === 'results' && attempt) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t('sim.resultsTitle')}</h1>
        {pastAttempt && (
          <p className="mt-1 text-sm font-semibold text-primary" data-testid="sim-past-banner">
            {t('hist.reviewing', { when: formatDateTime(pastAttempt.created_at) })}
          </p>
        )}
        <div className="card mt-6 flex flex-wrap items-center justify-around gap-6 p-5 text-center sm:p-8">
          <div><p className="text-sm text-gray-500">{t('sim.combined')}</p><p className="font-heading text-4xl font-bold text-primary sm:text-5xl">{displayMark(attempt.combined_score, attempt.tcf_level) ?? '—'}</p></div>
          <div><p className="text-sm text-gray-500">{t('sim.cefr')}</p><p className="font-heading text-4xl font-bold sm:text-5xl">{attempt.tcf_level}</p></div>
          <div><p className="text-sm text-gray-500">{t('sim.timeUsed')}</p><p className="font-heading text-2xl font-bold sm:text-3xl">{t('sim.minutes', { n: Math.floor(attempt.time_used_seconds / 60) })}</p></div>
        </div>
        {[1, 2, 3].map((i) => {
          const task = attempt[`task${i}`];
          if (!task) return null;
          return (
            <section key={i} className="card mt-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-heading text-xl font-semibold">{GUIDE[i].name}</h2>
                <span className="pill bg-violet-50 text-primary">{t('sim.scorePill', { score: displayMark(task.analysis.overall_score, task.analysis.tcf_level) ?? '—', level: task.analysis.tcf_level })}</span>
              </div>
              <p className="mt-1 text-sm italic text-gray-500">{task.prompt}</p>
              <div className="mt-4 rounded-xl bg-gray-50 p-5">
                <ErrorHighlightedText text={task.text || t('sim.empty')} errors={task.analysis.errors} />
              </div>
            </section>
          );
        })}
        {/* Every correction of the sitting, in the table the speaking result
            uses — see CorrectionsTable.

            It was a list grouped by category: the mistake, the fix and the
            explanation, in three bare columns, with the same correction
            looking different here and on the speaking page an hour later.
            Grouping by category also buried the ranking that matters — a
            major error and a stylistic upgrade sat side by side under one
            heading, in the order they were written. The table says which is
            which, puts the worst first, and carries the rule to remember. */}
        <CorrectionsTable
          className="mt-6"
          testid="sim-corrections"
          title={t('sim.allErrors')}
          errors={[1, 2, 3].flatMap((i) => attempt[`task${i}`]?.analysis?.errors || [])} />
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/review" className="btn-primary">{t('sim.reviewErrors')}</Link>
          <Link to="/dashboard" className="btn-outline">{t('common.dashboard')}</Link>
          <Link to="/practice" className="btn-outline">{t('sim.backToPractice')}</Link>
          {pastAttempt && (
            <button type="button" data-testid="sim-exit-review"
              onClick={() => { setAttempt(null); setPastAttempt(null); setPhase('intro'); }}
              className="btn-outline">{t('hist.exitReview')}</button>
          )}
        </div>
      </main>
    );
  }


  /* Choose the sitting first — before the loading guard below, because the
     tâches are only fetched once a set has been picked. */
  if (!setNumber) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Seo titleKey="seo.sim.title" path="/practice/simulator" noindex />
        <div className="mb-3 text-center">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('sim.setsTitle')}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">{t('sim.setsSub')}</p>
        </div>
        <div className="mb-8 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-4 py-1.5 text-xs font-bold text-primary">
            <Timer size={14} weight="fill" /> {t('sim.setsBadge')}
          </span>
        </div>
        <AttemptHistory
          className="mb-8"
          testid="sim-history"
          attempts={attempts.map((a) => ({
            id: a.attempt_id,
            label: `${a.tcf_level} · ${displayMark(a.combined_score, a.tcf_level) ?? '—'}/20`,
            // Which paper it was, for the sittings that recorded one.
            note: (a.set_number && paperName(a.set_number)) || undefined,
            created_at: a.created_at,
          }))}
          opening={openingId}
          onOpen={openAttempt} />

        {/* One panel per group, the same chooser the speaking Test Mode uses.
            A flat grid of every paper was fine at twenty and is not at
            thirty-eight: the months are what a candidate is looking for, and
            under one heading they were a wall of identical cards with the
            newest subjects at the bottom. Each panel slides, and "View all"
            opens it.

            Still a number and a name on each card, and nothing of the paper
            itself — a tâche 3 subject read from the chooser is a paper
            chosen for the opinions the candidate already has. */}
        {groups.map((g) => (
          <ExamSetRow key={g.key} testid={`writing-group-${g.key}`}
            testidPrefix="sim-set"
            icon={PenNib}
            metaKey="sim.cardMeta"
            title={g.month ? monthLabel(g.month) : t('sim.general')}
            subtitle={g.month
              ? t('sim.monthSub', { month: monthLabel(g.month) })
              : t('sim.generalSub')}
            sets={g.sets}
            cardTitle={(x) => (g.month
              ? t('sim.testN', { n: x.index })
              : t('sim.setN', { n: x.index || x.set_number }))}
            results={cardResults}
            onOpen={setSetNumber} />
        ))}
      </main>
    );
  }

  if (!tasks) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  if (phase === 'intro') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <BackLink />
        <h1 className="text-3xl font-bold">{t('sim.title')}</h1>
        <div className="card mt-6 space-y-4 p-5 sm:p-8">
          <p className="text-gray-700">{t('sim.conditions')}</p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>⏱️ <strong>{t('sim.rule1Bold')}</strong> {t('sim.rule1')}</li>
            <li>📝 {t('sim.rule2')}</li>
            <li>🚫 {t('sim.rule3')}</li>
            <li>💳 {t('sim.rule4')}</li>
          </ul>
          {/* The clock starts with this click. The restore path above also
              reaches phase 'exam', and deliberately does not count: resuming
              an interrupted sitting is the same sitting, not a second one. */}
          <button className="btn-primary w-full"
            onClick={() => {
              trackPracticeStart({
                skill: 'writing',
                exam: 'tcf',
                exam_type: 'simulator',
                set_number: setNumber || undefined,
              });
              setPhase('exam');
            }}
            data-testid="start-simulator-button">
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

  /* ------ exam phase: distraction-free full screen ------ */
  const task = tasks[`task${current}`];
  const g = GUIDE[current];
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const low = seconds <= 120;

  return (
    <main className="fixed inset-0 z-[55] overflow-y-auto bg-white">
      {confirmDialog}
      <div className="mx-auto max-w-4xl px-4 py-6">
        <button onClick={quitExam} data-testid="quit-exam"
          className="mb-4 inline-flex min-h-[40px] items-center gap-1.5 px-1 py-2 text-sm font-semibold text-gray-400 hover:text-red-600 hover:underline">
          <SignOut size={16} /> {t('sim.quit')}
        </button>
        {/* Phones: the tabs and the clock stay pinned at the top of the
            overlay's scroll while the paper scrolls under them. */}
        <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2 sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0">
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((i) => (
              <button key={i} onClick={() => setCurrent(i)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition sm:px-4 ${current === i ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                data-testid={`task-tab-${i}`}>
                <span className="sm:hidden">T{i}</span>
                <span className="hidden sm:inline">{t('sim.taskTab', { n: i })}</span>
              </button>
            ))}
          </div>
          <span className={`pill text-base ${low ? 'bg-red-50 text-red-600' : 'bg-violet-50 text-primary'}`} data-testid="exam-timer">
            <Timer size={18} weight="fill" /> {mm}:{ss}
          </span>
        </div>

        <div className="card mt-5 p-5">
          <h2 className="font-heading font-semibold">{g.name}</h2>
          {/* The monthly series name their tâche 3 — "Voyager seul ou en
              groupe ?" — and the paper prints that title over the two
              documents. The general practice sets have no title and show
              nothing here. */}
          {task?.title && (
            <div className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/40 p-3.5"
              data-testid="sim-subject">
              <p className="text-xs font-bold uppercase tracking-wide text-primary">
                {t('sim.t3Subject')}
              </p>
              <p className="mt-1 font-heading text-sm font-bold text-gray-900">{task.title}</p>
            </div>
          )}
          {task?.doc_1 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[task.doc_1, task.doc_2].map((doc, i) => (
                <div key={i} className="rounded-2xl border border-violet-100 bg-violet-50/40 p-3.5" data-testid={`sim-document-${i + 1}`}>
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">
                    {t('sim.documentN', { n: i + 1 })}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-700">{doc}</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-sm leading-relaxed text-gray-700">{task?.text || t('sim.noConsigne')}</p>
          {task?.doc_1 && (
            <p className="mt-1.5 text-xs italic text-gray-500">{t('sim.docsNotCounted')}</p>
          )}
        </div>

        <div className="mt-4">
          <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setTexts({ ...texts, [current]: next })} />
        </div>
        {/* Paste is allowed. It was blocked to keep the sitting honest, and
            what it actually blocked was the candidate: a draft written in
            Notes or on a phone could not be brought in, an accented character
            copied from the toolbar's own output was refused, and a text lost
            to a crash had to be typed again from scratch. The clock, the word
            counts and the sealed subjects are what make this a sitting; the
            paper is marked for the learner's own benefit, so there is nobody
            to cheat but themselves. The spellchecker stays off — that one is
            a tool the real exam does not give you. */}
        <textarea key={current} ref={taRef} value={texts[current]} lang="fr" spellCheck="false"
          onChange={(e) => setTexts({ ...texts, [current]: e.target.value })}
          className="input paper-textarea mt-3 !min-h-[220px] !p-4 sm:!min-h-[360px] sm:!p-6"
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
