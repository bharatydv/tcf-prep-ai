import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Receipt, Fire, Trophy, GameController, BookOpen, Headphones,
  PenNib, Microphone, Stack, ChartLineUp, Info,
} from '@phosphor-icons/react';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { RecordingPlayer } from '../components/RecordingPlayer';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { displayMark, markFromCorrect, speakingPaperMark } from '../lib/tcf';

/* The four papers, each with a hue of its own so the current selection is
   readable at a glance rather than only from which pill is filled. The hues
   are spread around the wheel rather than picked for prettiness: reading and
   listening sat as near-identical pastels before, which is exactly the pair a
   red-blind reader cannot separate. */
const SKILLS = [
  { id: 'all', key: 'dash.skillAll', Icon: Stack, tone: '#6B7280' },
  { id: 'reading', key: 'dash.skillReading', Icon: BookOpen, tone: '#0891B2' },
  { id: 'listening', key: 'dash.skillListening', Icon: Headphones, tone: '#D97706' },
  { id: 'writing', key: 'dash.skillWriting', Icon: PenNib, tone: '#7C3AED' },
  { id: 'speaking', key: 'dash.skillSpeaking', Icon: Microphone, tone: '#E11D48' },
];
const TONE = Object.fromEntries(SKILLS.map((s) => [s.id, s.tone]));

const RANGES = [7, 30, 90, 0];
const RANGE_KEY = { 7: 'dash.range7', 30: 'dash.range30', 90: 'dash.range90', 0: 'dash.rangeAll' };

/* Only writing and speaking are graded by the AI, so only they carry error
   categories, weak points and recurring mistakes. Reading and listening are
   marked against a key — a right answer has no "category of mistake". */
const AI_GRADED = new Set(['all', 'writing', 'speaking']);

const SPEAKING_SOURCES = new Set(['speaking', 'conversation']);

/* Declared at module scope, not inside Dashboard(). A component defined in a
   render body is a NEW component type on every render, so React unmounts and
   remounts its whole subtree instead of updating it — which throws away DOM
   state and, on anything holding a chart or an input, is visible. */
