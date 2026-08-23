import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Fire, SignOut, List, X, SquaresFour, ArrowLeft } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { ACCENTS, CATEGORY_META, announcePaywall, paywallDetail } from '../lib/api';
import { FREE_WRITING, WRITING_TASKS, countWords, freeWordStatus, wordStatus } from '../lib/tcf';
import { LANGUAGES, useI18n, useT } from '../i18n';

/* --------------------------------------------------------- ComingSoon ---- */
/* A skill that is not ready yet. Deliberately a full replacement for the page
   body rather than a badge on it: leaving the real controls visible but inert
   is what made Listening look broken instead of unfinished. Delete the call in
   the page when the skill opens; nothing else references it. */
export function ComingSoon({ icon, title, body }) {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-[62vh] max-w-2xl items-center px-4 py-12 sm:px-6">
      <div className="w-full overflow-hidden rounded-3xl border border-violet-100 bg-white text-center shadow-soft">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary to-fuchsia-500" />
        <div className="px-6 py-12">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-violet-100 text-primary">
            {icon}
          </span>
          <span className="mt-5 inline-block rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            {t('common.comingSoon')}
          </span>
          <h1 className="mt-3 font-heading text-2xl font-extrabold text-gray-900">{title}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">{body}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/practice" className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
              {t('common.soonWriting')}
            </Link>
            <Link to="/reading" className="btn-outline">{t('common.soonReading')}</Link>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ----------------------------------------------------------- BackLink ---- */
/* `to` pins a fixed parent; omit it to return wherever the user came from, and
   pass `fallback` for where that should land when there is no history to pop.
   location.key is 'default' only on the first entry of the session, which is
   how we know the page was opened directly rather than navigated to. */
export function BackLink({ to, fallback = '/', label, className = '', testid = 'back-link' }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  const t = useT();

  const go = () => {
    if (to) navigate(to);
    else if (key !== 'default') navigate(-1);
    else navigate(fallback);
  };

  return (
    <button onClick={go} data-testid={testid}
      className={`mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline ${className}`}>
      <ArrowLeft size={16} /> {label || t('common.back')}
    </button>
  );
}

/* ---------------------------------------------------------- LangToggle ---- */
/* Two locales only, so a segmented control beats a dropdown: the alternative
   is always visible and one tap away.
   shrink-0 is load-bearing: the toggle sits in a flex row next to the auth
   buttons, and without it flex compresses the control while `overflow-hidden`
   silently slices the labels off — which strands anyone who cannot read the
   language they are currently in. */
function LangToggle({ lang, setLang }) {
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-violet-200"
      role="group" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button key={l.code} onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          title={l.name}
          data-testid={`lang-${l.code}`}
          className={`shrink-0 px-2.5 py-1 text-xs font-bold transition ${
            lang === l.code ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:text-primary'
          }`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Header ---- */
export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef(null);

  const links = [
    { to: '/speaking', label: t('nav.speaking') },
    { to: '/practice', label: t('nav.writing') },
    { to: '/reading', label: t('nav.reading') },
    { to: '/listening', label: t('nav.listening') },
    { to: '/exam/reading-comprehension', label: t('nav.mockExams') },
    { to: '/resources', label: t('nav.resources') },
  ];
  // Reachable from the footer on a desktop, but the mobile menu was the only
  // navigation on a phone and did not list them.
  const extraLinks = [
    { to: '/blog', label: t('nav.blog') },
    { to: '/pricing', label: t('nav.pricing') },
  ];

  // A menu left open across a navigation covers the page the user just asked
  // for; Escape is the expected way out of any overlay.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); menuButtonRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="glass sticky top-0 z-50 border-b border-gray-100">
      {/* gap-3 between lg and xl, not gap-4. Logo, nav and actions are all
          shrink-0, so at exactly 1024px - where the lg: breakpoint turns the
          desktop layout on - their combined width was 1027px against a 1024px
          container and the whole page scrolled sideways by 3px. Four pixels
          back from each of the two gaps clears it, and xl restores the wider
          spacing once there is room for it. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 xl:gap-4">
        <Link to="/" className="flex shrink-0 items-center" data-testid="logo-link" aria-label="prepfrancais">
          {/* The wordmark used to be hand-authored bezier paths, which meant the
             header and footer copies could drift apart and the letters could not
             be edited. It is set in Poppins now — the same face the headings use —
             keeping the colour split the drawn logo had. */}
          <span aria-hidden="true"
            className="select-none font-heading text-2xl font-extrabold leading-none tracking-tight">
            <span style={{ color: '#7F3BE7' }}>prep</span>
            <span style={{ color: '#211C2B' }}>fran</span>
            <span style={{ color: '#E8179B' }}>c</span>
            <span style={{ color: '#211C2B' }}>ais</span>
          </span>
        </Link>

        <nav className="hidden shrink-0 items-center gap-4 hdr:flex xl:gap-5" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) => `whitespace-nowrap text-sm font-medium transition ${isActive ? 'text-primary' : 'text-gray-600 hover:text-primary'}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-2.5 hdr:flex xl:gap-3">
          <LangToggle lang={lang} setLang={setLang} />
          {user ? (
            <>
              {user.current_streak > 0 && (
                <span className="pill bg-orange-50 text-orange-600" title={t('nav.streakTitle')}>
                  <Fire size={14} weight="fill" /> {user.current_streak}
                </span>
              )}
              <Link to="/dashboard"
                className="btn-outline !px-3 !py-1.5 whitespace-nowrap text-sm" data-testid="header-dashboard">
                <SquaresFour size={16} weight="fill" /> {t('nav.dashboard')}
              </Link>
              <Link to={user.role === 'admin' ? '/admin' : '/dashboard'}
                className="whitespace-nowrap text-sm font-semibold text-gray-700 hover:text-primary" data-testid="user-menu">
                {user.name?.split(' ')[0]}
              </Link>
              <button onClick={async () => { await logout(); navigate('/'); }}
                className="btn-outline !px-3 !py-1.5 whitespace-nowrap text-sm" data-testid="logout-button">
                <SignOut size={16} /> {t('nav.logout')}
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="whitespace-nowrap text-sm font-semibold text-gray-700 hover:text-primary" data-testid="header-login">{t('nav.login')}</Link>
              <Link to="/register" className="btn-primary !py-2 whitespace-nowrap text-sm" data-testid="header-register">{t('nav.register')}</Link>
            </>
          )}
        </div>

        {/* -m-2 keeps the icon where it was while giving the button a 40px
            hit area; a bare 24px icon is under every touch-target guideline. */}
        <button
          ref={menuButtonRef}
          type="button"
          className="-m-2 rounded-lg p-2 text-gray-700 transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hdr:hidden"
          onClick={() => setOpen(!open)}
          aria-label={t('nav.menu')}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          {open ? <X size={24} /> : <List size={24} />}
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-gray-100 bg-white px-4 py-3 hdr:hidden">
          <div className="pb-2"><LangToggle lang={lang} setLang={setLang} /></div>
          {[...links, ...extraLinks].map((l) => (
            <Link key={l.to} to={l.to} className="block py-2.5 text-sm font-medium text-gray-700">{l.label}</Link>
          ))}
          {user ? (
            <>
              {user.current_streak > 0 && (
                <span className="pill my-2 bg-orange-50 text-orange-600" title={t('nav.streakTitle')}>
                  <Fire size={14} weight="fill" /> {user.current_streak}
                </span>
              )}
              <Link to="/dashboard" className="block py-2.5 text-sm font-medium">{t('nav.dashboard')}</Link>
              <Link to="/invoices" className="block py-2.5 text-sm font-medium">{t('inv.title')}</Link>
              {user.role === 'admin' && (
                <Link to="/admin" className="block py-2.5 text-sm font-medium">Admin</Link>
              )}
              <button type="button" onClick={async () => { await logout(); setOpen(false); navigate('/'); }} className="py-2.5 text-sm font-medium text-red-600">{t('nav.logout')}</button>
            </>
          ) : (
            <>
              <Link to="/login" className="block py-2.5 text-sm font-medium">{t('nav.login')}</Link>
              <Link to="/register" className="block py-2.5 text-sm font-semibold text-primary">{t('nav.register')}</Link>
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
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </div>
    );
  }
  // Carry where they were going, so signing in from a link to a correction
  // lands on that correction instead of dropping them on /practice.
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

/* ------------------------------------------------------- RouteFallback ---- */
/* Shown while a lazily-loaded route chunk is in flight. Sized to roughly the
   height of a page body so the footer does not jump up and back down. */
export function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
    </div>
  );
}

/* --------------------------------------------------------- ScrollToTop ---- */
/* A client-side navigation keeps the previous scroll position, so following a
   link from halfway down one page opened the next one halfway down. Restoring
   a POP (back/forward) is the browser's job, so leave those alone. */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // 'instant' rather than the document's smooth scrolling: a page change is
    // not a scroll the user asked for, and animating it just delays the read.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
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

/* -------------------------------------------------------- CreditsBadge ---- */
/* Shown before the editor. Discovering the limit only after writing 150 words
   and pressing Analyser wastes the learner's effort, which is the moment they
   are most likely to leave. */
export function CreditsBadge({ className = '' }) {
  const { user } = useAuth();
  const t = useT();
  if (!user) return null;
  const left = user.credits_remaining;
  if (left === null || left === undefined) {
    return (
      <span className={`pill bg-violet-50 text-primary ${className}`} data-testid="credits-badge">
        {t('credits.unlimited')}
      </span>
    );
  }
  const tone = left === 0 ? 'bg-red-50 text-red-700'
    : left <= 2 ? 'bg-amber-50 text-amber-700'
    : 'bg-violet-50 text-primary';
  return (
    <span className={`pill ${tone} ${className}`} data-testid="credits-badge">
      {left === 0
        ? t('credits.none')
        : t('credits.remaining', { n: left, total: user.free_monthly_limit ?? 5 })}
    </span>
  );
}

/* ------------------------------------------------------- WordCountBar ---- */
/* Live word count against a tâche's official TCF range. `capped` mirrors the
   server-side rule, so the learner sees the penalty before submitting rather
   than discovering it in the result. */
export function WordCountBar({ text, taskType, free = false, className = '' }) {
  const t = useT();
  const { words, state, key: msgKey, vars, capped } = free
    ? { ...freeWordStatus(text), capped: false }
    : wordStatus(text, taskType);
  const spec = free ? { minWords: 0, maxWords: FREE_WRITING.maxWords } : WRITING_TASKS[taskType];
  if (!spec) {
    return (
      <p className={`text-xs text-gray-500 ${className}`} data-testid="word-count">
        {t('words.count', { n: countWords(text) })}
      </p>
    );
  }
  const tone = {
    empty: 'text-gray-400',
    under: 'text-amber-600',
    ok: 'text-green-600',
    warn: 'text-amber-600',
    over: 'text-red-600',
  }[state] || 'text-gray-500';
  const pct = Math.min(100, Math.round((words / spec.maxWords) * 100));
  const bar = { under: 'bg-amber-400', ok: 'bg-green-500', warn: 'bg-amber-500', over: 'bg-red-500' }[state] || 'bg-gray-300';

  return (
    <div className={className} data-testid="word-count">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className={`font-semibold tabular-nums ${tone}`}>
          {free
            ? t('words.freeRange', { n: words, max: spec.maxWords })
            : t('words.range', { n: words, min: spec.minWords, max: spec.maxWords })}
        </span>
        <span className={tone}>{msgKey ? t(msgKey, vars) : ''}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {capped && (
        <p className="mt-1 text-[11px] text-red-600" data-testid="word-count-cap-warning">
          {t('words.cappedWarning')}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------ confirm dialog ---- */
/* window.confirm, replaced.
 *
 * The native one is drawn by the browser, not the app: it lands wherever the
 * browser decides rather than over what it is asking about, wears the OS
 * styling, and is stamped with the bare domain name. It also blocks the main
 * thread while it is open. This keeps the question inside the product —
 * centred, in the app's own type and colours, translated by the same
 * dictionary as everything else.
 *
 * Returns [confirm, dialog]. `await confirm(message)` resolves true or false
 * exactly as window.confirm does, so a call site changes by one keyword and
 * its enclosing function becoming async. Render {dialog} anywhere in the page:
 * it is fixed-position, so where in the tree makes no difference.
 *
 * Escape and a click on the backdrop both answer false, matching what people
 * already expect a dialog to do with those two gestures. */
/* useConfirm's sibling, for the one question that needs an answer typed
 * rather than chosen.
 *
 * Same shape: `await prompt(...)` resolves to the string, or null if the
 * learner backs out. Kept beside useConfirm because the dialog, the focus
 * handling and the Escape behaviour are the same problem. */
export function usePrompt() {
  const t = useT();
  const [req, setReq] = useState(null);
  const [value, setValue] = useState('');

  const prompt = (opts = {}) => new Promise((resolve) => {
    setValue(opts.initial || '');
    setReq({ ...opts, resolve });
  });

  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { req.resolve(null); setReq(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const answer = (v) => { req.resolve(v); setReq(null); };

  const dialog = !req ? null : (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" data-testid="prompt-dialog"
      onMouseDown={(e) => { if (e.target === e.currentTarget) answer(null); }}>
      <form className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) answer(value.trim()); }}>
        {req.title && (
          <h3 className="font-heading text-lg font-bold text-gray-900">{req.title}</h3>
        )}
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{req.message}</p>
        <label className="sr-only" htmlFor="prompt-input">{req.label || req.title}</label>
        <input id="prompt-input" className="input mt-4" autoFocus
          type={req.type || 'text'} inputMode={req.inputMode}
          placeholder={req.placeholder || ''} value={value}
          autoComplete={req.autoComplete}
          onChange={(e) => setValue(e.target.value)}
          data-testid="prompt-input" />
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={() => answer(null)}
            className="btn-outline flex-1" data-testid="prompt-cancel">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!value.trim()}
            className="btn-primary flex-1 disabled:opacity-60" data-testid="prompt-ok">
            {req.confirmLabel || t('common.confirm')}
          </button>
        </div>
      </form>
    </div>
  );

  return [prompt, dialog];
}


export function useConfirm() {
  const t = useT();
  const [req, setReq] = useState(null);

  const confirm = (message, opts = {}) =>
    new Promise((resolve) => setReq({ message, ...opts, resolve }));

  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { req.resolve(false); setReq(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  const answer = (value) => { req.resolve(value); setReq(null); };

  const dialog = !req ? null : (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" data-testid="confirm-dialog"
      onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false); }}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        {req.title && (
          <h3 className="font-heading text-lg font-bold text-gray-900">{req.title}</h3>
        )}
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{req.message}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => answer(false)}
            className="btn-outline flex-1" data-testid="confirm-cancel">
            {req.cancelLabel || t('common.cancel')}
          </button>
          {/* Autofocused so Enter answers the question the same way it answers
              the native dialog, and Escape still cancels. */}
          <button type="button" autoFocus onClick={() => answer(true)}
            className={`btn-primary flex-1 ${req.danger ? '!bg-red-600 hover:!bg-red-700' : ''}`}
            data-testid="confirm-ok">
            {req.confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );

  return [confirm, dialog];
}

/* --------------------------------------------------- AnalysisProgress ---- */
const STAGES = [
  ['parsing', 'analysis.parsing'],
  ['grammar', 'analysis.grammar'],
  ['spelling', 'analysis.spelling'],
  ['conjugation', 'analysis.conjugation'],
  ['style', 'analysis.style'],
  ['generating', 'analysis.generating'],
];

/* Shown over the page the learner is on, not in place of it.
 *
 * Every caller used to swap its whole page out for this card, so submitting an
 * essay wiped the essay off the screen and dropped the learner somewhere that
 * looked like a different part of the site. Their text stays where it was now
 * and this sits on top of it; when the analysis lands, the caller navigates or
 * renders the result exactly as before.
 *
 * There is deliberately no close button: the grade is already being paid for
 * by the time this appears, and dismissing it would leave the request running
 * with nowhere to land. The backdrop swallows clicks meant for the form behind
 * it, which is the other half of the same guarantee. */
export function AnalysisProgress({ current }) {
  const t = useT();
  const idx = STAGES.findIndex(([k]) => k === current);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-busy="true" aria-label={t('analysis.title')}
      data-testid="analysis-progress">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="mb-4 font-heading text-lg font-semibold">{t('analysis.title')}</h3>
        <ul className="space-y-3">
          {STAGES.map(([key, label], i) => {
            const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
            return (
              <li key={key} className="flex items-center gap-3 text-sm">
                {state === 'done' && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[10px] text-white">✓</span>}
                {state === 'active' && <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-primary" />}
                {state === 'todo' && <span className="h-5 w-5 rounded-full border-2 border-gray-200" />}
                <span className={state === 'todo' ? 'text-gray-400' : state === 'active' ? 'font-semibold text-primary' : 'text-gray-700'}>{t(label)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------ Streaming SSE helper ---- */
export async function streamAnalysis(backendUrl, payload, { onStage, onComplete, onError, t = (k) => k }) {
  const res = await fetch(`${backendUrl}/api/analyze/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    let detail = t('analysis.failed');
    try {
      const j = await res.json();
      // The stream never reaches the axios interceptor, so a spent trial has
      // to be announced from here or it surfaces as a bare error string.
      announcePaywall(paywallDetail(j.detail, res.status));
      if (typeof j.detail === 'string') detail = j.detail;
      else if (typeof j.detail?.msg === 'string') detail = j.detail.msg;
    } catch {}
    onError?.(detail, res.status);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let settled = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop();
      for (const ev of events) {
        const type = (ev.match(/^event: (.+)$/m) || [])[1];
        const data = (ev.match(/^data: (.+)$/m) || [])[1];
        if (!type || !data) continue; // keep-alive comments land here
        const parsed = JSON.parse(data);
        if (type === 'stage') onStage?.(parsed.stage);
        else if (type === 'complete') { settled = true; onComplete?.(parsed); }
        else if (type === 'error') {
          settled = true;
          announcePaywall(paywallDetail(parsed.detail, parsed.status));
          const msg = typeof parsed.detail === 'string'
            ? parsed.detail : (parsed.detail?.msg || t('analysis.failed'));
          onError?.(msg, parsed.status);
        }
      }
    }
  } catch (e) {
    if (!settled) { settled = true; onError?.(t('analysis.interrupted')); }
    return;
  }
  // Stream closed with no result event — a proxy timeout or a dropped
  // connection. Without this the caller stays stuck on the progress spinner.
  if (!settled) onError?.(t('analysis.incomplete'));
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