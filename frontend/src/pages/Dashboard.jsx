import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Receipt, Fire, Trophy, GameController, Info, Microphone, PenNib,
  Sparkle, ArrowRight,
} from '@phosphor-icons/react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, LineChart, Line,
} from 'recharts';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { Heatmap } from '../components/shared';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

/* Which `source` values are the spoken ones. The rest are written: the trial
   backfill in server.py splits the same way ("anything not spoken was
   written"), and having two different definitions of "speaking" would make the
   toggle disagree with the credit that was actually spent. */
const SPEAKING_SOURCES = new Set(['speaking', 'conversation']);
const isSpeaking = (s) => SPEAKING_SOURCES.has(s.source || '');

const SKILLS = [
  { id: 'all', labelKey: 'dash.skillAll', Icon: Sparkle },
  { id: 'writing', labelKey: 'dash.skillWriting', Icon: PenNib },
  { id: 'speaking', labelKey: 'dash.skillSpeaking', Icon: Microphone },
];

const RANGES = [
  { days: 7, labelKey: 'dash.range7' },
  { days: 30, labelKey: 'dash.range30' },
  { days: 90, labelKey: 'dash.range90' },
  { days: 0, labelKey: 'dash.rangeAll' },
];

/* An empty card says what is missing and how to fix it, rather than drawing an
   axis with nothing on it. A blank chart reads as a broken page; this reads as
   a next step. */
function Empty({ icon: Icon, title, body, to, cta }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Icon size={20} weight="duotone" />
      </span>
      <p className="mt-3 text-sm font-semibold text-gray-700">{title}</p>
      {body && <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-500">{body}</p>}
      {to && (
        <Link to={to} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          {cta} <ArrowRight size={13} weight="bold" />
        </Link>
      )}
    </div>
  );
}

/* Marks the cards the filters above do NOT reach. Error categories, weak
   points and the heatmap come from their own endpoints, which take no skill or
   date argument, so a card that silently ignored the filter would be lying
   about what it counted. */
function AllTimeTag({ label }) {
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
      {label}
    </span>
  );
}

