import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Cards, ListChecks, Lightning, Fire, ArrowLeft } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { BackLink, useConfirm } from '../components/shared';
import { useT } from '../i18n';
import { useSeo } from '../lib/seo';

function shuffle(a) { return [...a].sort(() => Math.random() - 0.5); }

/* The category sprint is two minutes, as the mode chooser says. */
const SPRINT_SECONDS = 120;

export default function Review() {
  // A hook rather than an element, so no early return — loading, empty,
  // or "coming soon" — can skip it and leave the page inheriting the
  // shell's canonical, which points at the homepage.
  useSeo({ titleKey: 'seo.review.title', path: '/review', noindex: true });

  const [params] = useSearchParams();
  const t = useT();
  const [confirm, confirmDialog] = useConfirm();
  const category = params.get('category');
  const [queue, setQueue] = useState(null);
  const [mode, setMode] = useState(null); // flashcards | mcq | sprint
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sprintLeft, setSprintLeft] = useState(SPRINT_SECONDS);

  const load = () => {
    api.get('/api/review/queue', { params: category ? { category } : {} })
      .then(({ data }) => setQueue(data))
      .catch((e) => toast.error(errMsg(e)));
  };
  useEffect(load, [category]);

  const items = useMemo(() => shuffle(queue?.due || []), [queue]);
  const currentItem = items[idx];
  const options = useMemo(() => {
    if (!currentItem) return [];
    const opts = new Set([currentItem.correction, currentItem.error_text]);
    if (currentItem.distractor) opts.add(currentItem.distractor);
    return shuffle([...opts]);
  }, [currentItem]);

  /* The timer callback captured `results` from the render that created the
     interval, so a sprint that ran out of time submitted the answers as they
     were when it started — usually none. Read them through a ref instead. */
  const resultsRef = useRef(results);
  useEffect(() => { resultsRef.current = results; }, [results]);
  const finishRef = useRef(null);
  // Wall-clock deadline: the sprint is a timed challenge, so pausing it by
  // switching tabs would be a way to inflate the score.
  const sprintEndsRef = useRef(null);
  const sprintOverRef = useRef(false);

  useEffect(() => {
    if (mode !== 'sprint' || summary) return undefined;
    if (sprintEndsRef.current == null) {
      sprintEndsRef.current = Date.now() + SPRINT_SECONDS * 1000;
      sprintOverRef.current = false;
    }

    const read = () => {
      const left = Math.max(0, Math.ceil((sprintEndsRef.current - Date.now()) / 1000));
      setSprintLeft(left);
      if (left <= 0 && !sprintOverRef.current) {
        sprintOverRef.current = true;
        finishRef.current?.(resultsRef.current);
      }
    };

    read();
    const id = setInterval(read, 250);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mode, summary]);

  const finish = async (finalResults) => {
    if (!finalResults.length) { setMode(null); return; }
    try {
      const { data } = await api.post('/api/review/submit', { mode, results: finalResults });
      setSummary(data);
      if (data.streak?.extended) toast.success(t('rev.streakToast', { n: data.streak.current_streak }));
      data.badges?.forEach((b) => toast.success(t('rev.badgeToast', { name: b })));
    } catch (e) { toast.error(errMsg(e)); }
  };
  finishRef.current = finish;

  /* MCQ and sprint send what the learner picked and let the server decide;
     a flashcard has no comparable answer, so it sends a self-rating. The
     client used to send `correct` directly, which made XP forgeable. */
  const answer = ({ picked: pickedAnswer, selfRated }) => {
    const m = items[idx];
    const entry = pickedAnswer !== undefined
      ? { mistake_id: m.mistake_id, answer: pickedAnswer }
      : { mistake_id: m.mistake_id, self_rated_correct: selfRated };
    const next = [...results, entry];
    setResults(next);
    setFlipped(false); setPicked(null);
    if (idx + 1 >= items.length) finish(next);
    else setIdx(idx + 1);
  };

  const start = (m) => { setMode(m); setIdx(0); setResults([]); setSummary(null); setFlipped(false); setPicked(null); setSprintLeft(SPRINT_SECONDS); sprintEndsRef.current = null; sprintOverRef.current = false; };

  /* Leaves a session without submitting — answers so far are discarded. */
  const quitSession = async () => {
    if (results.length && !(await confirm(t('rev.quitConfirm'), { danger: true }))) return;
    setMode(null); setIdx(0); setResults([]); setFlipped(false); setPicked(null);
  };

  /* The dialog travels with the button rather than sitting in one page
     return: quitting is offered from two different branches, and only one of
     them is ever mounted. */
  const quitButton = (
    <>
      {confirmDialog}
      <button onClick={quitSession} data-testid="quit-review-session"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-primary hover:underline">
        <ArrowLeft size={16} /> {t('rev.quit')}
      </button>
    </>
  );

  if (!queue) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  /* ---- summary screen ---- */
  if (summary) {
    const graded = summary.graded || [];
    const correct = graded.filter((r) => r.correct).length;
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">{t('rev.sessionDone')}</h1>
        <div className="card mt-6 space-y-3 p-8">
          <p className="font-heading text-5xl font-bold text-primary">+{summary.xp_earned} XP</p>
          <p className="text-gray-600">{t('rev.summary', { correct, total: graded.length, mastered: summary.newly_mastered.length, xp: summary.total_xp })}</p>
          {summary.badges?.map((b) => <p key={b} className="pill mx-auto bg-amber-50 text-amber-700">🏅 {b}</p>)}
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn-primary" onClick={() => { setMode(null); setSummary(null); load(); }}>{t('rev.continue')}</button>
          <Link to="/dashboard" className="btn-outline">Tableau de bord</Link>
        </div>
      </main>
    );
  }

  /* ---- hub ---- */
  if (!mode) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <BackLink />
        <h1 className="text-3xl font-bold">{t('rev.title')}</h1>
        <p className="mt-2 text-gray-600">
          {category ? <>{t('rev.category')} <span className="pill" style={{ background: CATEGORY_META[category]?.color }}>{CATEGORY_META[category]?.label}</span> · </> : null}
          {t('rev.hubIntro', { n: queue.due.length })} <Fire size={14} className="inline text-orange-500" weight="fill" />
        </p>
        {queue.due.length === 0 ? (
          <div className="card mt-8 p-10 text-center">
            <p className="text-2xl">{t('rev.nothing')}</p>
            <p className="mt-2 text-gray-600">{t('rev.comeBack')} <Link to="/practice" className="font-semibold text-primary">{t('rev.writeNew')}</Link>.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ['flashcards', Cards, 'rev.modeFlashTitle', 'rev.modeFlashDesc'],
              ['mcq', ListChecks, 'rev.modeMcqTitle', 'rev.modeMcqDesc'],
              ['sprint', Lightning, 'rev.modeSprintTitle', 'rev.modeSprintDesc'],
            ].map(([key, Icon, title, desc]) => (
              <button key={key} className="card card-hover p-6 text-left" onClick={() => start(key)} data-testid={`mode-${key}`}>
                <Icon size={28} weight="duotone" className="text-primary" />
                <h3 className="mt-3 font-heading text-lg font-semibold">{t(title)}</h3>
                <p className="mt-2 text-sm text-gray-600">{t(desc)}</p>
              </button>
            ))}
          </div>
        )}
      </main>
    );
  }

  const m = items[idx];
  if (!m) return null;
  const meta = CATEGORY_META[m.category] || {};
  const progress = `${idx + 1} / ${items.length}`;

  /* ---- flashcards ---- */
  if (mode === 'flashcards') {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        {quitButton}
        <div className="flex items-center justify-between text-sm text-gray-500"><span>{t('rev.progress', { progress })}</span><span className="pill" style={{ background: meta.color }}>{meta.label}</span></div>
        <div className="card flip-in mt-4 min-h-[260px] p-8" key={`${idx}-${flipped}`}>
          {!flipped ? (
            <>
              <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.yourSentence')}</p>
              <p className="mt-3 text-lg leading-relaxed text-red-700">{m.error_text}</p>
              <p className="mt-6 text-sm text-gray-500">{t('rev.thinkThenFlip')}</p>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.correction')}</p>
              <p className="mt-3 text-lg font-medium leading-relaxed text-green-700">{m.correction}</p>
              <p className="mt-4 text-sm text-gray-600">{m.explanation}</p>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-center gap-3">
          {!flipped ? (
            <button className="btn-primary" onClick={() => setFlipped(true)} data-testid="flip-button">{t('rev.flip')}</button>
          ) : (
            <>
              <button className="btn-outline !border-amber-300 !text-amber-600" onClick={() => answer({ selfRated: false })} data-testid="shaky-button">{t('rev.shaky')}</button>
              <button className="btn-primary !bg-green-600 hover:!bg-green-500" onClick={() => answer({ selfRated: true })} data-testid="gotit-button">{t('rev.gotIt')}</button>
            </>
          )}
        </div>
      </main>
    );
  }

  /* ---- mcq & sprint ---- */
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {quitButton}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{mode === 'sprint' ? t('rev.sprintProgress', { clock: `${Math.floor(sprintLeft / 60)}:${String(sprintLeft % 60).padStart(2, '0')}` }) : t('rev.mcqProgress', { progress })}</span>
        <span className="pill" style={{ background: meta.color }}>{meta.label}</span>
      </div>
      <div className="card mt-4 p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('rev.whichCorrect')}</p>
        <p className="mt-3 text-lg text-gray-800">« {m.error_text} »</p>
        <div className="mt-5 space-y-3">
          {options.map((opt) => {
            const isCorrect = opt === m.correction;
            const state = picked == null ? '' : isCorrect ? '!border-green-500 bg-green-50' : opt === picked ? '!border-red-400 bg-red-50' : 'opacity-50';
            return (
              <button key={opt} disabled={picked != null}
                className={`block w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-left text-sm transition hover:border-primary ${state}`}
                onClick={() => { setPicked(opt); setTimeout(() => answer({ picked: opt }), 900); }}>
                {opt}
              </button>
            );
          })}
        </div>
        {picked != null && <p className="mt-4 text-sm text-gray-600">{m.explanation}</p>}
      </div>
    </main>
  );
}

