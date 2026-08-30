import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle, XCircle, ClockCountdown, CaretLeft, CaretRight, Quotes,
  ArrowClockwise, ListChecks, Lightning, Play, Pause, SpeakerHigh, Waveform,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink, useConfirm } from '../components/shared';

/* The official Compréhension orale paper runs 35 minutes for 39 questions —
   about half the reading allowance for the same number of items, because the
   recording sets the pace rather than the candidate. Test mode counts down from
   it and hands the paper in at zero; practice mode is untimed. */
const TEST_SECONDS = 35 * 60;

/* How many times a clip may be played. On the day each recording is played
   once and the candidate cannot go back, so test mode allows one play and
   practice allows as many as the learner wants — replaying a clip until the
   liaison finally resolves is the entire point of practising. */
const TEST_PLAYS = 1;

const LEVEL_STYLE = {
  A1: 'bg-emerald-100 text-emerald-700',
  A2: 'bg-teal-100 text-teal-700',
  B1: 'bg-sky-100 text-sky-700',
  B2: 'bg-indigo-100 text-indigo-700',
  C1: 'bg-violet-100 text-violet-700',
  C2: 'bg-fuchsia-100 text-fuchsia-700',
};

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function ListeningTest() {
  const [confirm, confirmDialog] = useConfirm();
  const { testNumber } = useParams();
  const location = useLocation();
  const isTest = location.pathname.startsWith('/listening/test');
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});          // qid -> option id
  const [corrections, setCorrections] = useState({});  // qid -> correction
  const [result, setResult] = useState(null);          // set once handed in
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [left, setLeft] = useState(TEST_SECONDS);
  const [plays, setPlays] = useState({});              // qid -> times played
  const [playing, setPlaying] = useState(false);
  const [heard, setHeard] = useState(0);               // seconds into the clip
  const [clipLength, setClipLength] = useState(0);
  const audioRef = useRef(null);
  const submittedRef = useRef(false);
  // Wall-clock deadline, so backgrounding the tab cannot buy extra time.
  const deadlineRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/listening/tests/${testNumber}`)
      .then(({ data }) => {
        if (cancelled) return;
        setQuestions(data.questions || []);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e?.response?.data?.detail || t('listenTest.loadFailed'));
        navigate(`/listening/${isTest ? 'test' : 'practice'}`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testNumber, isTest]);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/api/listening/tests/${testNumber}/submit`, {
        answers,
        time_used_seconds: TEST_SECONDS - left,
      });
      const map = {};
      (data.corrections || []).forEach((c) => { map[c.listening_question_id] = c; });
      setCorrections(map);
      setResult(data);
      setIndex(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      submittedRef.current = false;
      toast.error(e?.response?.data?.detail || t('listenTest.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [answers, left, testNumber, t]);

  // Countdown, test mode only — the same wall-clock deadline the reading paper
  // uses, and for the same reason: a learner who runs out of time gets a score
  // rather than losing the attempt.
  useEffect(() => {
    if (!isTest || !user || result || loading) return undefined;
    if (deadlineRef.current == null) deadlineRef.current = Date.now() + TEST_SECONDS * 1000;

    const read = () => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0 && !submittedRef.current) submit();
    };

    read();
    const id = setInterval(read, 250);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isTest, user, result, loading, submit]);

  const q = questions[index];
  const qid = q?.listening_question_id;
  const correction = qid ? corrections[qid] : null;
  const answeredCount = Object.values(answers).filter(Boolean).length;
  const reviewing = Boolean(result);

  const playsUsed = qid ? (plays[qid] || 0) : 0;
  // Once the paper is marked the recording is study material, not an exam clip,
  // so the play limit lifts — listening again with the transcript in front of
  // you is where the question is actually learned.
  const playsLeft = (!isTest || reviewing) ? Infinity : TEST_PLAYS - playsUsed;

  // Moving to another question stops the clip and resets the scrubber. Without
  // this the previous recording kept playing underneath the new question.
  useEffect(() => {
    const el = audioRef.current;
    if (el) { el.pause(); el.currentTime = 0; }
    setPlaying(false);
    setHeard(0);
    setClipLength(0);
  }, [index, testNumber]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); return; }
    // A play is counted at the moment it starts, not when it finishes, so
    // pausing halfway and pressing play again cannot buy a second listen.
    if (playsLeft <= 0) return;
    if (el.currentTime === 0 || el.ended) {
      setPlays((p) => ({ ...p, [qid]: (p[qid] || 0) + 1 }));
    }
    el.play().catch((err) => {
      // play() rejects with AbortError whenever playback is interrupted before
      // it begins, and the ordinary ways of using this player all do that:
      // pressing Next while a clip is starting (the effect above pauses it),
      // pressing pause quickly, or pressing play twice. None of them is a
      // failure, and reporting them as one told learners their connection was
      // broken while the audio was in fact fine.
      //
      // NotAllowedError is the browser's autoplay policy, which cannot happen
      // from this handler because it only ever runs from a click — but if it
      // ever did, "check your connection" would be the wrong advice, so it is
      // left to the genuine-error branch rather than silently swallowed.
      if (err && err.name === 'AbortError') return;
      toast.error(t('listenTest.audioFailed'));
    });
  };

  const pick = async (optionId) => {
    if (!q || correction) return;               // already marked
    setAnswers((a) => ({ ...a, [qid]: optionId }));
    if (isTest) return;                         // test mode marks at the end
    setChecking(true);
    try {
      const { data } = await api.post(
        `/api/listening/questions/${qid}/check`, { picked: optionId });
      setCorrections((c) => ({ ...c, [qid]: data.correction }));
    } catch {
      toast.error(t('listenTest.checkFailed'));
      setAnswers((a) => { const n = { ...a }; delete n[qid]; return n; });
    } finally {
      setChecking(false);
    }
  };

  const handIn = async () => {
    if (!user) return navigate('/login');
    const blank = questions.length - answeredCount;
    if (blank > 0 && !(await confirm(t('listenTest.confirmBlank', { n: blank })))) return;
    submit();
  };

  const restart = () => {
    submittedRef.current = false;
    // The deadline has to be cleared with the rest: clearing `result` re-runs
    // the timer effect, which would otherwise keep the deadline that has
    // already passed, read zero seconds left and file an empty paper.
    deadlineRef.current = null;
    setAnswers({}); setCorrections({}); setResult(null);
    setPlays({});
    setIndex(0); setLeft(TEST_SECONDS);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </main>
    );
  }

  /* Timed mode needs an account, and it has to be said before the clock starts
     — the same guard the reading paper carries, for the same reason: the
     automatic hand-in at zero would otherwise lose a signed-out visitor the
     whole 35 minutes to a 401. */
  if (isTest && !user) {
    return (
      <main className="mx-auto flex min-h-[62vh] max-w-xl items-center px-4 py-12 sm:px-6">
        <div className="w-full overflow-hidden rounded-3xl border border-violet-100 bg-white text-center shadow-soft">
          <div className="h-1.5 w-full bg-gradient-to-r from-primary to-fuchsia-500" />
          <div className="px-6 py-10">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-primary">
              <ClockCountdown size={26} weight="fill" />
            </span>
            <h1 className="mt-4 font-heading text-xl font-extrabold text-gray-900">
              {t('listenTest.signInTitle')}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-600">
              {t('listenTest.signInBody')}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <Link to="/login" state={{ from: location }}
                className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
                {t('auth.loginButton')}
              </Link>
              <Link to={`/listening/practice/${testNumber}`} className="btn-outline">
                {t('listenTest.orPractise')}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!q) return null;

  const swatch = (item) => {
    const c = corrections[item.listening_question_id];
    if (c) return c.is_correct ? 'bg-green-500 text-white' : 'bg-red-500 text-white';
    if (answers[item.listening_question_id]) return 'bg-primary text-white';
    return 'bg-white text-gray-500 border border-violet-100';
  };

  const progress = clipLength > 0 ? (heard / clipLength) * 100 : 0;

  return (
    <main className="overflow-x-clip bg-white">
      {confirmDialog}
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <BackLink to={`/listening/${isTest ? 'test' : 'practice'}`} className="!mb-6"
          testid="back-to-listening-tests" />

        {/* ---------------- SCORE REPORT (after hand-in) ---------------- */}
        {reviewing && (
          <div className="mb-6 overflow-hidden rounded-3xl border border-violet-100 shadow-soft" data-testid="listening-result">
            <div className="bg-gradient-to-r from-primary to-fuchsia-600 px-6 py-6 text-white">
              <p className="text-xs font-bold uppercase tracking-wide text-white/80">
                {t('listenTest.testN', { n: testNumber })}
              </p>
              <p className="mt-1 font-heading text-4xl font-extrabold">
                {result.score}<span className="text-2xl text-white/70">/{result.total}</span>
              </p>
              <p className="mt-1 text-sm text-white/90">
                {t('listenTest.scorePct', { p: Math.round((result.score / result.total) * 100) })}
              </p>
            </div>
            <div className="bg-white px-6 py-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                <ListChecks size={14} weight="fill" /> {t('listenTest.byLevel')}
              </p>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {Object.entries(result.by_level || {}).sort().map(([lvl, s]) => (
                  <div key={lvl} className="rounded-2xl border border-violet-100 p-3">
                    <div className="flex items-center justify-between">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LEVEL_STYLE[lvl] || 'bg-gray-100 text-gray-600'}`}>{lvl}</span>
                      <span className="font-heading text-sm font-bold text-gray-900">{s.correct}/{s.total}</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500"
                        style={{ width: `${(s.correct / s.total) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={restart} className="btn-outline mt-5 text-sm">
                <ArrowClockwise size={16} weight="bold" /> {t('listenTest.retake')}
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* ---------------- NAVIGATOR ---------------- */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <p className="font-heading text-sm font-bold text-gray-900">
                  {t('listenTest.testN', { n: testNumber })}
                </p>
                {isTest && !reviewing && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${
                    left < 300 ? 'bg-red-100 text-red-700' : 'bg-white text-primary'
                  }`} data-testid="listening-timer">
                    <ClockCountdown size={13} weight="fill" /> {clock(left)}
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-gray-500">
                {t('listenTest.progress', { done: answeredCount, total: questions.length })}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all"
                  style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
              </div>

              <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-6">
                {questions.map((item, i) => (
                  <button
                    key={item.listening_question_id}
                    onClick={() => setIndex(i)}
                    data-testid={`nav-q-${i + 1}`}
                    className={`flex h-11 items-center justify-center rounded-lg text-xs font-bold transition sm:h-9 ${swatch(item)} ${
                      i === index ? 'ring-2 ring-primary ring-offset-1' : ''
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>

              {isTest && !reviewing && (
                <button onClick={handIn} disabled={submitting}
                  className="btn-primary mt-5 w-full justify-center !bg-gradient-to-r !from-pink-600 !to-fuchsia-600"
                  data-testid="listening-submit">
                  <CheckCircle size={16} weight="fill" /> {t('listenTest.handIn')}
                </button>
              )}
              <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
                <Lightning size={13} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                {isTest ? t('listenTest.testHint') : t('listenTest.practiceHint')}
              </p>
            </div>
          </aside>

          {/* ---------------- QUESTION ---------------- */}
          <div>
            <div className="rounded-3xl border border-violet-100 bg-white p-5 shadow-xl shadow-violet-200/40 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t('listenTest.questionN', { n: index + 1 })}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${LEVEL_STYLE[q.level] || 'bg-gray-100 text-gray-600'}`}>
                  {q.level}
                </span>
                {q.band && <span className="text-[11px] text-gray-500">{q.band}</span>}
              </div>

              {/* -------- THE PICTURE, when the question has one --------
                  Questions 1 and 2 of a paper ask which spoken sentence
                  describes a photograph; the image IS the question there. */}
              {q.image_url && (
                <div className="mb-4 overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/40">
                  <img src={q.image_url} alt={t('listenTest.imageAlt', { n: index + 1 })}
                    loading="lazy"
                    className="mx-auto max-h-80 w-full object-contain"
                    data-testid="listening-image" />
                </div>
              )}

              {/* -------- THE RECORDING -------- */}
              <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4"
                data-testid="listening-player">
                <audio
                  ref={audioRef}
                  src={q.audio_url}
                  preload="metadata"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => { setPlaying(false); setHeard(clipLength); }}
                  onTimeUpdate={(e) => setHeard(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setClipLength(e.currentTarget.duration || 0)}
                  onError={(e) => {
                    // Only a real failure to fetch or decode. Moving between
                    // questions swaps `src`, and a media element whose source
                    // is being replaced can raise `error` for the resource it
                    // is abandoning — with no request having failed. Reading
                    // the element's own error code tells the two apart, and an
                    // element with nothing loaded has nothing to report.
                    const el = e.currentTarget;
                    if (!el.error || !el.currentSrc) return;
                    if (el.error.code === el.error.MEDIA_ERR_ABORTED) return;
                    toast.error(t('listenTest.audioFailed'));
                  }}
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggle}
                    disabled={playsLeft <= 0 && !playing}
                    data-testid="listening-play"
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white transition ${
                      playsLeft <= 0 && !playing
                        ? 'cursor-not-allowed bg-gray-300'
                        : 'bg-gradient-to-br from-primary to-fuchsia-600 hover:scale-105'
                    }`}
                    aria-label={playing ? t('listenTest.pause') : t('listenTest.play')}
                  >
                    {playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                        <SpeakerHigh size={13} weight="fill" className="text-primary" />
                        {t('listenTest.audioLabel')}
                      </span>
                      <span className="text-[11px] tabular-nums text-gray-500">
                        {clock(Math.floor(heard))}
                        {clipLength > 0 && ` / ${clock(Math.floor(clipLength))}`}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500"
                        style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      {playsLeft === Infinity
                        ? t('listenTest.playsUnlimited')
                        : playsLeft > 0
                          ? t('listenTest.playsLeft', { n: playsLeft })
                          : t('listenTest.playsNone')}
                    </p>
                  </div>
                </div>
              </div>

              {/* The oral paper prints no written stem — the recording is the
                  question. A stem is rendered only if a future import carries
                  one. */}
              {q.question_fr && (
                <p className="mt-5 font-heading text-base font-bold text-gray-900">{q.question_fr}</p>
              )}

              {/* -------- OPTIONS --------
                  On questions 1 to 10 the four options are spoken rather than
                  printed, so `text` is empty and the button carries only its
                  letter — exactly what the candidate sees on the day. The
                  English gloss appears with the correction, never before it. */}
              <div className="mt-4 space-y-2.5">
                {(correction?.options || q.options).map((o) => {
                  const picked = answers[qid] === o.id;
                  const marked = Boolean(correction);
                  const isRight = marked && o.is_correct;
                  const isWrongPick = marked && picked && !o.is_correct;
                  const spokenOnly = !(o.text || '').trim();

                  let tone = 'border-violet-100 bg-white hover:bg-violet-50/50';
                  if (isRight) tone = 'border-green-300 bg-green-50';
                  else if (isWrongPick) tone = 'border-red-300 bg-red-50';
                  else if (marked) tone = 'border-gray-100 bg-gray-50/60';
                  else if (picked) tone = 'border-primary bg-white ring-1 ring-primary';

                  return (
                    <button
                      key={o.id}
                      onClick={() => pick(o.id)}
                      disabled={marked || checking}
                      data-testid={`option-${o.id}`}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${tone} ${
                        marked ? 'cursor-default' : ''
                      }`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold uppercase ${
                        isRight ? 'bg-green-500 text-white'
                          : isWrongPick ? 'bg-red-500 text-white'
                          : picked ? 'bg-primary text-white' : 'bg-violet-100 text-primary'
                      }`}>
                        {o.id}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {spokenOnly && !marked ? (
                            <span className="flex items-center gap-1.5 text-sm italic text-gray-400">
                              <Waveform size={14} weight="fill" /> {t('listenTest.spokenOption')}
                            </span>
                          ) : (
                            <span className="font-semibold text-gray-900">
                              {o.text || (marked ? o.text_en : '')}
                            </span>
                          )}
                          {isRight && <CheckCircle size={16} weight="fill" className="shrink-0 text-green-600" />}
                          {isWrongPick && <XCircle size={16} weight="fill" className="shrink-0 text-red-600" />}
                        </span>
                        {/* The English gloss, once the question is marked. */}
                        {marked && o.text_en && o.text && (
                          <span className="mt-0.5 block text-xs italic text-gray-500">{o.text_en}</span>
                        )}
                        {marked && o.explanation && (
                          <span className={`mt-2 block rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            o.is_correct ? 'bg-green-100/70 text-green-900' : 'bg-white/80 text-gray-600'
                          }`}>
                            <span className="font-bold uppercase tracking-wide">
                              {o.is_correct ? t('listenTest.correctLabel') : t('listenTest.wrongLabel')}
                            </span>{' — '}{o.explanation}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* -------- TRANSCRIPT, KEY LINE, VOCABULARY, REASONING -------- */}
              {correction && (
                <div className="mt-5 space-y-4" data-testid="listening-explanation">
                  {/* The transcript is the heart of the correction: hearing it
                      wrong and then reading what was actually said is what
                      moves an oral score. */}
                  {correction.transcript && (
                    <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        <Waveform size={12} weight="fill" /> {t('listenTest.transcript')}
                      </p>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-gray-800">
                        {correction.transcript}
                      </p>
                      {correction.transcript_en && (
                        <p className="mt-2 whitespace-pre-line text-xs italic leading-relaxed text-gray-500">
                          {correction.transcript_en}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    {correction.key_line_fr && (
                      <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                          <Quotes size={12} weight="fill" /> {t('listenTest.keyLine')}
                        </p>
                        <p className="mt-1.5 text-sm font-semibold leading-relaxed text-gray-800">{correction.key_line_fr}</p>
                        {correction.key_line_en && (
                          <p className="mt-1 text-xs italic leading-relaxed text-gray-500">{correction.key_line_en}</p>
                        )}
                      </div>
                    )}
                    {correction.vocabulary?.length > 0 && (
                      <div className="rounded-2xl border border-violet-100 bg-white p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
                          {t('listenTest.vocabulary')}
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {correction.vocabulary.map((v, i) => (
                            <li key={i} className="text-xs leading-relaxed text-gray-700">
                              <span className="font-semibold text-gray-900">{v.term}</span>
                              <span className="text-gray-400"> — </span>
                              <span className="text-gray-600">{v.gloss}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {correction.breakdown && (
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                        <ListChecks size={12} weight="fill" /> {t('listenTest.breakdown')}
                      </p>
                      <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-gray-700">
                        {correction.breakdown}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* -------- PREV / NEXT -------- */}
              <div className="mt-6 flex items-center justify-between gap-3">
                <button onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0} className="btn-outline text-sm disabled:opacity-40">
                  <CaretLeft size={15} weight="bold" /> {t('listenTest.prev')}
                </button>
                <span className="text-xs text-gray-400">{index + 1} / {questions.length}</span>
                <button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                  disabled={index === questions.length - 1}
                  className="btn-primary text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-40"
                  data-testid="listening-next">
                  {t('listenTest.next')} <CaretRight size={15} weight="bold" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
