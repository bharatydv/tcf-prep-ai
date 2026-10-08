import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Receipt, BookOpen, Headphones,
  PenNib, Microphone, Stack, Info,
} from '@phosphor-icons/react';
import { api, errMsg } from '../lib/api';
import { RecordingPlayer } from '../components/RecordingPlayer';
import CorrectionsTable from '../components/CorrectionsTable';
import { PracticeCta } from '../components/speakingReport';
import { ResultRow, ResultSection, taskLine } from '../components/resultRows';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import {
  displayMark, markFromCorrect, nclcFromMark, speakingPaperMark,
  clbFromComprehension, TCF_COMPREHENSION_TOTAL,
} from '../lib/tcf';
import { setLabel, submissionSkill } from '../lib/speakingExam';

/* The four papers, each with a hue of its own so the current selection is
   readable at a glance rather than only from which pill is filled. The hues
   are spread around the wheel rather than picked for prettiness: reading and
   listening sat as near-identical pastels before, which is exactly the pair a
   red-blind reader cannot separate. */
const SKILLS = [
  { id: 'all', key: 'dash.skillAll', Icon: Stack, tone: '#6B7280' },
  { id: 'reading', key: 'dash.skillReading', Icon: BookOpen, tone: '#0891B2', href: '/reading' },
  { id: 'listening', key: 'dash.skillListening', Icon: Headphones, tone: '#D97706', href: '/listening' },
  { id: 'writing', key: 'dash.skillWriting', Icon: PenNib, tone: '#7C3AED', href: '/practice/tasks' },
  { id: 'speaking', key: 'dash.skillSpeaking', Icon: Microphone, tone: '#E11D48', href: '/speaking/tasks' },
];
const TONE = Object.fromEntries(SKILLS.map((s) => [s.id, s.tone]));

const RANGES = [7, 30, 90, 0];
const RANGE_KEY = { 7: 'dash.range7', 30: 'dash.range30', 90: 'dash.range90', 0: 'dash.rangeAll' };

/* Only writing and speaking are graded by the AI, so only they carry error
   categories, weak points and recurring mistakes. Reading and listening are
   marked against a key — a right answer has no "category of mistake". */
const AI_GRADED = new Set(['all', 'writing', 'speaking']);


/* Declared at module scope, not inside Dashboard(). A component defined in a
   render body is a NEW component type on every render, so React unmounts and
   remounts its whole subtree instead of updating it — which throws away DOM
   state and, on anything holding a chart or an input, is visible. */
function Head({ title, note }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-heading text-[15px] font-bold text-gray-900">{title}</h2>
      {note && <span className="text-xs font-medium text-gray-400">{note}</span>}
    </div>
  );
}

/* One graded answer as a result row reads it: the mark out of 20 the exam
   reports, and the NCLC band that mark converts to. The grader's working
   0-100 never reaches a screen. The same for a spoken answer and a written
   one, which is the point — they are listed by the same component. */
function withMark(a) {
  const mark = displayMark(a.overall_score, a.tcf_level);
  return { ...a, mark, band: nclcFromMark(mark) };
}

/* Reading and listening are marked against an answer key, so the three cards
   built on AI error analysis have nothing to say about them. Saying so is the
   point: the alternative is showing writing figures under a reading filter,
   which is not an empty state but a wrong answer. */
function NotForSkill({ children }) {
  return (
    <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm leading-relaxed text-gray-500">
      {children}
    </p>
  );
}

