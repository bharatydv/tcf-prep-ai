/* The behavioural half of the admin panel.
 *
 * The Analytics tab that already existed answers "is the content any good" —
 * how many submissions, which error categories, the most repeated mistakes.
 * That is a real question and it is untouched; it moved to a tab called
 * Content. This file answers the other one: what do people actually do, in
 * what order, and where do they stop.
 *
 * It reads the first-party events table and nothing else. GA4 cannot answer
 * any of this: its export is sampled and aggregated, it cannot be joined to an
 * account, and roughly a fifth of the audience blocks it outright. The events
 * in usage_events were recorded by our own server on our own domain, so the
 * numbers here are the ones to act on and GA4 is the cross-check.
 *
 * Its own file rather than more of Admin.jsx, which is already a thousand
 * lines. Admin.jsx gains one import and one tab.
 *
 * Strings are literal English rather than i18n keys. The site is English-only
 * (see the note in public/index.html), this panel is admin-only, and most of
 * the labels here are event names out of the taxonomy — `practice_start` is
 * not a word that should be translated, because it is a key in a database.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';

const SUB_TABS = [
  ['overview', 'Overview'],
  ['funnel', 'Funnel'],
  ['users', 'Users'],
  ['skills', 'Skills'],
  ['exams', 'Exams'],
  ['countries', 'Countries'],
  ['retention', 'Retention'],
  ['events', 'Events'],
];

/* The presets the backend accepts, and nothing else — a range it cannot parse
   comes back as a 400 rather than silently becoming the default. */
const PRESETS = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['28d', '28 days'],
  ['90d', '90 days'],
  ['custom', 'Custom'],
];

const SKILLS = ['reading', 'listening', 'writing', 'speaking'];
const EXAMS = ['tcf', 'tef'];
const LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

const Spinner = () => (
  <div className="flex justify-center py-16">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
  </div>
);

const Stat = ({ label, value, hint }) => (
  <div className="card p-5">
    <p className="text-sm text-gray-500">{label}</p>
    <p className="mt-1 font-heading text-3xl font-bold">{value ?? '—'}</p>
    {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
  </div>
);

const Empty = ({ children }) => (
  <p className="py-10 text-center text-sm text-gray-500">{children}</p>
);

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : (n ?? '—'));
const pct = (n) => (typeof n === 'number' ? `${n}%` : '—');
const when = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

/* One date filter, shared by every sub-tab, so switching between them keeps
   the window the admin was looking at instead of silently resetting it. */
function RangePicker({ range, onChange }) {
  const set = (patch) => onChange({ ...range, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(([id, label]) => (
        <button key={id} onClick={() => set({ preset: id })}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            range.preset === id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          data-testid={`range-${id}`}>
          {label}
        </button>
      ))}
      {range.preset === 'custom' && (
        <span className="flex items-center gap-2 text-xs">
          <input type="date" value={range.start || ''} max={range.end || undefined}
            onChange={(e) => set({ start: e.target.value })}
            className="rounded-lg border border-gray-200 px-2 py-1" />
          <span className="text-gray-400">to</span>
          <input type="date" value={range.end || ''} min={range.start || undefined}
            onChange={(e) => set({ end: e.target.value })}
            className="rounded-lg border border-gray-200 px-2 py-1" />
        </span>
      )}
    </div>
  );
}

/* Every panel loads the same way: build a query string, fetch, show a spinner,
   surface the server's own error text rather than a generic one — a 400 from
   the range validator says exactly what was wrong with the dates and that is
   worth putting on screen. */
