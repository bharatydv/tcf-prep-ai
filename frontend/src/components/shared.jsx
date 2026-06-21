import { useState, useRef } from 'react';
import { Link, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { PenNib, Fire, SignOut, List, X, SquaresFour } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { ACCENTS, CATEGORY_META } from '../lib/api';

/* ------------------------------------------------------------- Header ---- */
export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/speaking', label: 'Speaking Lab' },
    { to: '/practice', label: 'Writing Assistant' },
    { to: '/exam/reading-comprehension', label: 'Mock Exams' },
    { to: '/recent-topics', label: 'Resources' },
    { to: '/blog', label: 'Blog' },
  ];

  return (
    <header className="glass sticky top-0 z-50 border-b border-gray-100">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2" data-testid="logo-link">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
            <PenNib size={20} weight="fill" />
          </span>
          <span className="font-heading text-lg font-bold">TCF Prep AI</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) => `text-sm font-medium transition ${isActive ? 'text-primary' : 'text-gray-600 hover:text-primary'}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <>
              {user.current_streak > 0 && (
                <span className="pill bg-orange-50 text-orange-600" title="Daily streak">
                  <Fire size={14} weight="fill" /> {user.current_streak}
                </span>
              )}
              <Link to="/dashboard"
                className="btn-outline !px-3 !py-1.5 text-sm" data-testid="header-dashboard">
                <SquaresFour size={16} weight="fill" /> Dashboard
              </Link>
              <Link to={user.role === 'admin' ? '/admin' : '/dashboard'}
                className="text-sm font-semibold text-gray-700 hover:text-primary" data-testid="user-menu">
                {user.name?.split(' ')[0]}
              </Link>
              <button onClick={async () => { await logout(); navigate('/'); }}
                className="btn-outline !px-3 !py-1.5 text-sm" data-testid="logout-button">
                <SignOut size={16} /> Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-semibold text-gray-700 hover:text-primary" data-testid="header-login">Log in</Link>
              <Link to="/register" className="btn-primary !py-2 text-sm" data-testid="header-register">Start Free Trial</Link>
            </>
          )}
        </div>

        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X size={24} /> : <List size={24} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-white px-4 py-3 md:hidden">
          {links.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block py-2 text-sm font-medium text-gray-700">{l.label}</Link>
          ))}
          {user ? (
            <>
              <Link to="/dashboard" onClick={() => setOpen(false)} className="block py-2 text-sm font-medium">Dashboard</Link>
              <button onClick={async () => { await logout(); setOpen(false); navigate('/'); }} className="py-2 text-sm font-medium text-red-600">Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" onClick={() => setOpen(false)} className="block py-2 text-sm font-medium">Log in</Link>
              <Link to="/register" onClick={() => setOpen(false)} className="block py-2 text-sm font-semibold text-primary">Start Free Trial</Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}

/* ----------------------------------------------------- ProtectedRoute ---- */
export function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

/* ------------------------------------------------------ AccentToolbar ---- */
export function AccentToolbar({ textareaRef, onInsert }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-gray-200 bg-gray-50 p-2" data-testid="accent-toolbar">
      {ACCENTS.map((c) => (
        <button key={c} type="button"
          className="h-8 w-8 rounded-lg bg-white text-sm font-medium shadow-sm transition hover:bg-primary hover:text-white"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const ta = textareaRef?.current;
            if (!ta) return onInsert?.(c);
            const start = ta.selectionStart ?? ta.value.length;
            const end = ta.selectionEnd ?? start;
            const next = ta.value.slice(0, start) + c + ta.value.slice(end);
            onInsert(c, next, start + c.length);
            requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + c.length, start + c.length); });
          }}>
          {c}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------- AnalysisProgress ---- */
const STAGES = [
  ['parsing', 'Lecture du texte'],
  ['grammar', 'Analyse grammaticale'],
  ['spelling', 'Vérification de l’orthographe'],
  ['conjugation', 'Contrôle des conjugaisons'],
  ['style', 'Évaluation du style'],
  ['generating', 'Génération du rapport'],
];

export function AnalysisProgress({ current }) {
  const idx = STAGES.findIndex(([k]) => k === current);
  return (
    <div className="card mx-auto max-w-md p-6" data-testid="analysis-progress">
      <h3 className="mb-4 font-heading text-lg font-semibold">Analyse en cours…</h3>
      <ul className="space-y-3">
        {STAGES.map(([key, label], i) => {
          const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
          return (
            <li key={key} className="flex items-center gap-3 text-sm">
              {state === 'done' && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[10px] text-white">✓</span>}
              {state === 'active' && <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-primary" />}
              {state === 'todo' && <span className="h-5 w-5 rounded-full border-2 border-gray-200" />}
              <span className={state === 'todo' ? 'text-gray-400' : state === 'active' ? 'font-semibold text-primary' : 'text-gray-700'}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------ Streaming SSE helper ---- */
export async function streamAnalysis(backendUrl, payload, { onStage, onComplete, onError }) {
  const res = await fetch(`${backendUrl}/api/analyze/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    let detail = 'Analysis failed';
    try { const j = await res.json(); detail = typeof j.detail === 'string' ? j.detail : detail; } catch {}
    onError?.(detail, res.status);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop();
    for (const ev of events) {
      const type = (ev.match(/^event: (.+)$/m) || [])[1];
      const data = (ev.match(/^data: (.+)$/m) || [])[1];
      if (!type || !data) continue;
      const parsed = JSON.parse(data);
      if (type === 'stage') onStage?.(parsed.stage);
      else if (type === 'complete') onComplete?.(parsed);
      else if (type === 'error') onError?.(parsed.detail);
    }
  }
}