function Head({ title, note }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-heading text-[15px] font-bold text-gray-900">{title}</h2>
      {note && <span className="text-[11px] font-medium text-gray-400">{note}</span>}
    </div>
  );
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
  const navigate = useNavigate();
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
      skill: SPEAKING_SOURCES.has(s.source || '') ? 'speaking' : 'writing',
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
      // A comprehension paper records no CEFR level, so it names the paper it
      // was — "Test 7" is true, and an invented level would not be.
      label: t('dash.testN', { n: r.test_number }),
      errors: Math.max(0, (r.total || 0) - (r.score || 0)),
      href: null,
    }));
    return [...fromSubs,
      ...fromPapers(reading, 'reading', 'reading_attempt_id'),
      ...fromPapers(listening, 'listening', 'listening_attempt_id')]
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [subs, reading, listening, t]);

  const filtered = useMemo(() => {
    const cutoff = days ? Date.now() - days * 86400000 : null;
    return attempts.filter((a) => {
      if (skill !== 'all' && a.skill !== skill) return false;
      if (cutoff && new Date(a.at).getTime() < cutoff) return false;
      return true;
    });
  }, [attempts, skill, days]);

  const average = useMemo(() => {
    const scored = filtered.filter((a) => typeof a.score === 'number');
    if (!scored.length) return null;
    return Math.round((scored.reduce((s, a) => s + a.score, 0) / scored.length) * 10) / 10;
  }, [filtered]);

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

  const tone = TONE[skill];
  const skillName = t(SKILLS.find((s) => s.id === skill).key);
  const aiGraded = AI_GRADED.has(skill);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <Seo titleKey="seo.dashboard.title" path="/dashboard" noindex />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-extrabold tracking-tight text-gray-900">
          {t('dash.title')}
        </h1>
        <Link to="/invoices" className="btn-outline !px-4 !py-2 text-sm"
          data-testid="dashboard-invoices">
          <Receipt size={16} /> {t('inv.title')}
        </Link>
      </div>

      {/* FILTER BAR — the four papers and the window, in one row, because they
          answer one question together: which attempts am I looking at. */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-3 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" data-testid="dash-skill">
            {SKILLS.map(({ id, key, Icon, tone: c }) => {
              const on = skill === id;
              return (
                <button key={id} type="button" role="tab" aria-selected={on}
                  onClick={() => setSkill(id)} data-testid={`dash-skill-${id}`}
                  style={on ? { backgroundColor: c, borderColor: c } : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
                    on ? 'text-white shadow-sm'
                       : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                  <Icon size={15} weight="fill" /> {t(key)}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5" data-testid="dash-range">
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

      {/* STAT CARDS. Attempts and average follow the filters; the streaks are
          all-time by definition — a streak inside a 7-day window is not one. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('dash.statAttempts'), filtered.length, ChartLineUp, tone, true],
          [t('dash.statAverage'), average == null ? '—' : average, null, null, true],
          [t('dash.statStreak'), stats.current_streak, Fire, '#F97316', false],
          [t('dash.statBest'), stats.longest_streak, Trophy, '#D97706', false],
        ].map(([label, value, Icon, colour, follows]) => (
          <div key={label} className="card p-5">
            <p className="flex items-center gap-2 text-[13px] font-medium text-gray-500">
              {Icon ? <Icon size={17} weight="fill" style={{ color: colour }} /> : null}
              {label}
            </p>
            <p className="mt-1.5 font-heading text-[32px] font-extrabold leading-none tracking-tight text-gray-900">
              {value}
            </p>
            <p className="mt-1.5 text-[11px] text-gray-400">
              {follows ? skillName : t('dash.allTime')}
            </p>
          </div>
        ))}
      </div>

      {mistakes?.narrative && (
        <div className="mt-5 rounded-2xl border-l-4 border-l-green-500 bg-green-50/60 px-5 py-4 text-sm font-medium text-green-800"
          data-testid="progress-narrative">
          {mistakes.narrative}
        </div>
      )}

      {/* WEAK POINTS + RECURRING — the original 2/3 + 1/3 split, kept. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <Head title={t('dash.weakPoints')} note={t('dash.basedOn')} />
          {!aiGraded ? <NotForSkill>{t('dash.aiGradedOnly', { skill: skillName })}</NotForSkill> : mistakes?.weak_points?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {mistakes.weak_points.map((w) => (
                <div key={w.category}
                  className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 transition hover:border-violet-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="pill" style={{ background: CATEGORY_META[w.category]?.color }}>
                      {w.label} · {w.count}
                    </span>
                    <button className="btn-primary !px-3 !py-1.5 text-xs"
                      onClick={() => navigate(`/review?category=${w.category}`)}
                      data-testid={`review-${w.category}`}>
                      <GameController size={14} weight="fill" /> {t('dash.reviewCategory')}
                    </button>
                  </div>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-gray-600">{w.tip}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              {t('dash.noErrors')}
            </p>
          )}
        </section>

        <section className="card p-6">
          <Head title={t('dash.recurring')} />
          {!aiGraded ? <NotForSkill>{t('dash.aiGradedOnly', { skill: skillName })}</NotForSkill> : mistakes?.repeat_leaders?.length ? (
            <ul className="space-y-2.5 text-[13px]">
              {mistakes.repeat_leaders.slice(0, 6).map((m) => (
                <li key={m.mistake_id} className="rounded-xl bg-gray-50 p-3 leading-relaxed">
                  <span className="text-red-600 line-through decoration-1">{m.error_text}</span>
                  {' → '}
                  <span className="font-semibold text-green-700">{m.correction}</span>
                  <span className="ml-1.5 text-[11px] tabular-nums text-gray-400">
                    ×{m.times_repeated + 1}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              {t('dash.noRecurring')}
            </p>
          )}
        </section>
      </div>

      {/* SPEAKING PAPERS — three tâches read as one result, which is the way
          the exam reports Expression orale and the only way this page ever
          shows a combined mark. */}
      {(sittings.length > 0 || marking) && (
        <section className="card mt-5 p-6" data-testid="dash-speaking-tests">
          <Head title={t('dash.speakingTests')} note={t('dash.speakingTestsNote')} />
          {marking && !sittings[0]?.complete && (
            <p className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs text-primary"
              data-testid="dash-marking">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-primary" />
              {t('dash.markingNow')}
            </p>
          )}
          <div className="space-y-2">
            {sittings.map((sit) => {
              const tasks = [1, 2, 3].map((n) => sit.tasks[String(n)] || null);
              // The same arithmetic the exam page does, from the same helper —
              // there is one conversion table and it lives in lib/tcf.js.
              const paper = sit.complete ? speakingPaperMark(tasks) : null;
              const answered = tasks.filter(Boolean).length;
              return (
                <Link key={sit.set_number} to={`/speaking/test?set=${sit.set_number}`}
                  data-testid={`dash-sitting-${sit.set_number}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 px-4 py-3 transition hover:border-violet-200 hover:bg-violet-50/40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-100 font-heading text-sm font-extrabold text-pink-700">
                    {sit.set_number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-heading text-sm font-bold text-gray-900">
                      {t('dash.speakingSet', { n: sit.set_number })}
                    </span>
                    <span className="block text-[11px] text-gray-500">
                      {tasks.map((task, i) => (
                        <span key={i} className="mr-2">
                          {t('hist.tache', { n: i + 1 })} {task ? task.tcf_level : '—'}
                        </span>
                      ))}
                    </span>
                  </span>
                  {paper ? (
                    <span className="flex items-center gap-2">
                      <span className="font-heading text-lg font-extrabold text-gray-900">
                        {paper.mark}<span className="text-xs text-gray-400">/20</span>
                      </span>
                      {paper.nclc && (
                        <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-700">
                          {t('sexam.clb', { level: paper.nclc })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                      {t('dash.speakingPartial', { done: answered, total: 3 })}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* HISTORY — now covers all four papers, so which paper an attempt was
          is a column rather than something the reader has to infer. */}
      <section className="card mt-5 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-6 pb-4">
          <h2 className="font-heading text-[15px] font-bold text-gray-900">{t('dash.history')}</h2>
          <span className="text-[11px] font-medium text-gray-400">
            {t('dash.nAttempts', { n: filtered.length })}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="bg-gray-50 text-left text-[10.5px] uppercase tracking-wide text-gray-500">
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
