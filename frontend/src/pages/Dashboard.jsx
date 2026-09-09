import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Receipt, Fire, Trophy, GameController, BookOpen, Headphones,
  PenNib, Microphone, Stack, ChartLineUp, Info,
} from '@phosphor-icons/react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, LineChart, Line,
} from 'recharts';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

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
  const navigate = useNavigate();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  /* Three sources, one shape. Submissions carry a score already out of 100;
     a comprehension paper carries `score` out of `total`, so it is converted
     rather than plotted on an axis it does not share — 34/40 and 68/100 are
     the same performance and belong at the same height. */
  const attempts = useMemo(() => {
    const fromSubs = (subs || []).map((s) => ({
      id: s.submission_id,
      at: s.created_at,
      skill: SPEAKING_SOURCES.has(s.source || '') ? 'speaking' : 'writing',
      score: typeof s.overall_score === 'number' ? s.overall_score : null,
      label: s.tcf_level || '—',
      errors: s.error_count ?? 0,
      href: `/feedback/${s.submission_id}`,
    }));
    const fromPapers = (rows, kind, idKey) => (rows || []).map((r) => ({
      id: r[idKey],
      at: r.created_at,
      skill: kind,
      score: r.total ? Math.round((r.score / r.total) * 100) : null,
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

  // Oldest first, so the chart reads left to right in time order.
  const trend = useMemo(() => [...filtered]
    .filter((a) => typeof a.score === 'number')
    .reverse()
    .map((a) => ({ date: (a.at || '').slice(5, 10), score: a.score })),
  [filtered]);

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

  const breakdownData = Object.entries(stats.error_breakdown).map(([k, v]) => ({
    name: CATEGORY_META[k]?.label || k, count: v, color: CATEGORY_META[k]?.color || '#ddd',
  }));
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

      {/* CHARTS — the original pairing, kept. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-6">
          <Head title={`${t('dash.scoreTrend')} · ${skillName}`}
            note={trend.length ? t('dash.nAttempts', { n: trend.length }) : null} />
          {trend.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={tone} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={tone} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EFEDF3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid #E7E2F0', fontSize: 12 }} />
                  <Area type="monotone" dataKey="score" stroke={tone} strokeWidth={2}
                    fill="url(#dashGrad)" dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              {t('dash.noDataPeriod')}
            </p>
          )}
        </section>

        <section className="card p-6">
          <Head title={t('dash.errorsByCategory')} note={t('dash.allTime')} />
          {!aiGraded ? <NotForSkill>{t('dash.aiGradedOnly', { skill: skillName })}</NotForSkill> : breakdownData.some((d) => d.count > 0) ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={breakdownData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EFEDF3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval={0}
                    angle={-20} textAnchor="end" height={62} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    axisLine={false} tickLine={false} width={44} />
                  <Tooltip cursor={{ fill: '#F7F5FB' }}
                    contentStyle={{ borderRadius: 10, border: '1px solid #E7E2F0', fontSize: 12 }} />
                  <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                    {breakdownData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              {t('dash.noErrors')}
            </p>
          )}
        </section>
      </div>

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

      {aiGraded && mistakes?.trend?.length > 1 && (
        <section className="card mt-5 p-6">
          <Head title={t('dash.errorsPer100')} note={t('dash.normalised')} />
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={mistakes.trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEDF3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={44} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #E7E2F0', fontSize: 12 }} />
                <Line type="monotone" dataKey="errors_per_100_words" stroke="#7C3AED"
                  strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
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
              {filtered.map((a) => (
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
                    {a.href
                      ? <Link to={a.href} className="font-semibold text-primary">{t('dash.view')}</Link>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
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
