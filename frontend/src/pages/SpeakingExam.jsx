import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ClockCountdown, CheckCircle, CaretRight, Microphone, Handshake,
  Scales, ArrowClockwise, Lock, MagnifyingGlass,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink } from '../components/shared';
import ConversationModal from '../components/ConversationModal';
import { SpeakingResult } from '../components/SpeakingResult';
import { useSpeak } from '../lib/speak';
import { trackPracticeStart, trackPracticeComplete } from '../lib/analytics';
import { speakingPaperMark, displayMark } from '../lib/tcf';
import { readSitting, writeSitting, TASKS } from '../lib/speakingExam';
import AttemptHistory, { useAttempts } from '../components/AttemptHistory';

/* Test Mode for Expression orale: one numbered sitting, the three tâches in the
   order the real exam gives them. Tâches 1 and 2 are live roleplays and run in
   this page; tâche 3 is a monologue, so it hands off to the recorder that owns
   the speech-started clock.

   A tâche that has been answered keeps its full grade here, so the corrections
   can be read back without taking it again — and taking it again is the button
   next to them. Both only ever appear on a tâche already answered: there is
   nothing to review, and nothing to retake, before that. */

const TASK_ICON = { 1: Microphone, 2: Handshake, 3: Scales };

export default function SpeakingExam() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const setNumber = parseInt(params.get('set'), 10) || null;

  const [sets, setSets] = useState([]);
  const [paper, setPaper] = useState(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(null);           // 1 | 2 while a modal is open
  const [results, setResults] = useState({});       // taskType -> graded result
  /* Which tâches have their corrections open. A Set, not a single number,
     because a finished paper opens all three at once — the candidate came for
     the whole Expression orale result, not for one tâche at a time. */
  const [reviewing, setReviewing] = useState(() => new Set());
  // Whether this paper has already been revealed, so the effect below fires
  // once per sitting rather than on every render that touches `results`.
  const revealedRef = useRef(false);
  const [openingId, setOpeningId] = useState(null);
  // One synthesiser for the page: opening tâche 3's corrections while tâche 1
  // is being read aloud must stop the first voice, not talk over it.
  const tts = useSpeak();

  useEffect(() => {
    api.get('/api/speaking/exam-sets')
      .then(({ data }) => setSets(data.sets || []))
      .catch(() => setSets([]))
      .finally(() => setLoading(false));
  }, []);

  // Tâche 3 is graded on the recorder's own route, so the results survive in
  // sessionStorage rather than in state alone; coming back finishes the paper.
  useEffect(() => { setResults(readSitting(setNumber)); }, [setNumber]);

  /* Every tâche of this set this candidate has ever had graded.
   *
   * sessionStorage alone made a paper a property of one browser tab: a reload,
   * a second device, or a grade that errored left this page reporting "0 of 3"
   * over answers that had really been given. The submissions were always
   * there; nothing linked them to the set until they carried its number.
   *
   * Newest first, so the first row seen for a tâche is where that tâche now
   * stands and the ones behind it are the earlier tries. */
  const { attempts, reload: reloadAttempts } = useAttempts(
    setNumber ? `/api/speaking/exam-sets/${setNumber}/attempts` : null,
    { enabled: Boolean(user && setNumber) });

  /* The sitting as the server knows it, filled in for any tâche the tab does
     not already hold. What is in sessionStorage wins: it is this sitting, in
     this tab, and it is what the candidate has just been looking at. */
  useEffect(() => {
    if (!attempts.length) return;
    const latest = {};
    // attempts are newest first, so the first of each tâche is its latest.
    attempts.forEach((a) => {
      if (a.task_type && !latest[a.task_type]) latest[a.task_type] = a;
    });
    setResults((held) => {
      const next = { ...held };
      let added = false;
      Object.entries(latest).forEach(([n, a]) => {
        // A tâche still being marked is held as a bare `pending` flag, which
        // carries no grade. The server's stub is better than that the moment
        // it exists, so it is not treated as something already in hand.
        if (next[n] && !next[n].pending) return;
        // A stub, not a grade: enough for the page to know the tâche was
        // answered and what it scored. The corrections themselves are fetched
        // only when the candidate opens them, which is the one place they are
        // large and the one place they are wanted.
        next[n] = { tcf_level: a.tcf_level, overall_score: a.overall_score,
                    errors: [], submission_id: a.submission_id,
                    from_history: true };
        added = true;
      });
      return added ? next : held;
    });
  }, [attempts]);

  /* A sitting finished on the recorder's route comes back naming the tâche it
     just graded. Landing on a completed paper with every correction collapsed
     would hide the one the candidate was reading a second ago. */
  useEffect(() => {
    const asked = parseInt(params.get('review'), 10) || null;
    setReviewing(asked ? new Set([asked]) : new Set());
    revealedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNumber]);

  useEffect(() => {
    if (!setNumber) { setPaper(null); return; }
    api.get(`/api/speaking/exam-sets/${setNumber}`)
      .then(({ data }) => setPaper(data))
      .catch((e) => { toast.error(errMsg(e)); setParams({}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNumber]);

  const open = (n) => {
    if (!user) return navigate('/login');
    setParams({ set: String(n) });
  };

  const startTask = (n) => {
    if (!user) return navigate('/login');
    if (n === 3) {
      /* Deliberately not counted here. Tâche 3 is recorded on
         /speaking/record, which fires its own practice_start the moment the
         preparation clock starts — and navigating to a recorder is not the
         same as beginning to speak into it. Counting both would double every
         tâche 3 in the funnel. */
      // The monologue recorder owns the preparation timer; send it the question.
      // `exam` tells the recorder this is a sitting, not free practice: it
      // reports the grade back into the sitting instead of ending the paper.
      navigate(`/speaking/record?tache=3&exam=${setNumber}`
               + `&back=${encodeURIComponent(pathname)}`
               + `&q=${encodeURIComponent(paper.task3.question)}`);
      return;
    }
    /* Tâches 1 and 2 are spoken into the modal this opens, on this page, so
       this is where they begin. */
    trackPracticeStart({
      skill: 'speaking',
      exam: 'tcf',
      exam_type: 'test',
      tache: n,
      set_number: setNumber || undefined,
    });
    setLive(n);
  };

  const toggleReview = (n) => setReviewing((open) => {
    const next = new Set(open);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });

  /* Opening a correction from the attempt list below puts it on screen — and
     the screen is often somewhere else entirely, because that list sits under
     all three tâches. Pressing Review and watching nothing happen reads as a
     broken button; the panel had opened, a page further up. Deferred by a tick
     so the panel exists to be scrolled to. */
  const scrollToTache = (n) => {
    setTimeout(() => {
      document.getElementById(`tache-${n}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const openReview = (n) => {
    setReviewing((open) => new Set(open).add(n));
    scrollToTache(n);
  };

  /* The tâche is over; the marking of it is not, and the candidate does not
     wait for it.
     A real sitting does not pause between tâches while an examiner reads, and
     this page never shows a mark mid-paper anyway — an answered tâche says
     "answered" and nothing else until all three are in. So the answer goes off
     to be marked, the row turns green, and the next tâche opens on the spot.
     The grade lands in place whenever it lands. */
  const onSubmitted = (taskType) => (request) => {
    advance(taskType, { pending: true });
    request
      .then(({ data }) => {
        trackPracticeComplete({
          skill: 'speaking',
          exam: 'tcf',
          exam_type: 'test',
          tache: taskType,
          level: data?.tcf_level,
          set_number: setNumber || undefined,
        });
        setResults((held) => {
          const next = { ...held, [taskType]: data };
          writeSitting(setNumber, next);
          return next;
        });
        reloadAttempts();   // the tâche just marked belongs in the history
      })
      .catch((err) => {
        /* The answer was spoken and the paper has moved on, so the tâche is
           not un-answered here — that would strand a candidate mid-sitting
           over a request they cannot see. The mark is what is missing, and
           the reload below is what finds it if the server did record one. */
        if (err?.response?.status !== 402) {
          toast.error(errMsg(err, t('conv.errAnalysis')));
        }
        reloadAttempts();
      });
  };

  /* Store the tâche's outcome, then open whatever comes next. */
  const advance = (taskType, outcome) => {
    const next = { ...results, [taskType]: outcome };
    setResults(next);
    writeSitting(setNumber, next);
    setLive(null);

    /* Straight on to the next unanswered tâche.
     *
     * The paper runs 1 → 2 → 3 without stopping, so the candidate is not sent
     * back to a list to press another button between every task. The first
     * tâche with no result is the one to open, rather than taskType + 1: a
     * retaken tâche 1 on a paper where 2 is already done should go to 3.
     *
     * Nothing is ambushed. Tâches 1 and 2 open the modal on its brief screen,
     * which the candidate reads and starts themselves, and tâche 3 opens the
     * recorder with its own preparation step. A finished paper advances
     * nowhere, so retaking a tâche on one just re-marks it. */
    const pending = TASKS.find((n) => !next[n]);
    if (pending) return startTask(pending);
    /* That was the last tâche. The paper is finished and it now lives on the
       dashboard, which is where the candidate is sent — the full three-tâche
       result is one click from the row that appears there. */
    return navigate('/dashboard?marking=speaking');
  };

  /* A finished paper opens everything, once.
   *
   * This is the moment the sitting exists for, and the candidate should not
   * have to click three times to see the result they just spent twelve
   * minutes earning. Tâches restored from history are left closed: their
   * corrections have not been fetched yet, so opening them would show an
   * empty panel instead of a result — the review button loads them on demand,
   * exactly as it did before. */
  useEffect(() => {
    if (revealedRef.current) return;
    /* Answered is not enough to open: a tâche still being marked is held as a
       bare `pending` flag with no grade behind it, and revealing that would
       open a correction panel over nothing. The paper reveals itself once the
       last mark is actually in, which is the moment this exists for. */
    const marked = TASKS.filter((n) => results[n] && !results[n].pending);
    if (marked.length < TASKS.length) return;
    // Set before the fetches below, or each one updating `results` would run
    // this effect again and ask for the same submissions a second time.
    revealedRef.current = true;

    const stubs = marked.filter(
      (n) => results[n].from_history && !results[n].loaded);
    if (!stubs.length) {
      setReviewing((open) => new Set([...open, ...marked]));
      return;
    }

    /* Arriving at a finished paper — from the dashboard, from a link, from
       yesterday. The tâches restored from history carry a level and a mark
       but no corrections, so opening them as they stand would show three
       empty panels. Fetch the three submissions and open the lot: this is a
       completed result being read, which is exactly the moment the
       corrections are wanted, and three requests is the whole cost. */
    let cancelled = false;
    Promise.all(stubs.map((n) => api
      .get(`/api/submissions/${results[n].submission_id}`)
      .then(({ data }) => [n, { ...(data.submission || {}), loaded: true }])
      .catch(() => null)))
      .then((loaded) => {
        if (cancelled) return;
        const got = loaded.filter(Boolean);
        if (got.length) {
          setResults((held) => {
            const nextResults = { ...held };
            got.forEach(([n, full]) => { nextResults[n] = full; });
            return nextResults;
          });
        }
        setReviewing((open) => new Set([...open, ...marked]));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  /* Open a graded tâche from the history — including one from a sitting taken
     days ago, or in another tab. The stub the list carries has no corrections
     on it, so the full submission is fetched the first time it is opened and
     then kept with the rest of the sitting. */
  const openAttempt = async (row) => {
    if (results[row.task]?.errors?.length || results[row.task]?.loaded) {
      /* openReview, not setReviewing: `reviewing` is a Set of open tâches, and
         assigning the number here replaced it with one. The next render then
         called reviewing.has() on a number, which threw and took the whole
         page down — a blank screen from pressing Review on a correction that
         was already in hand. */
      openReview(row.task);
      return;
    }
    setOpeningId(row.id);
    try {
      const { data } = await api.get(`/api/submissions/${row.id}`);
      const full = { ...(data.submission || {}), loaded: true };
      setResults((held) => ({ ...held, [row.task]: full }));
      openReview(row.task);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOpeningId(null);
    }
  };

  /* ---------------- chooser ---------------- */
  if (!setNumber) {
    return (
      <main className="overflow-x-clip bg-white">
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <BackLink to="/speaking" className="!mb-6" testid="back-to-speaking" />
          <div className="mb-3 text-center">
            <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('sexam.title')}</h1>
          </div>
          <div className="mb-8 flex flex-wrap justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-100 px-4 py-1.5 text-xs font-bold text-pink-700">
              <ClockCountdown size={14} weight="fill" /> {t('sexam.badgeTimed')}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-4 py-1.5 text-xs font-bold text-green-700">
              <CheckCircle size={14} weight="fill" /> {t('sexam.badgeFree')}
            </span>
          </div>

          {loading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sets.map((s) => (
                <button key={s.set_number} onClick={() => open(s.set_number)}
                  data-testid={`speaking-set-${s.set_number}`}
                  className="group flex flex-col overflow-hidden rounded-3xl border border-pink-100 bg-white text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-200/50">
                  <div className="h-1.5 w-full bg-gradient-to-r from-pink-600 to-fuchsia-600" />
                  <div className="flex flex-1 flex-col p-6">
                    <div className="flex items-start justify-between">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-100 font-heading text-lg font-extrabold text-pink-700">
                        {s.set_number}
                      </span>
                      <CaretRight size={18} className="text-gray-300 transition group-hover:translate-x-0.5" />
                    </div>
                    <h3 className="mt-4 flex-1 font-heading text-base font-bold text-gray-900">
                      {t('sexam.setN', { n: s.set_number })}
                    </h3>
                    {/* Nothing about the paper itself — not the subject,
                        not the domain it is drawn from. A theme is a strong
                        hint: "Environnement" is most of the preparation for a
                        question about it, and a candidate who can read the
                        themes will sit the paper they already have opinions
                        about rather than the one they were given. */}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  }

  /* ---------------- one sitting ---------------- */
  if (!paper) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </main>
    );
  }

  const stages = [
    { n: 1, label: paper.timings['1'].name, brief: paper.task1.brief,
      meta: t('sexam.metaT1') },
    { n: 2, label: paper.timings['2'].name, brief: paper.task2.situation,
      hints: paper.task2.hints, theme: paper.task2.theme, meta: t('sexam.metaT2') },
    { n: 3, label: paper.timings['3'].name, brief: paper.task3.question,
      theme: paper.task3.theme, meta: t('sexam.metaT3') },
  ];
  const done = stages.filter((s) => results[s.n]).length;
  /* Answered is not marked. A tâche handed off for marking counts towards the
     progress line and unlocks the next one, but the paper is only complete —
     and only computes a mark — once every tâche has a grade behind it. */
  const isMarked = (n) => Boolean(results[n]) && !results[n].pending;
  // A real sitting runs 1 → 2 → 3 with no skipping ahead, so a tâche unlocks
  // only once the one before it has been answered.
  const unlocked = (n) => n === 1 || Boolean(results[n - 1]);
  const finished = stages.every((s) => isMarked(s.n));
  const levels = stages.map((s) => results[s.n]?.tcf_level).filter(Boolean);
  // Expression orale is reported the way the real paper reports it: one mark
  // out of 20 for the skill, and the NCLC/CLB level that mark converts to.
  const paperMark = finished
    ? speakingPaperMark(stages.map((s) => results[s.n]))
    : null;

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <BackLink to="/speaking/test" className="!mb-6" testid="back-to-sets" />

        <div className="overflow-hidden rounded-3xl border border-pink-100 shadow-soft">
          <div className="bg-gradient-to-r from-pink-600 to-fuchsia-600 px-6 py-5 text-white">
            <p className="text-xs font-bold uppercase tracking-wide text-white/80">{t('sexam.testMode')}</p>
            <p className="mt-1 font-heading text-2xl font-extrabold">{t('sexam.setN', { n: paper.set_number })}</p>
            <p className="mt-1 text-sm text-white/90">{t('sexam.progress', { done, total: 3 })}</p>
            {!finished && (
              <p className="mt-1 text-xs text-white/70" data-testid="marks-held">
                {t('sexam.heldBack')}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {stages.map((s) => {
            const Icon = TASK_ICON[s.n];
            const result = results[s.n];
            /* Named so the attempt list further down can bring its correction
               into view rather than opening it off-screen. */
            return (
              <div key={s.n} id={`tache-${s.n}`}
                className={`scroll-mt-20 rounded-3xl border p-5 shadow-soft ${
                  result ? 'border-green-200 bg-green-50/40' : 'border-violet-100 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    result ? 'bg-green-100 text-green-700' : 'bg-violet-100 text-primary'}`}>
                    {result ? <CheckCircle size={20} weight="fill" /> : <Icon size={20} weight="fill" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading text-sm font-bold text-gray-900">{s.label}</p>
                      {/* Sealed with the subject, and revealed with it. */}
                      {result && s.theme && (
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-primary">{s.theme}</span>
                      )}
                      <span className="ml-auto text-[11px] text-gray-400">{s.meta}</span>
                    </div>
                    {/* The subject is sealed until the tâche is sat.
                         Three questions on screen from the moment the paper
                         opens is not the exam: a candidate reads tâche 3
                         while answering tâche 1, prepares it in their head,
                         and arrives at it having had ten minutes nobody in a
                         real room gets. It is shown by the modal and the
                         recorder, which is where it belongs, and it comes
                         back here once the tâche has been answered so the
                         corrections can be read against it. */}
                    {result ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-gray-800">{s.brief}</p>
                    ) : (
                      <p className="mt-1.5 flex items-center gap-1.5 text-sm italic text-gray-400"
                        data-testid={`sealed-task-${s.n}`}>
                        <Lock size={13} weight="fill" /> {t('sexam.sealed')}
                      </p>
                    )}
                    {result && s.hints && (
                      <p className="mt-1 text-xs italic text-gray-500">({s.hints})</p>
                    )}

                    {result && !finished ? (
                      /* Answered, and that is all it says.
                         A real sitting does not tell you how tâche 1 went
                         before you sit tâche 2, and a band on screen between
                         tâches is the single loudest thing that could be
                         there — it changes how the next answer is given. The
                         marks are all here the moment the paper is complete. */
                      <div className="mt-3 flex flex-wrap items-center gap-3"
                        data-testid={`answered-task-${s.n}`}>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-green-700 shadow-sm">
                          <CheckCircle size={12} weight="fill" className="mr-1 inline" />
                          {result.pending ? t('sexam.marking') : t('sexam.answered')}
                        </span>
                        <button onClick={() => startTask(s.n)} className="text-xs font-semibold text-primary underline">
                          <ArrowClockwise size={12} weight="bold" className="mr-1 inline" />{t('sexam.again')}
                        </button>
                      </div>
                    ) : result ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-primary shadow-sm">
                          {result.tcf_level} · {displayMark(result.overall_score, result.tcf_level) ?? '—'}/20
                        </span>
                        <button onClick={() => {
                          if (reviewing.has(s.n)) return toggleReview(s.n);
                          if (result.from_history && !result.loaded) {
                            return openAttempt({ id: result.submission_id, task: s.n });
                          }
                          return toggleReview(s.n);
                        }}
                          data-testid={`review-task-${s.n}`}
                          className="text-xs font-semibold text-primary underline">
                          <MagnifyingGlass size={12} weight="bold" className="mr-1 inline" />
                          {reviewing.has(s.n)
                            ? t('sexam.hideErrors')
                            : result.from_history && !result.loaded
                              ? t('hist.review')
                              : t('sexam.checkErrors', { n: (result.errors || []).length })}
                        </button>
                        <button onClick={() => startTask(s.n)} className="text-xs font-semibold text-primary underline">
                          <ArrowClockwise size={12} weight="bold" className="mr-1 inline" />{t('sexam.again')}
                        </button>
                      </div>
                    ) : unlocked(s.n) ? (
                      <button onClick={() => startTask(s.n)}
                        data-testid={`start-task-${s.n}`}
                        className="btn-primary mt-3 !py-1.5 text-sm !bg-gradient-to-r !from-pink-600 !to-fuchsia-600">
                        <Microphone size={15} weight="fill" /> {t('sexam.startTask')}
                      </button>
                    ) : (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
                        <Lock size={13} weight="fill" /> {t('sexam.locked', { n: s.n - 1 })}
                      </p>
                    )}
                  </div>
                </div>
                {reviewing.has(s.n) && result && (
                  <div className="mt-4" data-testid={`review-panel-${s.n}`}>
                    <SpeakingResult result={result} tts={tts} idPrefix={`t${s.n}-`} taskType={s.n} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <AttemptHistory
          className="mt-5"
          testid="sexam-history"
          attempts={attempts.map((a) => ({
            id: a.submission_id,
            task: a.task_type,
            label: `${t('hist.tache', { n: a.task_type })} · ${a.tcf_level} · ${
              displayMark(a.overall_score, a.tcf_level) ?? '—'}/20`,
            note: a.error_count
              ? t('hist.errors', { n: a.error_count })
              : t('hist.noErrors'),
            created_at: a.created_at,
          }))}
          opening={openingId}
          onOpen={openAttempt} />

        {finished && (
          <div className="mt-5 overflow-hidden rounded-3xl border border-green-200 shadow-soft" data-testid="exam-summary">
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-5 text-white">
              <p className="text-xs font-bold uppercase tracking-wide text-white/80">{t('sexam.doneTitle')}</p>
              {paperMark && (
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <p className="font-heading text-3xl font-extrabold" data-testid="paper-mark">
                    {paperMark.mark}<span className="text-xl text-white/70">/20</span>
                  </p>
                  <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" data-testid="paper-clb">
                    {paperMark.nclc
                      ? t('sexam.clb', { level: paperMark.nclc })
                      : t('sexam.clbBelow')}
                  </span>
                </div>
              )}
              <p className="mt-1 text-sm text-white/90">{t('sexam.doneSub', { levels: levels.join(' · ') })}</p>
            </div>
            <div className="bg-white px-6 py-4">
              <p className="text-xs leading-relaxed text-gray-500">{t('sexam.doneHint')}</p>
              <button onClick={() => setParams({})} className="btn-outline mt-3 text-sm">
                <ArrowClockwise size={15} weight="bold" /> {t('sexam.anotherSet')}
              </button>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-gray-400">{t('sexam.footnote')}</p>
      </section>

      {live === 1 && (
        <ConversationModal mode="tache1" tacheTitle={paper.timings['1'].name}
          examSet={setNumber}
          consigne={paper.task1.brief}
          onCancel={() => setLive(null)} onSubmitted={onSubmitted(1)} />
      )}
      {live === 2 && (
        <ConversationModal mode="tache2" tacheTitle={paper.timings['2'].name}
          examSet={setNumber}
          consigne={paper.task2.consigne}
          onCancel={() => setLive(null)} onSubmitted={onSubmitted(2)} />
      )}
    </main>
  );
}