export default function Dashboard() {
  const t = useT();
  const [stats, setStats] = useState(null);
  const [mistakes, setMistakes] = useState(null);
  const [subs, setSubs] = useState([]);
  const [reading, setReading] = useState([]);
  const [listening, setListening] = useState([]);
  const [error, setError] = useState('');
  const [skill, setSkill] = useState('all');
  const [days, setDays] = useState(30);
  // Which row has its recording open. One at a time: two players going
  // at once is never what the click meant.
  const [playing, setPlaying] = useState(null);
  /* Whole speaking papers, which nothing on this page could show before.
     A tâche shows up in the history below as one graded submission like any
     other; the three of them as one Expression orale paper — the mark out of
     20 and the NCLC band that mark converts to — existed only on the exam
     page itself, which meant a candidate who closed that tab had no way back
     to their result. */
  const [sittings, setSittings] = useState([]);
  /* And the tâches practised outside a paper, which nothing here could show
     either. A practice answer reached the history list below as one graded
     submission among the written ones, named only by its CEFR level — so
     "how is my tâche 3 going" was a question the dashboard held the answer to
     and could not be asked. */
  const [practice, setPractice] = useState([]);
  /* And the same two lists for Expression écrite, which this page had neither
     of. A written paper arrived as one row of the history table named by its
     CEFR level, and a written practice answer as another exactly like it, so
     the skill that half the product is about was the only one with no result
     of its own anywhere on the dashboard. */
  const [writingPapers, setWritingPapers] = useState([]);
  const [writingPractice, setWritingPractice] = useState([]);
  const [params, setParams] = useSearchParams();
  // Set by the exam when it sends somebody here to wait out the marking.
  const marking = params.get('marking') === 'speaking';

  // Every call used to swallow its error, so a backend outage left the page
  // spinning forever with nothing to click.
  const load = useCallback(() => {
    setError('');
    api.get('/api/dashboard/stats')
      .then(({ data }) => setStats(data))
      .catch((e) => setError(errMsg(e, t('dash.loadError'))));
    api.get('/api/mistakes/summary').then(({ data }) => setMistakes(data)).catch(() => {});
    api.get('/api/submissions').then(({ data }) => setSubs(data.submissions || [])).catch(() => {});
    // Reading and listening live in their own tables, not in submissions, so a
    // dashboard that read only /api/submissions could never show two of the
    // four papers the learner sits.
    api.get('/api/reading/attempts').then(({ data }) => setReading(data.attempts || [])).catch(() => {});
    api.get('/api/listening/attempts').then(({ data }) => setListening(data.attempts || [])).catch(() => {});
    api.get('/api/speaking/exam-sets/attempts')
      .then(({ data }) => setSittings(data.sittings || [])).catch(() => {});
    api.get('/api/speaking/practice/attempts')
      .then(({ data }) => setPractice(data.attempts || [])).catch(() => {});
    api.get('/api/simulator/sittings')
      .then(({ data }) => setWritingPapers(data.sittings || [])).catch(() => {});
    api.get('/api/writing/practice/attempts')
      .then(({ data }) => setWritingPractice(data.attempts || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  /* Waiting out a marking that is still running somewhere else.
   *
   * The candidate was sent here the moment they finished their last tâche
   * rather than being held on a spinner, so the grade lands after they
   * arrive. This polls until the paper they just sat is complete — bounded,
   * because a grader that failed must not leave the page asking forever, and
   * the row is perfectly readable as "2 of 3" in the meantime. */
  useEffect(() => {
    if (!marking) return undefined;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      api.get('/api/speaking/exam-sets/attempts')
        .then(({ data }) => {
          const rows = data.sittings || [];
          setSittings(rows);
          if (rows[0]?.complete) {
            clearInterval(id);
            // Drop the flag so a reload does not start polling again.
            setParams({}, { replace: true });
          }
        })
        .catch(() => {});
      if (tries >= 15) clearInterval(id);
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marking]);

  /* Three sources, one shape, one scale: the mark out of 20 the exam reports.
     A graded submission carries the grader's working 0-100, and a comprehension
     paper carries `score` out of `total`, so neither is plotted as it arrives —
     34/40 and 68/100 are the same performance and belong at the same height,
     and that height is 14. */
  const attempts = useMemo(() => {
    const fromSubs = (subs || []).map((s) => ({
      id: s.submission_id,
      at: s.created_at,
      /* Which paper this was, as the server says it was.
         It used to be worked out here from a set of source names, and the
         set had never heard of `speaking_exam` — so every answer given in
         speaking Test Mode was filed as WRITING. That put oral marks into
         the written level and left a candidate who had only sat speaking
         tests being told they had not practised speaking at all. */
      skill: submissionSkill(s),
      score: typeof s.overall_score === 'number'
        ? displayMark(s.overall_score, s.tcf_level) : null,
      label: s.tcf_level || '—',
      errors: s.error_count ?? 0,
      href: `/feedback/${s.submission_id}`,
      // Only the single-recording speaking flow keeps one, and only since it
      // started keeping them — so this is per attempt, not per skill.
      hasAudio: Boolean(s.has_audio),
    }));
    const fromPapers = (rows, kind, idKey) => (rows || []).map((r) => ({
      id: r[idKey],
      at: r.created_at,
      skill: kind,
      hasAudio: false,
      score: markFromCorrect(r.score, r.total),
      /* The paper's own weighted score out of 699, which is what its CLB
         level is read off. `score` above stays the mark out of 20, because
         that is the one scale all four skills share and the history list
         below puts them on one chart. */
      tcfScore: typeof r.tcf_score === 'number' ? r.tcf_score : null,
      // A comprehension paper records no CEFR level, so it names the paper it
      // was — "Test 7" is true, and an invented level would not be.
      label: t('dash.testN', { n: r.test_number }),
      errors: Math.max(0, (r.total || 0) - (r.score || 0)),
      href: null,
    }));
    /* And the hour-long Expression écrite sittings, which reached none of
       this. A simulator paper is an exam_attempts row rather than three
       submissions, so it was in no list this page read: it counted towards
       the writing level not at all, and a candidate whose only written work
       was Test Mode saw "Writing — not practised yet" over three essays they
       had spent an hour on. */
    const fromWritingPapers = (writingPapers || []).map((paper) => ({
      id: paper.attempt_id,
      at: paper.created_at,
      skill: 'writing',
      hasAudio: false,
      score: displayMark(paper.combined_score, paper.tcf_level),
      label: paper.tcf_level || '—',
      errors: [1, 2, 3].reduce(
        (n, k) => n + (paper.tasks?.[String(k)]?.error_count || 0), 0),
      href: `/practice/simulator?attempt=${paper.attempt_id}`,
    }));
    return [...fromSubs, ...fromWritingPapers,
      ...fromPapers(reading, 'reading', 'reading_attempt_id'),
      ...fromPapers(listening, 'listening', 'listening_attempt_id')]
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [subs, writingPapers, reading, listening, t]);

  const filtered = useMemo(() => {
    const cutoff = days ? Date.now() - days * 86400000 : null;
    return attempts.filter((a) => {
      if (skill !== 'all' && a.skill !== skill) return false;
      if (cutoff && new Date(a.at).getTime() < cutoff) return false;
      return true;
    });
  }, [attempts, skill, days]);

  /* Where this candidate stands, skill by skill, as a CLB band.
   *
   * The row used to be "Attempts 24 · Average score 7.1/20", which is two
   * numbers nobody is assessed on: a TCF Canada candidate is reported one
   * level per skill, and an average across all four hides the single skill
   * that decides their file. Every attempt on this page is already a mark out
   * of 20 — a reading paper's 34/40 and a graded essay's 68/100 are put on
   * that one scale upstream — so the band is the same conversion the exam
   * pages and the practice cards use. One table, in lib/tcf.js.
   *
   * The date window applies; the skill filter deliberately does not. These
   * cards ARE the breakdown by skill, and filtering them by skill would blank
   * three of the four.
   */
  const byRange = useMemo(() => {
    const cutoff = days ? Date.now() - days * 86400000 : null;
    return attempts.filter((a) => !cutoff || new Date(a.at).getTime() >= cutoff);
  }, [attempts, days]);

  /* The repeat offenders, in the shape the corrections table reads.
     `times_repeated` counts the times it came BACK, so the first sighting is
     0 — the badge says how many times it has been made, which is one more. */
  const recurring = useMemo(() => (mistakes?.repeat_leaders || []).map((m) => ({
    error: m.error_text,
    correction: m.correction,
    explanation: m.explanation,
    category: m.category,
    times_repeated: (m.times_repeated || 0) + 1,
  })), [mistakes]);

  const perSkill = useMemo(() => SKILLS.filter((x) => x.id !== 'all').map((x) => {
    const rows = byRange.filter((a) => a.skill === x.id);
    const none = { ...x, attempts: rows.length, mark: null, outOf: 20, nclc: null };

    /* Compréhension écrite and orale are reported on the paper's own
       699-point scale, weighted by item difficulty, and each has its own
       published CLB chart — see clbFromComprehension. A count of right
       answers is not what either is read on. */
    if (x.id === 'reading' || x.id === 'listening') {
      const weighted = rows.filter((a) => typeof a.tcfScore === 'number');
      if (weighted.length) {
        const mark = Math.round(
          weighted.reduce((sum, a) => sum + a.tcfScore, 0) / weighted.length);
        return { ...x, attempts: rows.length, mark, outOf: TCF_COMPREHENSION_TOTAL,
                 nclc: clbFromComprehension(mark, x.id) };
      }
      /* A paper sat before the weighted score was recorded and whose answers
         could not be rescored. Reported on the shared mark instead of not at
         all: it is rougher, and it is what this attempt actually left behind. */
    }

    const scored = rows.filter((a) => typeof a.score === 'number');
    if (!scored.length) return none;
    // Rounded before the conversion: the table is defined on whole marks, and
    // 6.6/20 is a CLB 6 performance, not two thirds of the way to one.
    const mark = Math.round(scored.reduce((sum, a) => sum + a.score, 0) / scored.length);
    return { ...x, attempts: rows.length, mark, outOf: 20, nclc: nclcFromMark(mark) };
  }), [byRange]);

  /* The headline: the LOWEST of the four, not their mean.
   *
   * That is how the level is read for an immigration file — the weakest skill
   * is the one that decides it — and it is also the only honest summary to
   * put on a dashboard, because an average lets a strong reading score hide a
   * writing score that will fail the application. `rank` turns the published
   * bands into something comparable; "10+" is the top of the table. */
  const overall = useMemo(() => {
    const done = perSkill.filter((x) => x.mark !== null);
    if (!done.length) return null;
    const rank = (b) => (b === '10+' ? 10 : b ? Number(b) : 0);
    const weakest = done.reduce((low, x) => (rank(x.nclc) < rank(low.nclc) ? x : low));
    return { ...weakest, done: done.length, total: perSkill.length,
             attempts: done.reduce((n, x) => n + x.attempts, 0),
             even: done.every((x) => rank(x.nclc) === rank(weakest.nclc)) };
  }, [perSkill]);

  /* WHICH RESULTS THE FILTER BAR IS ASKING FOR.
   *
   * The date window, as a predicate the four result lists share. The skill
   * filter picks whole sections rather than rows: under "Speaking" the two
   * writing lists are not a narrower answer to the question, they are the
   * wrong one, and an empty "Writing tests" card under it says nothing true.
   */
  const inWindow = useCallback((at) => (
    !days || new Date(at).getTime() >= Date.now() - days * 86400000
  ), [days]);

  const showSpeaking = skill === 'all' || skill === 'speaking';
  const showWriting = skill === 'all' || skill === 'writing';

  /* Each speaking paper with its three tâches lined up and the number
     answered, so the row itself has nothing left to work out. */
  const speakingPapers = useMemo(() => sittings
    .filter((s) => inWindow(s.last_activity))
    .map((s) => {
      const taskList = [1, 2, 3].map((n) => s.tasks[String(n)] || null);
      return { ...s, taskList, answered: taskList.filter(Boolean).length };
    }), [sittings, inWindow]);

  /* A written paper is graded in one go, so its mark comes off the sitting
     rather than being averaged from the tâches. `tasks` holds only the ones
     actually written — the grader flags a blank page and the endpoint leaves
     it out — so a short paper reports "2 of 3 tâches" instead of a mark that
     counted a blank as a zero. */
  const writingSittings = useMemo(() => writingPapers
    .filter((s) => inWindow(s.created_at))
    .map((s) => {
      const mark = displayMark(s.combined_score, s.tcf_level);
      return { ...s, answered: Object.keys(s.tasks || {}).length,
               mark, band: nclcFromMark(mark) };
    }), [writingPapers, inWindow]);

  const speakingAnswers = useMemo(() => practice
    .filter((a) => inWindow(a.created_at)).map(withMark), [practice, inWindow]);

  const writtenAnswers = useMemo(() => writingPractice
    .filter((a) => inWindow(a.created_at)).map(withMark),
  [writingPractice, inWindow]);

  /* The line under a practice answer's title: when it was given, and how much
     was wrong with it. One sentence, the same for both skills. */
  const answerMeta = (a) => `${(a.created_at || '').slice(0, 10)} · ${
    a.error_count ? t('hist.errors', { n: a.error_count }) : t('hist.noErrors')}`;

  if (error && !stats) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <Seo titleKey="seo.dashboard.title" path="/dashboard" noindex />
        <p className="text-gray-700">{error}</p>
        <button className="btn-primary mt-5" onClick={load}>{t('dash.retry')}</button>
      </main>
    );
  }
  if (!stats) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </main>
    );
  }

  // A brand-new account sees empty charts and a blank heatmap otherwise, which
  // is the least motivating possible first screen.
  if (!stats.total_submissions && !attempts.length) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <Seo titleKey="seo.dashboard.title" path="/dashboard" noindex />
        <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('dash.welcome')}</h1>
        <p className="mx-auto mt-3 max-w-lg text-gray-600">{t('dash.emptyBody')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/practice/tasks" className="btn-primary">{t('dash.writeFirst')}</Link>
          <Link to="/speaking/tasks" className="btn-outline">{t('dash.orSpeak')}</Link>
        </div>
      </main>
    );
  }

  const skillName = t(SKILLS.find((s) => s.id === skill).key);
  const aiGraded = AI_GRADED.has(skill);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-10">
      <Seo titleKey="seo.dashboard.title" path="/dashboard" noindex />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          {t('dash.title')}
        </h1>
        {/* The phone menu already lists invoices. */}
        <Link to="/invoices" className="btn-outline !hidden !px-4 !py-2 text-sm sm:!inline-flex"
          data-testid="dashboard-invoices">
          <Receipt size={16} /> {t('inv.title')}
        </Link>
      </div>

      {/* FILTER BAR — the four papers and the window, in one row, because they
          answer one question together: which attempts am I looking at. */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-3 shadow-soft sm:mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Nine buttons wrapped into four rows on a phone. The papers scroll
              in one row there, and the window is a select. */}
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" data-testid="dash-skill">
            {SKILLS.map(({ id, key, Icon, tone: c }) => {
              const on = skill === id;
              return (
                <button key={id} type="button" role="tab" aria-selected={on}
                  onClick={() => setSkill(id)} data-testid={`dash-skill-${id}`}
                  style={on ? { backgroundColor: c, borderColor: c } : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
                    on ? 'text-white shadow-sm'
                       : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                  <Icon size={15} weight="fill" /> {t(key)}
                </button>
              );
            })}
          </div>

          <label className="w-full sm:hidden">
            <span className="sr-only">{t('dash.range30')}</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="input !py-2 text-sm" data-testid="dash-range-select">
              {RANGES.map((d) => <option key={d} value={d}>{t(RANGE_KEY[d])}</option>)}
            </select>
          </label>
          <div className="hidden flex-wrap gap-1.5 sm:flex" data-testid="dash-range">
            {RANGES.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                data-testid={`dash-range-${d}`}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  days === d
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'}`}>
                {t(RANGE_KEY[d])}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* WHERE YOU STAND — the level and the four skills it is made of, on
          one line.

          It was a panel: a 48px number over three lines of prose, then four
          cards under it, and a third of the first screen gone before the
          dashboard said anything the learner could act on. The same five
          facts fit in a row — the level, then each skill's band with its mark
          and attempt count beneath. The caveats keep their words but drop to
          the size of caveats.

          No streaks. They measure turning up, not readiness. */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-soft sm:mt-5 sm:p-4"
        data-testid="dash-level">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          {/* The headline, and what to do about it. */}
          <div className="flex shrink-0 items-center gap-3 lg:w-[290px]">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {t('dash.levelTitle')}
              </p>
              {overall ? (
                <>
                  <p className="font-heading text-[26px] font-extrabold leading-tight tracking-tight text-gray-900"
                    data-testid="dash-overall-clb">
                    {overall.nclc ? t('sexam.clb', { level: overall.nclc }) : t('dash.levelBelow')}
                  </p>
                  {/* Naming the weakest skill and leaving the candidate to
                      find where it is practised is half an answer. */}
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold leading-snug"
                    style={{ color: overall.tone }}>
                    {overall.even ? t('dash.levelLevel')
                      : t('dash.levelWeakest', { skill: t(overall.key) })}
                    {!overall.even && overall.href && (
                      <Link to={overall.href} data-testid="dash-level-practise"
                        className="underline underline-offset-2">
                        {t('dash.levelPractise', { skill: t(overall.key).toLowerCase() })}
                      </Link>
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-gray-500">{t('dash.levelNone')}</p>
              )}
            </div>
          </div>

          {/* One cell per skill: the band, the mark behind it, and how many
              attempts it was read from — a level from one paper and a level
              from twenty should not look equally settled. */}
          <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-100 pt-3 sm:grid-cols-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            {perSkill.map((x) => (
              <div key={x.id} data-testid={`dash-skill-level-${x.id}`}>
                <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: x.tone }}>
                  <x.Icon size={12} weight="fill" /> {t(x.key)}
                </p>
                {x.mark === null ? (
                  <p className="text-[13px] leading-snug text-gray-400">{t('dash.levelEmptySkill')}</p>
                ) : (
                  <>
                    {/* The band on its own line, the numbers under it. Inline,
                        a long band ("Below CLB 4") wrapped its own sub-line
                        while a short one ("CLB 7") did not, so the four cells
                        sat at different heights for no reason the reader
                        could see. */}
                    <p className="font-heading text-[17px] font-extrabold leading-snug tracking-tight text-gray-900">
                      {x.nclc ? t('sexam.clb', { level: x.nclc }) : t('dash.levelBelow')}
                    </p>
                    <p className="text-[11px] font-medium leading-snug text-gray-400">
                      {x.mark}/{x.outOf} · {t('dash.statAttemptsN', { n: x.attempts })}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* The caveats, in one line under the row rather than a paragraph
            inside it. Still said in full: a level estimated from three skills
            is not the level, and neither is an estimate an official result. */}
        {overall && (
          <p className="mt-2.5 border-t border-gray-100 pt-2.5 text-[11px] leading-relaxed text-gray-400">
            {overall.done < overall.total && (
              <span className="font-medium text-amber-700">
                {t('dash.levelPartial', { done: overall.done })}{' '}
              </span>
            )}
            {t('dash.levelBasis', { n: overall.attempts })}
          </p>
        )}
      </section>

      {/* THE CORRECTIONS THEMSELVES — the same table the result pages use.

          This was two summaries: three category names with a stock tip
          ("Conjugaison · 53 — drill the big irregulars"), and a line of
          strike-through pairs. Both described the learner rather than
          showing anything they actually wrote, and neither looked like the
          corrections they had just read on the result page an hour earlier.
          One table, read the same way everywhere. */}
      {aiGraded ? (
        <>
          <CorrectionsTable
            className="mt-5"
            testid="dash-corrections"
            title={t('dash.topCorrections')}
            desc={t('dash.topCorrectionsSub')}
            errors={mistakes?.recent_corrections} />

          {/* The ones that keep coming back, in the same table and sorted by
              how often rather than by impact — that count IS the ranking
              here, and re-sorting by severity would bury the mistake made
              nine times under one made once. */}
          <CorrectionsTable
            className="mt-5"
            testid="dash-recurring"
            title={t('dash.recurring')}
            desc={t('dash.recurringSub')}
            rank={false}
            repeats
            errors={recurring} />

          {/* The old panel put a "Review this category" button on each of
              three categories. The categories are gone, so one way in
              remains — it leads to the same drill, built from the same
              mistakes, and it is the action both tables above are for. */}
          {(mistakes?.recent_corrections?.length || recurring.length) ? (
            <PracticeCta practiceHref="/review" className="mt-5" />
          ) : null}

          {!mistakes?.recent_corrections?.length && !recurring.length && (
            <section className="card mt-5 p-4 sm:p-6">
              <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                {t('dash.noErrors')}
              </p>
            </section>
          )}
        </>
      ) : (
        <section className="card mt-5 p-4 sm:p-6">
          <Head title={t('dash.topCorrections')} note={t('dash.basedOn')} />
          <NotForSkill>{t('dash.aiGradedOnly', { skill: skillName })}</NotForSkill>
        </section>
      )}

      {/* THE RESULTS THEMSELVES — four lists, one row shape.
       *
       * Each skill that is graded by the AI gets its finished papers and then
       * the answers practised one at a time, and all four read identically
       * because they are the same component. Writing had neither list: a
       * sitting the candidate spent an hour on reached this page as one line
       * of the history table named by its CEFR level, which is less than the
       * speaking tâche they recorded in four minutes got.
       *
       * The filter bar above applies. With four sections it has to — under
       * "Speaking" the two writing lists are not a narrower answer, they are
       * the wrong one — and the date window applies with it, because the bar
       * answers one question and it is "which attempts am I looking at".
       */}

      {showSpeaking && (
        <ResultSection
          testid="dash-speaking-tests"
          title={t('dash.speakingTests')}
          note={t('dash.speakingTestsNote')}
          notice={marking && !sittings[0]?.complete ? (
            <p className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs text-primary"
              data-testid="dash-marking">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-primary" />
              {t('dash.markingNow')}
            </p>
          ) : null}
          rows={speakingPapers.map((sit) => {
            // The same arithmetic the exam page does, from the same helper —
            // there is one conversion table and it lives in lib/tcf.js.
            const paper = sit.complete ? speakingPaperMark(sit.taskList) : null;
            return (
              <ResultRow key={sit.set_number} skill="speaking" as={Link}
                testid={`dash-sitting-${sit.set_number}`}
                href={`/speaking/test?set=${sit.set_number}`}
                badge={sit.index || sit.set_number}
                title={t('dash.speakingSet', { n: setLabel(t, sit) })}
                meta={taskLine(t, sit.tasks)}
                complete={Boolean(paper)}
                mark={paper ? paper.mark : null}
                band={paper ? paper.nclc : null}
                pending={paper ? null : t('dash.speakingPartial', {
                  done: sit.answered, total: 3 })} />
            );
          })} />
      )}

      {/* The tâches practised one at a time, which is where most of the
          speaking in this app actually happens. No combined mark: three
          tâches practised on three different days are not a paper, and
          averaging them into one would invent a sitting nobody sat. */}
      {showSpeaking && (
        <ResultSection
          testid="dash-speaking-practice"
          title={t('dash.speakingPractice')}
          note={t('dash.speakingPracticeNote')}
          rows={speakingAnswers.map((a) => (
            <ResultRow key={a.submission_id} skill="speaking" as={Link}
              testid={`dash-practice-${a.submission_id}`}
              href={`/feedback/${a.submission_id}`}
              /* The tâche number, or the skill's own icon for an answer
                 that belongs to no tâche — free speaking here, free writing
                 below. An em dash in a filled badge reads as a missing
                 number rather than as "this had none". */
              badge={a.task_type || <Microphone size={15} weight="fill" />}
              title={a.task_type
                ? t('dash.practiceTache', { n: a.task_type })
                : t('dash.freeAnswer')}
              meta={answerMeta(a)}
              mark={a.mark}
              band={a.band || a.tcf_level} />
          ))} />
      )}

      {/* WRITING PAPERS — the hour-long Expression écrite sitting, reported
          the way the speaking paper above it is. One row per attempt rather
          than per set: a written paper is graded in one go, so an attempt IS
          a sitting, and somebody who sat set 7 twice has two results worth
          seeing. */}
      {showWriting && (
        <ResultSection
          testid="dash-writing-tests"
          title={t('dash.writingTests')}
          note={t('dash.writingTestsNote')}
          rows={writingSittings.map((sit) => (
            <ResultRow key={sit.attempt_id} skill="writing" as={Link}
              testid={`dash-writing-sitting-${sit.attempt_id}`}
              href={`/practice/simulator?attempt=${sit.attempt_id}`}
              badge={sit.index || sit.set_number || <PenNib size={15} weight="fill" />}
              /* Named like the speaking paper above, from the same helper.
                 A sitting from before the set number was recorded, or one
                 drawn at random, belongs to no numbered paper — so it is
                 "Writing test" and not "Writing test · Set undefined". */
              title={sit.set_number
                ? t('dash.writingSet', { n: setLabel(t, sit) })
                : t('dash.writingUnnumbered')}
              meta={taskLine(t, sit.tasks)}
              complete={sit.complete}
              mark={sit.complete ? sit.mark : null}
              band={sit.complete ? sit.band : null}
              pending={sit.complete ? null : t('dash.writingPartial', {
                done: sit.answered, total: 3 })} />
          ))} />
      )}

      {/* WRITING PRACTICE — the texts written outside a sitting. Free writing
          answers no tâche, so it says so rather than being given one. */}
      {showWriting && (
        <ResultSection
          testid="dash-writing-practice"
          title={t('dash.writingPractice')}
          note={t('dash.writingPracticeNote')}
          rows={writtenAnswers.map((a) => (
            <ResultRow key={a.submission_id} skill="writing" as={Link}
              testid={`dash-writing-practice-${a.submission_id}`}
              href={`/feedback/${a.submission_id}`}
              badge={a.task_type || <PenNib size={15} weight="fill" />}
              title={a.task_type
                ? t('dash.practiceTache', { n: a.task_type })
                : t('dash.freeWriting')}
              meta={answerMeta(a)}
              mark={a.mark}
              band={a.band || a.tcf_level} />
          ))} />
      )}

      {/* HISTORY — now covers all four papers, so which paper an attempt was
          is a column rather than something the reader has to infer. */}
      <section className="card mt-5 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-3 sm:p-6 sm:pb-4">
          <h2 className="font-heading text-[15px] font-bold text-gray-900">{t('dash.history')}</h2>
          <span className="text-xs font-medium text-gray-400">
            {t('dash.nAttempts', { n: filtered.length })}
          </span>
        </div>

        {/* On a phone the six-column table scrolled sideways inside the page.
            One card per attempt instead, with the same fields and the same
            actions; the table below is the sm-and-up layout. */}
        <ul className="divide-y divide-gray-100 border-t border-gray-100 sm:hidden" data-testid="dash-history-cards">
          {filtered.map((a) => (
            <li key={`${a.skill}-${a.id}`} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE[a.skill] }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold" style={{ color: TONE[a.skill] }}>
                    {t(SKILLS.find((s) => s.id === a.skill).key)}
                    <span className="ml-2 font-heading text-gray-900">{a.label}</span>
                  </span>
                  <span className="block text-xs tabular-nums text-gray-500">
                    {(a.at || '').slice(0, 10)} · {t('dash.colScore')} {a.score ?? '—'} · {t('dash.colErrors')} {a.errors}
                  </span>
                </span>
                {a.href
                  ? <Link to={a.href} className="inline-flex min-h-[40px] items-center px-2 text-sm font-semibold text-primary">{t('dash.view')}</Link>
                  : null}
              </div>
              {a.hasAudio && (
                <div className="mt-2">
                  <button type="button"
                    onClick={() => setPlaying(playing === a.id ? null : a.id)}
                    className="inline-flex min-h-[40px] items-center gap-1 text-sm font-semibold text-rose-600">
                    <Microphone size={14} weight="fill" />
                    {playing === a.id ? t('dash.hideAudio') : t('dash.listen')}
                  </button>
                  {playing === a.id && <div className="mt-2"><RecordingPlayer submissionId={a.id} /></div>}
                </div>
              )}
            </li>
          ))}
          {!filtered.length && (
            <li className="px-4 py-8 text-center text-sm text-gray-400">{t('dash.noSubmissions')}</li>
          )}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-bold sm:px-6">{t('dash.colDate')}</th>
                <th className="px-4 py-2.5 font-bold sm:px-6">{t('dash.colSkill')}</th>
                <th className="px-4 py-2.5 font-bold sm:px-6">{t('dash.colLevel')}</th>
                <th className="px-4 py-2.5 font-bold sm:px-6">{t('dash.colScore')}</th>
                <th className="px-4 py-2.5 font-bold sm:px-6">{t('dash.colErrors')}</th>
                <th className="px-4 py-2.5 sm:px-6"><span className="sr-only">{t('dash.view')}</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.flatMap((a) => [
                <tr key={`${a.skill}-${a.id}`} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600 sm:px-6">
                    {(a.at || '').slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 sm:px-6">
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
                      style={{ color: TONE[a.skill] }}>
                      <span className="h-2 w-2 rounded-full"
                        style={{ background: TONE[a.skill] }} />
                      {t(SKILLS.find((s) => s.id === a.skill).key)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 sm:px-6">{a.label}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-900 sm:px-6">{a.score ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-600 sm:px-6">{a.errors}</td>
                  <td className="px-4 py-3 sm:px-6">
                    <span className="flex items-center justify-end gap-3">
                      {/* Loaded only when asked for. One <audio> per row would
                          be a metadata request per attempt on a page that
                          opens with a hundred of them. */}
                      {a.hasAudio && (
                        <button type="button" data-testid="dash-listen"
                          onClick={() => setPlaying(playing === a.id ? null : a.id)}
                          className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline">
                          <Microphone size={14} weight="fill" />
                          {playing === a.id ? t('dash.hideAudio') : t('dash.listen')}
                        </button>
                      )}
                      {a.href
                        ? <Link to={a.href} className="font-semibold text-primary">{t('dash.view')}</Link>
                        : <span className="text-gray-300">—</span>}
                    </span>
                  </td>
                </tr>,
              a.hasAudio && playing === a.id && (
                <tr key={`${a.skill}-${a.id}-audio`} className="border-t border-gray-100 bg-gray-50/40">
                  <td colSpan="6" className="px-4 py-4 sm:px-6">
                    <RecordingPlayer submissionId={a.id} />
                  </td>
                </tr>
              ),
              ])}
              {!filtered.length && (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-sm text-gray-400 sm:px-6">
                    {t('dash.noSubmissions')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mx-auto mt-8 flex max-w-2xl items-start justify-center gap-2 text-center text-xs leading-relaxed text-gray-400">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>{t('common.disclaimerScores')}</span>
      </p>
    </main>
  );
}
