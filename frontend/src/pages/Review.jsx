import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Cards, ListChecks, Lightning, Textbox, MagnifyingGlass, Keyboard,
  ArrowsLeftRight, Repeat, Fire, ArrowLeft,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { BackLink, useConfirm } from '../components/shared';
import { ExerciseCard } from '../components/reviewExercises';
import { MODES, MODE_META, shuffle } from '../lib/review';
import { useT } from '../i18n';
import { useSeo } from '../lib/seo';

/* The category sprint is two minutes, as the mode chooser says. */
const SPRINT_SECONDS = 120;

const MODE_ICON = {
  flashcards: Cards, mcq: ListChecks, cloze: Textbox, spot: MagnifyingGlass,
  typeit: Keyboard, pair: ArrowsLeftRight, transfer: Repeat, sprint: Lightning,
};

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
  const [mode, setMode] = useState(null);
  const [items, setItems] = useState([]);
  const [starting, setStarting] = useState(null); // the mode being prepared
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [sprintLeft, setSprintLeft] = useState(SPRINT_SECONDS);

  const load = () => {
    api.get('/api/review/queue', { params: category ? { category } : {} })
      .then(({ data }) => setQueue(data))
      .catch((e) => toast.error(errMsg(e)));
  };
  useEffect(load, [category]);

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
    if (!finalResults.length) { setMode(null); setItems([]); return; }
    try {
      const { data } = await api.post('/api/review/submit', { mode, results: finalResults });
      setSummary(data);
      if (data.streak?.extended) toast.success(t('rev.streakToast', { n: data.streak.current_streak }));
      data.badges?.forEach((b) => toast.success(t('rev.badgeToast', { name: b })));
    } catch (e) { toast.error(errMsg(e)); }
  };
  finishRef.current = finish;

  /* Every mode sends what the learner picked or typed and lets the server
     decide; a flashcard has no comparable answer, so it sends a self-rating.
     The client used to send `correct` directly, which made XP forgeable. */
  const answer = ({ answer: given, selfRated, note }) => {
    const m = items[idx];
    const entry = { mistake_id: m.mistake_id };
    if (given === undefined || given === null) entry.self_rated_correct = !!selfRated;
    else entry.answer = given;
    if (note) entry.note = note;
    const next = [...results, entry];
    setResults(next);
    if (idx + 1 >= items.length) finish(next);
    else setIdx(idx + 1);
  };

  /* Each mode asks for its own queue rather than filtering the hub's.
     Whether a mistake can be drilled a given way is the server's judgement —
     it is the side that knows which sentence the mistake was made in — and the
     rule-transfer drills do not exist until the mode that needs them is
     opened, which is what this request pays for. */
  const start = async (m) => {
    setStarting(m);
    try {
      const { data } = await api.get('/api/review/queue', {
        params: { ...(category ? { category } : {}), mode: m },
      });
      if (!data.due?.length) { toast.error(t('rev.modeEmpty')); return; }
      setItems(shuffle(data.due));
      setMode(m); setIdx(0); setResults([]); setSummary(null);
      setSprintLeft(SPRINT_SECONDS);
      sprintEndsRef.current = null; sprintOverRef.current = false;
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setStarting(null);
    }
  };

  /* Leaves a session without submitting — answers so far are discarded. */
  const quitSession = async () => {
    if (results.length && !(await confirm(t('rev.quitConfirm'), { danger: true }))) return;
    setMode(null); setIdx(0); setResults([]); setItems([]);
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
          {/* An accent slip is marked wrong, so it has to be named: the learner
              knew the word and would otherwise read the card as "no idea". */}
          {graded.some((r) => r.note === 'accent') && (
            <p className="text-sm text-amber-700">
              {t('rev.accentTally', { n: graded.filter((r) => r.note === 'accent').length })}
            </p>
          )}
          {summary.badges?.map((b) => <p key={b} className="pill mx-auto bg-amber-50 text-amber-700">🏅 {b}</p>)}
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn-primary" onClick={() => { setMode(null); setSummary(null); setItems([]); load(); }}>{t('rev.continue')}</button>
          <Link to="/dashboard" className="btn-outline">{t('common.dashboard')}</Link>
        </div>
      </main>
    );
  }

  /* ---- hub ---- */
  if (!mode) {
    const counts = queue.mode_counts || {};
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
          <>
            {/* What is due, before how to drill it. The hub used to open on
                three mode buttons, which asked the learner to choose a way of
                practising before they had seen a single thing they got wrong —
                so "Category sprint" was a guess, not a decision. */}
            {/* A table, so the three things a mistake is made of — what you
                wrote, what it should be, why — line up in columns down the
                list. Read as a stack of sentences they had to be re-parsed one
                by one; in columns the corrections can be scanned on their own.
                Below ~44rem the columns stop fitting, so the card scrolls
                sideways rather than crushing the explanation to two words a
                line, the same as the other tables in the app. */}
            <section className="card mt-8" data-testid="mistake-list">
              <h2 className="px-5 pt-6 font-heading text-lg font-bold text-gray-900">
                {t('rev.listTitle', { n: queue.due.length })}
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-y border-gray-100 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                      <th className="w-10 px-5 py-3" />
                      <th className="px-5 py-3">{t('rev.colError')}</th>
                      <th className="px-5 py-3">{t('rev.colCorrection')}</th>
                      <th className="px-5 py-3">{t('rev.colExplanation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.due.map((m, i) => (
                      <tr key={m.mistake_id}
                        className="border-b border-gray-50 align-top last:border-0">
                        <td className="px-5 py-4 text-[11px] font-bold tabular-nums text-gray-400">
                          {i + 1}
                        </td>
                        <td className="px-5 py-4 leading-relaxed">
                          <span className="text-red-600 line-through decoration-red-300">
                            {m.error_text}
                          </span>
                          {m.times_repeated > 1 && (
                            <span className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-bold tabular-nums text-amber-700"
                              title={t('rev.seenTimesTitle', { n: m.times_repeated })}>
                              ×{m.times_repeated}
                            </span>
                          )}
                          {/* The sentence it was written in, which is what the
                              drills below put back on screen. */}
                          {m.context_sentence && (
                            <span className="mt-1 block text-[12px] italic leading-relaxed text-gray-400">
                              {m.context_sentence}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 font-semibold leading-relaxed text-green-700">
                          {m.correction}
                        </td>
                        <td className="px-5 py-4 text-[13px] leading-relaxed text-gray-600">
                          {m.explanation}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <h2 className="mt-10 font-heading text-lg font-bold text-gray-900">
              {t('rev.chooseMode')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{t('rev.chooseModeSub')}</p>
            <div className="mt-4 grid gap-5 md:grid-cols-3">
              {MODES.map((key) => {
                const Icon = MODE_ICON[key];
                // For the modes built on the fly this is a forecast rather
                // than a count — the drills do not exist until the mode is
                // opened, and a few of them will not come out. Starting with
                // fewer cards than the card promised is handled; starting with
                // none says so.
                const n = counts[key] ?? 0;
                const busy = starting === key;
                return (
                  <button key={key} disabled={!n || starting != null}
                    className="card card-hover p-6 text-left disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => start(key)} data-testid={`mode-${key}`}>
                    <Icon size={28} weight="duotone" className="text-primary" />
                    <h3 className="mt-3 font-heading text-lg font-semibold">{t(MODE_META[key].title)}</h3>
                    <p className="mt-2 text-sm text-gray-600">{t(MODE_META[key].desc)}</p>
                    <p className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-400">
                      {busy ? t('rev.modePreparing')
                        : n ? t('rev.modeCount', { n }) : t('rev.modeNone')}
                    </p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    );
  }

  const m = items[idx];
  if (!m) return null;
  const meta = CATEGORY_META[m.category] || {};

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {quitButton}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          {mode === 'sprint'
            ? t('rev.sprintProgress', { clock: `${Math.floor(sprintLeft / 60)}:${String(sprintLeft % 60).padStart(2, '0')}` })
            : t('rev.modeProgress', { label: t(MODE_META[mode].title), progress: `${idx + 1} / ${items.length}` })}
        </span>
        <span className="pill" style={{ background: meta.color }}>{meta.label}</span>
      </div>
      <div className="mt-4">
        <ExerciseCard key={m.mistake_id} mode={mode} item={m}
          sprint={mode === 'sprint'} isLast={idx + 1 >= items.length}
          onAnswer={answer} />
      </div>
    </main>
  );
}