export default function Dashboard() {
  const t = useT();
  const [stats, setStats] = useState(null);
  const [heatmap, setHeatmap] = useState({});
  const [mistakes, setMistakes] = useState(null);
  const [subs, setSubs] = useState([]);
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
    api.get('/api/dashboard/heatmap').then(({ data }) => setHeatmap(data.heatmap)).catch(() => {});
    api.get('/api/mistakes/summary').then(({ data }) => setMistakes(data)).catch(() => {});
    api.get('/api/submissions').then(({ data }) => setSubs(data.submissions)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  /* The filters are applied here rather than asked of the server, because
     /api/dashboard/stats takes no arguments and returns all-time aggregates.
     Everything below is derived from /api/submissions, which carries
     created_at, source and overall_score per row — enough for these three
     cards, the trend and the table to filter honestly. The cards that cannot
     be derived from it carry AllTimeTag instead of a filter that does
     nothing. */
  const filtered = useMemo(() => {
    const cutoff = days ? Date.now() - days * 86400000 : null;
    return (subs || []).filter((s) => {
      if (skill === 'speaking' && !isSpeaking(s)) return false;
      if (skill === 'writing' && isSpeaking(s)) return false;
      if (cutoff && new Date(s.created_at).getTime() < cutoff) return false;
      return true;
    });
  }, [subs, skill, days]);

  const filteredAvg = useMemo(() => {
    const scored = filtered.filter((s) => typeof s.overall_score === 'number');
    if (!scored.length) return null;
    return Math.round(
      (scored.reduce((a, s) => a + s.overall_score, 0) / scored.length) * 10) / 10;
  }, [filtered]);

  // Oldest first, so the chart reads left to right in time order.
  const trend = useMemo(() => [...filtered]
    .filter((s) => typeof s.overall_score === 'number')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((s) => ({ date: (s.created_at || '').slice(5, 10), score: s.overall_score })),
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
  if (!stats) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  // A brand-new account sees empty charts and a blank heatmap otherwise, which
  // is the least motivating possible first screen.
  if (!stats.total_submissions) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <Seo titleKey="seo.dashboard.title" path="/dashboard" noindex />
        <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('dash.welcome')}</h1>
        <p className="mx-auto mt-3 max-w-lg text-gray-600">
          {t('dash.emptyBody')}
        </p>
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
  const allTime = t('dash.allTime');
  const skillLabel = t(SKILLS.find((s) => s.id === skill).labelKey);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <Seo titleKey="seo.dashboard.title" path="/dashboard" noindex />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold">{t('dash.title')}</h1>
        <Link to="/invoices" className="btn-outline !px-4 !py-2 text-sm"
          data-testid="dashboard-invoices">
          <Receipt size={16} /> {t('inv.title')}
        </Link>
      </div>

      {/* SKILL TOGGLE — one segmented control, centred, because "which skill am
          I looking at" is the first question this page has to answer and it was
          previously unanswerable: everything was pooled. */}
      <div className="mt-6 flex justify-center">
        <div className="inline-flex rounded-full bg-gray-100 p-1" role="tablist"
          data-testid="dash-skill-toggle">
          {SKILLS.map(({ id, labelKey, Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={skill === id}
              onClick={() => setSkill(id)}
              data-testid={`dash-skill-${id}`}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${
                skill === id
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon size={16} weight="fill" /> {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* What the numbers mean, before any of them are read. */}
      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
        <Info size={18} weight="duotone" className="mt-0.5 shrink-0 text-gray-400" />
        <p className="leading-relaxed">{t('dash.scoringNote')}</p>
      </div>

      {/* DATE RANGE */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2"
        data-testid="dash-range">
        {RANGES.map(({ days: d, labelKey }) => (
          <button key={d} type="button" onClick={() => setDays(d)}
            data-testid={`dash-range-${d}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              days === d
                ? 'border-primary bg-primary text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* STAT CARDS. Attempts and average follow the filters; the two streaks
          are all-time by definition — a streak inside a 7-day window is not a
          streak — so they are not tagged, they simply are what they are. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('dash.statSubmissions'), filtered.length, null, null],
          [t('dash.statAverage'), filteredAvg == null ? '—' : filteredAvg, null, null],
          [t('dash.statStreak'), stats.current_streak, Fire, 'text-orange-500'],
          [t('dash.statBest'), stats.longest_streak, Trophy, 'text-amber-500'],
        ].map(([label, value, Icon, tone]) => (
          <div key={label} className="card p-5">
            <p className="flex items-center gap-2 text-sm text-gray-500">
              {Icon ? <Icon size={20} weight="fill" className={tone} /> : null}{label}
            </p>
            <p className="mt-1 font-heading text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {mistakes?.narrative && (
        <div className="card mt-6 border-l-4 border-l-green-500 bg-green-50/50 p-5 text-sm font-medium text-green-800" data-testid="progress-narrative">
          {mistakes.narrative}
        </div>
      )}

      {/* TREND + ACTIVITY FEED. Both follow the filters. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-heading font-semibold">{t('dash.scoreTrend')} — {skillLabel}</h2>
          {trend.length ? (
            <div className="mt-4 h-64">
              <ResponsiveContainer>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="score" stroke="#7C3AED" strokeWidth={2.5} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty icon={Sparkle} title={t('dash.noDataPeriod')}
              body={t('dash.noDataPeriodBody')} />
          )}
        </section>

        <section className="card p-6" data-testid="dash-activity">
          <h2 className="font-heading font-semibold">{t('dash.activity')}</h2>
          {filtered.length ? (
            <ul className="mt-4 space-y-2">
              {filtered.slice(0, 6).map((s) => (
                <li key={s.submission_id}>
                  <Link to={`/feedback/${s.submission_id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-4 py-3 transition hover:border-violet-200 hover:bg-violet-50/40">
                    <span className="flex items-center gap-2.5 text-sm">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isSpeaking(s) ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-primary'}`}>
                        {isSpeaking(s)
                          ? <Microphone size={15} weight="fill" />
                          : <PenNib size={15} weight="fill" />}
                      </span>
                      <span>
                        <span className="font-semibold text-gray-900">{s.tcf_level || '—'}</span>
                        <span className="ml-2 text-xs text-gray-400">
                          {(s.created_at || '').slice(0, 10)}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 font-heading text-sm font-bold tabular-nums text-primary">
                      {s.overall_score ?? '—'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={skill === 'speaking' ? Microphone : PenNib}
              title={t('dash.noAttempts', { skill: skillLabel })}
              body={t('dash.noAttemptsBody')}
              to={skill === 'speaking' ? '/speaking/tasks' : '/practice/tasks'}
              cta={t('dash.startPracticing')} />
          )}
        </section>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Everything below reads its own endpoint, and none of those take a  */}
      {/* skill or date argument — so each is tagged rather than pretending  */}
      {/* to respond to the controls above.                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading font-semibold">{t('dash.errorsByCategory')}</h2>
            <AllTimeTag label={allTime} />
          </div>
          {breakdownData.some((d) => d.count > 0) ? (
            <div className="mt-4 h-64">
              <ResponsiveContainer>
                <BarChart data={breakdownData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {breakdownData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty icon={Sparkle} title={t('dash.noErrors')} />
          )}
        </section>

        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading font-semibold">{t('dash.recurring')}</h2>
            <AllTimeTag label={allTime} />
          </div>
          {mistakes?.repeat_leaders?.length ? (
            <ul className="mt-4 space-y-3 text-sm">
              {mistakes.repeat_leaders.slice(0, 6).map((m) => (
                <li key={m.mistake_id} className="rounded-lg bg-gray-50 p-3">
                  <span className="text-red-600">{m.error_text}</span> → <span className="font-medium text-green-700">{m.correction}</span>
                  <span className="ml-2 text-xs text-gray-400">×{m.times_repeated + 1}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Sparkle} title={t('dash.noRecurring')} />
          )}
        </section>
      </div>

      {/* WEAK POINTS — the reason to come back, so it gets the full width. */}
      <section className="card mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading font-semibold">{t('dash.weakPoints')}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{t('dash.basedOn')}</span>
            <AllTimeTag label={allTime} />
          </div>
        </div>
        {mistakes?.weak_points?.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {mistakes.weak_points.map((w) => (
              <div key={w.category} className="rounded-xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="pill" style={{ background: CATEGORY_META[w.category]?.color }}>{w.label} · {w.count}</span>
                  <button className="btn-primary !px-3 !py-1.5 text-xs"
                    onClick={() => navigate(`/review?category=${w.category}`)} data-testid={`review-${w.category}`}>
                    <GameController size={14} weight="fill" /> {t('dash.reviewCategory')}
                  </button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{w.tip}</p>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={Sparkle} title={t('dash.noErrors')}
            to="/practice/tasks" cta={t('dash.startPracticing')} />
        )}
      </section>

      {mistakes?.trend?.length > 1 && (
        <section className="card mt-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading font-semibold">{t('dash.errorsPer100')}</h2>
            <AllTimeTag label={allTime} />
          </div>
          <p className="text-xs text-gray-400">{t('dash.normalised')}</p>
          <div className="mt-4 h-52">
            <ResponsiveContainer>
              <LineChart data={mistakes.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="errors_per_100_words" stroke="#7C3AED" strokeWidth={2.5} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="card mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading font-semibold">{t('dash.heatmap')}</h2>
          <AllTimeTag label={allTime} />
        </div>
        <div className="mt-4"><Heatmap data={heatmap} /></div>
      </section>

      {/* HISTORY — follows the filters, so the table and the cards above it
          always describe the same set of attempts. */}
      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6">
          <h2 className="font-heading font-semibold">{t('dash.history')}</h2>
          <span className="text-xs text-gray-400">{filtered.length}</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2 sm:px-6">{t('dash.colDate')}</th><th className="px-4 py-2 sm:px-6">{t('dash.colLevel')}</th><th className="px-4 py-2 sm:px-6">{t('dash.colScore')}</th><th className="px-4 py-2 sm:px-6">{t('dash.colErrors')}</th><th className="px-4 py-2 sm:px-6"><span className="sr-only">{t('dash.view')}</span></th></tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.submission_id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums sm:px-6">{s.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-3 font-semibold sm:px-6">{s.tcf_level}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-6">{s.overall_score}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-6">{s.error_count ?? s.errors?.length ?? 0}</td>
                  <td className="px-4 py-3 sm:px-6"><Link to={`/feedback/${s.submission_id}`} className="font-semibold text-primary">{t('dash.view')}</Link></td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan="5" className="px-4 py-6 text-center text-gray-400 sm:px-6">{t('dash.noSubmissions')}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-gray-400">
        {t('common.disclaimerScores')}
      </p>
    </main>
  );
}