function useAnalytics(path, params, ready = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(ready);
  const query = useMemo(() => {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') qs.set(k, v);
    });
    return qs.toString();
  }, [params]);

  useEffect(() => {
    if (!ready) { setData(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.get(`/api/admin/analytics/${path}?${query}`)
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        toast.error(errMsg(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, query, ready]);

  return { data, loading };
}

/* ------------------------------------------------------------- Overview --- */
function Overview({ range }) {
  const { data, loading } = useAnalytics('overview', range);
  if (loading) return <Spinner />;
  if (!data) return <Empty>Nothing to show for this range.</Empty>;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visitors" value={fmt(data.visitors)}
          hint="accounts and browsers, counted once each" />
        <Stat label="Active users" value={fmt(data.active_users)}
          hint="signed in, did something" />
        <Stat label="Sessions" value={fmt(data.sessions)} hint="30-minute window" />
        <Stat label="Signups" value={fmt(data.signups)} />
        <Stat label="Practices started" value={fmt(data.practices_started)} />
        <Stat label="Practices completed" value={fmt(data.practices_completed)} />
        <Stat label="Checkout starts" value={fmt(data.checkout_starts)} />
        <Stat label="Purchases" value={fmt(data.purchases)}
          hint={`${fmt(data.purchase_events)} confirmed payments`} />
      </div>
      <p className="mt-6 text-xs text-gray-400">
        Every figure counts people, not hits: one person reloading the pricing
        page six times is one person considering it. A person is the account
        where there is one and the browser where there is not.
      </p>
    </>
  );
}

/* --------------------------------------------------------------- Funnel --- */
function Funnel({ range }) {
  const { data, loading } = useAnalytics('funnel', range);
  if (loading) return <Spinner />;
  const steps = data?.steps || [];
  const top = steps[0]?.people || 0;
  if (!steps.length) return <Empty>No events recorded in this range.</Empty>;
  return (
    <>
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={s.step} className="card p-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-heading font-semibold">{s.label}</span>
              <span className="text-sm text-gray-500">
                {fmt(s.people)} people · {fmt(s.hits)} events
                {i > 0 && (
                  <span className="ml-3 font-semibold text-primary">
                    {pct(s.conversion_from_previous)} from {steps[i - 1].label}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-600"
                style={{ width: top ? `${Math.min(100, (s.people / top) * 100)}%` : '0%' }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-gray-400">
        Conversion is measured against the step immediately above, not against
        the top. These are recorded events, not a model or a projection — and a
        step can exceed the one before it, because somebody can land straight on
        a practice page from a search result without ever seeing the home page.
      </p>
    </>
  );
}

/* ------------------------------------------------------------- Visitors --- */
/* Everyone who has been here, not only the ones who signed up.
 *
 * Anonymous visitors are most of the funnel, and a directory that listed only
 * accounts would describe the people who already converted and quietly call
 * that the visitor population. An anonymous visitor is an anon_id and nothing
 * else: a random string their own browser stores. No address, no device
 * fingerprint, no IP — none of which this application has ever collected.
 */

const KINDS = [
  ['all', 'All'],
  ['registered', 'Registered'],
  ['anonymous', 'Anonymous'],
  ['paid', 'Paid'],
  ['free', 'Free'],
];

const KIND_STYLE = {
  registered: 'bg-violet-100 text-violet-700',
  anonymous: 'bg-gray-200 text-gray-600',
};

function Visitors({ range }) {
  // `All` by default, deliberately: the complete population is the honest
  // starting point, and anything narrower is a question the admin has to
  // choose to ask.
  const [kind, setKind] = useState('all');
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const LIMIT = 50;

  const params = useMemo(
    () => ({ ...range, kind, q: query, limit: LIMIT, offset }),
    [range, kind, query, offset]);
  const { data, loading } = useAnalytics('visitors', params, !open);

  useEffect(() => { setOffset(0); }, [kind, query, range]);

  if (open) {
    return <Journey range={range} subject={open} onBack={() => setOpen(null)} />;
  }

  const rows = data?.visitors || [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {KINDS.map(([id, label]) => (
            <button key={id} onClick={() => setKind(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                kind === id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              data-testid={`visitors-kind-${id}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={term} onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQuery(term)}
            placeholder="Name, email or visitor id"
            className="w-64 rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
          <button onClick={() => setQuery(term)} className="btn-outline text-xs">Search</button>
        </div>
      </div>

      {loading && <Spinner />}
      {!loading && !rows.length && <Empty>Nobody matches these filters.</Empty>}

      {!loading && rows.length > 0 && (
        <>
          <div className="mt-4 card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Visitor</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">First seen</th>
                  <th className="px-4 py-3">Last seen</th>
                  <th className="px-4 py-3 text-right">Sessions</th>
                  <th className="px-4 py-3 text-right">Events</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={`${v.kind}:${v.id}`}
                    onClick={() => setOpen(v)}
                    className="cursor-pointer border-t border-gray-100 hover:bg-violet-50/60"
                    data-testid={`visitor-${v.id}`}>
                    <td className="px-4 py-3">
                      <span className={`pill mr-2 text-[10px] ${KIND_STYLE[v.kind] || ''}`}>
                        {v.kind === 'anonymous' ? 'anon' : (v.subscription_status || 'free')}
                      </span>
                      <span className="font-semibold">{v.label}</span>
                      {v.email && <span className="ml-2 text-xs text-gray-500">{v.email}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{v.country}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-gray-500">{when(v.first_seen)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-gray-500">{when(v.last_seen)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(v.sessions)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(v.events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="btn-outline text-xs disabled:opacity-40">Previous</button>
            <span className="text-xs text-gray-500">
              {offset + 1}–{Math.min(offset + LIMIT, data.total || 0)} of {fmt(data.total)}
            </span>
            <button disabled={offset + LIMIT >= (data.total || 0)}
              onClick={() => setOffset(offset + LIMIT)}
              className="btn-outline text-xs disabled:opacity-40">Next</button>
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-gray-400">
        An anonymous visitor is a browser, identified only by the random id that
        browser stores for itself — never an address, a device fingerprint or an
        IP. Registered accounts appear even when they have generated no events
        at all, with no first or last seen. Every event belongs to exactly one
        row here: the account that was signed in, or the account that browser
        has been proven to belong to, or the browser itself.
      </p>
    </>
  );
}

/* --------------------------------------------------------- User Journey --- */
/* One visitor, in order. Works from either end: an account, or the browser
 * that was reading long before there was an account.
 *
 * The three bands are the point of the screen. What somebody read BEFORE they
 * were willing to give an email address is the part that explains why they
 * signed up, and it is the part no analytics tool that starts at the signup
 * form can show at all.
 */
const PHASE_BANDS = {
  anonymous: { title: 'BEFORE SIGNUP', note: 'Anonymous activity' },
  identity: { title: 'SIGNUP / LOGIN', note: 'The browser and the account become one person' },
  identified: { title: 'AFTER SIGNUP', note: 'Registered activity' },
};

function Journey({ range, subject, onBack }) {
  const [filters, setFilters] = useState({ event: '', skill: '', exam: '', level: '' });
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const params = useMemo(() => ({
    ...range,
    ...filters,
    // One or the other, never both — the server refuses the ambiguity.
    ...(subject.kind === 'anonymous'
      ? { anon_id: subject.id }
      : { user_id: subject.id }),
    limit: LIMIT,
    offset,
  }), [range, filters, subject, offset]);

  const { data, loading } = useAnalytics('journey', params);
  useEffect(() => { setOffset(0); }, [subject, filters, range]);

  const who = data?.subject;
  // Memoised, not `data?.events || []`: that fallback is a new array on every
  // render, which would rebuild the trail below on every render too.
  const events = useMemo(() => data?.events || [], [data]);

  // The page-by-page trail, which is what the journey is actually for. Built
  // from the rows already on screen, consecutive repeats collapsed, so it
  // reads as a route rather than a log.
  const trail = useMemo(() => {
    const out = [];
    events.forEach((e) => {
      if (e.page && out[out.length - 1] !== e.page) out.push(e.page);
    });
    return out.slice(0, 12);
  }, [events]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="btn-outline text-xs">← All visitors</button>
        <div className="flex flex-wrap gap-2">
          <select value={filters.skill}
            onChange={(e) => setFilters({ ...filters, skill: e.target.value })}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="">Any skill</option>
            {SKILLS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={filters.exam}
            onChange={(e) => setFilters({ ...filters, exam: e.target.value })}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="">Any exam</option>
            {EXAMS.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select>
          <select value={filters.level}
            onChange={(e) => setFilters({ ...filters, level: e.target.value })}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="">Any level</option>
            {LEVELS.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      {loading && <Spinner />}

      {!loading && who && (
        <>
          <div className="mt-4 card p-4 text-sm">
            <p className="font-heading text-lg font-bold">{who.label}</p>
            <p className="mt-1 text-xs text-gray-500">
              {who.kind === 'anonymous' ? 'Anonymous browser' : who.email}
              {' · '}{who.country}
              {who.joined_at && <> · joined {when(who.joined_at)}</>}
              {who.subscription_status && <> · {who.subscription_status}</>}
              {' · '}{fmt(data.total)} events
              {data.stitched_anon_ids > 0 && (
                <> · {data.stitched_anon_ids} pre-signup browser
                  {data.stitched_anon_ids === 1 ? '' : 's'} stitched in</>
              )}
            </p>
            {who.kind === 'anonymous' && who.linked_user_id && (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                This browser went on to sign in as{' '}
                <span className="font-semibold">{who.linked_user_label}</span>,
                and has never been used for any other account — so the activity
                below is one continuous journey.
              </p>
            )}
            {who.kind === 'anonymous' && !who.linked_user_id && (
              <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Not linked to any account. Either this visitor never signed in,
                or the browser has been used for more than one account — in
                which case the journeys are deliberately kept apart rather than
                guessed at.
              </p>
            )}
          </div>

          {trail.length > 0 && (
            <div className="mt-4 card p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Path</p>
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                {trail.map((page, i) => (
                  <span key={`${page}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-300">→</span>}
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold">{page}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {!events.length && <Empty>No events in this range.</Empty>}

          {events.length > 0 && (
            <ol className="mt-4">
              {events.map((e, i) => {
                const band = e.phase !== events[i - 1]?.phase ? PHASE_BANDS[e.phase] : null;
                return (
                  <li key={e.id}>
                    {band && (
                      <div className="mt-4 flex items-center gap-3 first:mt-0">
                        <span className={`rounded-full px-3 py-1 text-[10px] font-bold tracking-widest ${
                          e.phase === 'identity' ? 'bg-primary text-white'
                            : e.phase === 'identified' ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-gray-200 text-gray-600'}`}>
                          {band.title}
                        </span>
                        <span className="text-xs text-gray-400">{band.note}</span>
                        <span className="h-px flex-1 bg-gray-200" />
                      </div>
                    )}
                    <div className={`mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border-l-2 px-3 py-2 text-sm ${
                      e.phase === 'identity' ? 'border-primary bg-violet-50'
                        : e.phase === 'identified' ? 'border-emerald-200' : 'border-gray-200'}`}>
                      <span className="w-40 shrink-0 tabular-nums text-xs text-gray-500">{when(e.at)}</span>
                      <span className="font-semibold text-primary">{e.event}</span>
                      {e.page && <span className="text-xs text-gray-500">{e.page}</span>}
                      {e.skill && <span className="pill bg-violet-100 text-xs">{e.skill}</span>}
                      {e.exam && <span className="pill bg-sky-100 text-xs">{e.exam}</span>}
                      {e.level && <span className="pill bg-emerald-100 text-xs">{e.level}</span>}
                      {e.plan && <span className="pill bg-amber-100 text-xs">{e.plan}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-4 flex items-center justify-between text-sm">
            <button disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="btn-outline text-xs disabled:opacity-40">Previous</button>
            <span className="text-xs text-gray-500">
              {offset + 1}–{Math.min(offset + LIMIT, data.total || 0)} of {fmt(data.total)}
            </span>
            <button disabled={offset + LIMIT >= (data.total || 0)}
              onClick={() => setOffset(offset + LIMIT)}
              className="btn-outline text-xs disabled:opacity-40">Next</button>
          </div>

          <p className="mt-4 text-xs text-gray-400">
            Pre-signup activity is shown only when the browser it came from has
            never been used to sign into any other account. On a shared machine
            there is no way to tell who read what, so nothing is attributed
            rather than the wrong thing. Only parameters on the documented
            allowlist are returned: no essays, transcripts, recordings, answer
            sheets, addresses, tokens or payment details.
          </p>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------- Skills / Exams rows ---- */
function Breakdown({ range, dimension, caption }) {
  const { data, loading } = useAnalytics('breakdown', { ...range, dimension });
  if (loading) return <Spinner />;
  const rows = data?.rows || [];
  if (!rows.length) return <Empty>Nothing recorded in this range.</Empty>;
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">{dimension === 'exam' ? 'Exam' : 'Skill'}</th>
              <th className="px-4 py-3 text-right">People</th>
              <th className="px-4 py-3 text-right">Starts</th>
              <th className="px-4 py-3 text-right">Completions</th>
              <th className="px-4 py-3 text-right">Completion rate</th>
              <th className="px-4 py-3 text-right">Results read</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100">
                <td className="px-4 py-3 font-semibold">
                  {dimension === 'exam' ? String(r.key).toUpperCase() : r.key}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(r.people)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(r.starts)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(r.completions)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{pct(r.completion_rate)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(r.results)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-xs text-gray-400">{caption}</p>
    </>
  );
}

/* ------------------------------------------------------------ Countries --- */
function Countries({ range }) {
  const { data, loading } = useAnalytics('breakdown', { ...range, dimension: 'country' });
  if (loading) return <Spinner />;
  const rows = data?.rows || [];
  if (!rows.length) return <Empty>No signed-in activity in this range.</Empty>;
  const total = rows.reduce((n, r) => n + (r.people || 0), 0);
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3 text-right">People</th>
              <th className="px-4 py-3 text-right">Share</th>
              <th className="px-4 py-3 text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100">
                <td className="px-4 py-3 font-semibold">{r.key}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(r.people)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {total ? `${Math.round((r.people / total) * 100)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(r.hits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-xs text-gray-400">
        Derived from the timezone on the account, which the account holder chose
        and we already store. No IP lookup and no precise location: this is
        accurate to a region, never to a person or a place. Signed-in activity
        only, and a timezone that is not in the lookup table reads as Unknown.
      </p>
    </>
  );
}

/* ------------------------------------------------------------ Retention --- */
function Retention({ range }) {
  const { data, loading } = useAnalytics('retention', range);
  if (loading) return <Spinner />;
  const r = data?.retention;
  if (!r || !r.cohort) {
    return <Empty>Nobody signed up in this range, so there is no cohort to follow.</Empty>;
  }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cohort" value={fmt(r.cohort)} hint="signed up in this range" />
        <Stat label="Day 1" value={pct(r.d1_pct)} hint={`${fmt(r.d1)} came back`} />
        <Stat label="Day 7" value={pct(r.d7_pct)} hint={`${fmt(r.d7)} came back`} />
        <Stat label="Day 28" value={pct(r.d28_pct)} hint={`${fmt(r.d28)} came back`} />
      </div>
      <p className="mt-6 text-xs text-gray-400">
        "Came back" means a practice, a completion, a result, a checkout or a
        purchase — deliberately not a page view, because bouncing off a
        marketing page is not somebody returning to study. The windows run from
        each account's own signup, not from calendar days, so cohorts from
        different weeks are measured the same way. The buckets are cumulative:
        anyone in Day 1 is also in Day 7.
      </p>
    </>
  );
}

/* --------------------------------------------------------------- Events --- */
function Events({ range }) {
  const [filters, setFilters] = useState({ event: '', skill: '', exam: '', level: '', user_id: '', session_id: '' });
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;
  const params = useMemo(
    () => ({ ...range, ...filters, limit: LIMIT, offset }), [range, filters, offset]);
  const { data, loading } = useAnalytics('events', params);
  useEffect(() => { setOffset(0); }, [filters, range]);

  const names = (data?.summary || []).map((s) => s.event);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <select value={filters.event} onChange={set('event')}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
          <option value="">Any event</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filters.skill} onChange={set('skill')}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
          <option value="">Any skill</option>
          {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.exam} onChange={set('exam')}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
          <option value="">Any exam</option>
          {EXAMS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
        <select value={filters.level} onChange={set('level')}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
          <option value="">Any level</option>
          {LEVELS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
        <input value={filters.session_id} onChange={set('session_id')}
          placeholder="session id"
          className="w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
        <input value={filters.user_id} onChange={set('user_id')}
          placeholder="user id"
          className="w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
      </div>

      {(data?.summary?.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.summary.slice(0, 16).map((s) => (
            <span key={s.event} className="rounded-full bg-gray-100 px-3 py-1 text-xs">
              <span className="font-semibold">{s.event}</span>
              <span className="ml-2 text-gray-500">{fmt(s.hits)} · {fmt(s.people)} people</span>
            </span>
          ))}
        </div>
      )}

      {loading && <Spinner />}
      {!loading && !data?.events?.length && <Empty>No events match these filters.</Empty>}

      {!loading && data?.events?.length > 0 && (
        <>
          <div className="mt-4 card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Page</th>
                  <th className="px-4 py-3">Context</th>
                  <th className="px-4 py-3">Who</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-gray-500">{when(e.at)}</td>
                    <td className="px-4 py-2 font-semibold text-primary">{e.event}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{e.page || '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {Object.entries(e.meta || {}).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {e.identified ? e.user_id : 'anonymous'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="btn-outline text-xs disabled:opacity-40">Previous</button>
            <span className="text-xs text-gray-500">
              {offset + 1}–{Math.min(offset + LIMIT, data.total || 0)} of {fmt(data.total)}
            </span>
            <button disabled={offset + LIMIT >= (data.total || 0)}
              onClick={() => setOffset(offset + LIMIT)}
              className="btn-outline text-xs disabled:opacity-40">Next</button>
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-gray-400">
        Only parameters on the documented allowlist are returned by the server.
        Essays, transcripts, recordings, answer sheets, addresses, tokens and
        payment details are never written to this table and cannot appear here.
      </p>
    </>
  );
}

/* ----------------------------------------------------------------- Paths --- */
function Paths({ range }) {
  const { data, loading } = useAnalytics('paths', range);
  if (loading) return <Spinner />;
  const paths = data?.paths || [];
  if (!paths.length) return <Empty>No multi-step sessions in this range.</Empty>;
  const top = paths[0]?.sessions || 0;
  return (
    <div className="mt-8">
      <h3 className="font-heading font-semibold">Common paths</h3>
      <p className="mt-1 text-xs text-gray-400">
        What people actually do in one visit, most common first. Consecutive
        repeats are collapsed and each path is cut at ten steps, or every long
        session would be unique and the list would say nothing.
      </p>
      <div className="mt-4 space-y-2">
        {paths.map((p) => (
          <div key={p.path} className="card p-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="flex flex-wrap items-center gap-1 text-xs">
                {p.steps.map((step, i) => (
                  <span key={`${step}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-300">→</span>}
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold">{step}</span>
                  </span>
                ))}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-gray-500">
                {fmt(p.sessions)} sessions
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-primary/60"
                style={{ width: top ? `${Math.min(100, (p.sessions / top) * 100)}%` : '0%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell -- */
export default function AdminAnalytics() {
  const [sub, setSub] = useState('overview');
  const [range, setRange] = useState({ preset: '28d', start: '', end: '' });

  // A custom range is only sent once both ends are filled in; half a range is
  // a 400 from the server and a red toast for no reason.
  const ready = range.preset !== 'custom' || (range.start && range.end);
  const applied = useMemo(() => (
    range.preset === 'custom'
      ? { preset: 'custom', start: range.start, end: range.end }
      : { preset: range.preset }
  ), [range]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {SUB_TABS.map(([id, label]) => (
            <button key={id} onClick={() => setSub(id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                sub === id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              data-testid={`analytics-tab-${id}`}>
              {label}
            </button>
          ))}
        </div>
        <RangePicker range={range} onChange={setRange} />
      </div>

      <div className="mt-6">
        {!ready && <Empty>Pick both ends of the custom range.</Empty>}
        {ready && sub === 'overview' && <Overview range={applied} />}
        {ready && sub === 'funnel' && (
          <>
            <Funnel range={applied} />
            <Paths range={applied} />
          </>
        )}
        {ready && sub === 'users' && <Visitors range={applied} />}
        {ready && sub === 'skills' && (
          <Breakdown range={applied} dimension="skill"
            caption={'Aggregate activity per skill. Completion rate is completions over starts within the range, so a paper begun just before the window and finished inside it counts as a completion with no start — over a week or more that rounds out. These are rates for the product, not a ranking of learners.'} />
        )}
        {ready && sub === 'exams' && (
          <Breakdown range={applied} dimension="exam"
            caption={'Every paper, tâche and rubric in the product today is TCF Canada, and events are tagged accordingly. TEF appears with a zero against it because there is no TEF content to practise yet — that row is the honest answer rather than a missing one, and it will fill in on its own when TEF material is added.'} />
        )}
        {ready && sub === 'countries' && <Countries range={applied} />}
        {ready && sub === 'retention' && <Retention range={applied} />}
        {ready && sub === 'events' && <Events range={applied} />}
      </div>
    </div>
  );
}