/* ----------------------------------------------- ErrorHighlightedText ---- */
export function ErrorHighlightedText({ text, errors }) {
  // Build non-overlapping highlight segments
  const marks = [];
  const taken = [];
  (errors || []).forEach((e, i) => {
    if (!e.error) return;
    let from = 0;
    while (true) {
      const pos = text.indexOf(e.error, from);
      if (pos === -1) break;
      const end = pos + e.error.length;
      const overlaps = taken.some(([s, t]) => pos < t && end > s);
      if (!overlaps) { marks.push({ start: pos, end, err: e, idx: i }); taken.push([pos, end]); break; }
      from = end;
    }
  });
  marks.sort((a, b) => a.start - b.start);

  const parts = [];
  let cursor = 0;
  marks.forEach((m, k) => {
    if (m.start > cursor) parts.push(<span key={`t${k}`}>{text.slice(cursor, m.start)}</span>);
    const meta = CATEGORY_META[m.err.category] || CATEGORY_META.spelling;
    parts.push(
      <span key={`m${k}`} className="err-mark" style={{ background: meta.color }} data-testid={`error-mark-${m.idx}`}>
        {text.slice(m.start, m.end)}
        <span className="err-tip">
          <strong className="block text-emerald-300">→ {m.err.correction}</strong>
          <span className="mt-1 block text-gray-300">{m.err.explanation}</span>
          <span className="mt-1 block text-[10px] uppercase tracking-wide text-gray-400">{meta.label}</span>
        </span>
      </span>
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <p className="whitespace-pre-wrap leading-8">{parts}</p>;
}

/* ------------------------------------------------------------ Heatmap ---- */
export function Heatmap({ data }) {
  const days = [];
  const today = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, count: data?.[key] || 0 });
  }
  // pad so columns are full weeks starting Sunday
  const firstDow = new Date(days[0].key).getDay();
  const padded = Array(firstDow).fill(null).concat(days);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  const color = (c) => (c === 0 ? '#F3F4F6' : c === 1 ? '#DDD6FE' : c === 2 ? '#A78BFA' : c <= 4 ? '#7C3AED' : '#5B21B6');
  return (
    <div className="overflow-x-auto pb-2" data-testid="heatmap">
      <div className="flex gap-[3px]">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }).map((_, di) => {
              const d = w[di];
              return <div key={di} title={d ? `${d.key}: ${d.count}` : ''}
                className="h-[11px] w-[11px] rounded-[3px]"
                style={{ background: d ? color(d.count) : 'transparent' }} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* useTextInsert: shared cursor-insert state helper for writing surfaces */
export function useWritingBox(initial = '') {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  const insert = (_c, next) => { if (next !== undefined) setValue(next); };
  return { value, setValue, ref, insert };
}