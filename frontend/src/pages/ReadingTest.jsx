import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle, XCircle, ClockCountdown, CaretLeft, CaretRight, Quotes,
  ArrowClockwise, ListChecks, Lightning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink } from '../components/shared';

/* The official Compréhension écrite paper runs 60 minutes. Test mode counts
   down from it and hands the paper in at zero; practice mode is untimed. */
const TEST_SECONDS = 60 * 60;

const LEVEL_STYLE = {
  A1: 'bg-emerald-100 text-emerald-700',
  A2: 'bg-teal-100 text-teal-700',
  B1: 'bg-sky-100 text-sky-700',
  B2: 'bg-indigo-100 text-indigo-700',
  C1: 'bg-violet-100 text-violet-700',
  C2: 'bg-fuchsia-100 text-fuchsia-700',
};

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function ReadingTest() {
  const { testNumber } = useParams();
  const isTest = useLocation().pathname.startsWith('/reading/test');
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
  const submittedRef = useRef(false);
  // Wall-clock deadline, so backgrounding the tab cannot buy extra time.
  const deadlineRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/reading/tests/${testNumber}`)
      .then(({ data }) => {
        if (cancelled) return;
        setQuestions(data.questions || []);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e?.response?.data?.detail || t('readTest.loadFailed'));
        navigate(`/reading/${isTest ? 'test' : 'practice'}`);
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
      const { data } = await api.post(`/api/reading/tests/${testNumber}/submit`, {
        answers,
        time_used_seconds: TEST_SECONDS - left,
      });
      const map = {};
      (data.corrections || []).forEach((c) => { map[c.reading_question_id] = c; });
      setCorrections(map);
      setResult(data);
      setIndex(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      submittedRef.current = false;
      toast.error(e?.response?.data?.detail || t('readTest.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [answers, left, testNumber, t]);

  // Countdown, test mode only. Hands the paper in by itself at zero, exactly
  // as the invigilator would — a learner who runs out of time still gets a
  // score rather than losing the whole attempt.
  useEffect(() => {
    if (!isTest || result || loading) return undefined;
    if (deadlineRef.current == null) deadlineRef.current = Date.now() + TEST_SECONDS * 1000;

    const read = () => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setLeft(remaining);
      // submittedRef already guards the endpoint against a double hand-in.
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
  }, [isTest, result, loading, submit]);

  const q = questions[index];
  const correction = q ? corrections[q.reading_question_id] : null;
  const answeredCount = Object.values(answers).filter(Boolean).length;
  const reviewing = Boolean(result);

  const pick = async (optionId) => {
    if (!q || correction) return;               // already marked
    setAnswers((a) => ({ ...a, [q.reading_question_id]: optionId }));
    if (isTest) return;                         // test mode marks at the end
    setChecking(true);
    try {
      const { data } = await api.post(
        `/api/reading/questions/${q.reading_question_id}/check`, { picked: optionId });
      setCorrections((c) => ({ ...c, [q.reading_question_id]: data.correction }));
    } catch {
      toast.error(t('readTest.checkFailed'));
      setAnswers((a) => { const n = { ...a }; delete n[q.reading_question_id]; return n; });
    } finally {
      setChecking(false);
    }
  };

  const handIn = () => {
    if (!user) return navigate('/login');
    const blank = questions.length - answeredCount;
    if (blank > 0 && !window.confirm(t('readTest.confirmBlank', { n: blank }))) return;
    submit();
  };

  const restart = () => {
    submittedRef.current = false;
    setAnswers({}); setCorrections({}); setResult(null);
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
  if (!q) return null;

  /* Navigator swatch: grey before answering, then green/red once a question has
     been marked — in practice that happens immediately, in test mode only after
     the paper is handed in. */
  const swatch = (item) => {
    const c = corrections[item.reading_question_id];
    if (c) return c.is_correct ? 'bg-green-500 text-white' : 'bg-red-500 text-white';
    if (answers[item.reading_question_id]) return 'bg-primary text-white';
    return 'bg-white text-gray-500 border border-violet-100';
  };

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <BackLink to={`/reading/${isTest ? 'test' : 'practice'}`} className="!mb-6"
          testid="back-to-reading-tests" />

        {/* ---------------- SCORE REPORT (after hand-in) ---------------- */}
        {reviewing && (
          <div className="mb-6 overflow-hidden rounded-3xl border border-violet-100 shadow-soft" data-testid="reading-result">
            <div className="bg-gradient-to-r from-primary to-fuchsia-600 px-6 py-6 text-white">
              <p className="text-xs font-bold uppercase tracking-wide text-white/80">
                {t('readTest.testN', { n: testNumber })}
              </p>
              <p className="mt-1 font-heading text-4xl font-extrabold">
                {result.score}<span className="text-2xl text-white/70">/{result.total}</span>
              </p>
              <p className="mt-1 text-sm text-white/90">
                {t('readTest.scorePct', { p: Math.round((result.score / result.total) * 100) })}
              </p>
            </div>
            <div className="bg-white px-6 py-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                <ListChecks size={14} weight="fill" /> {t('readTest.byLevel')}
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
                <ArrowClockwise size={16} weight="bold" /> {t('readTest.retake')}
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
                  {t('readTest.testN', { n: testNumber })}
                </p>
                {isTest && !reviewing && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${
                    left < 300 ? 'bg-red-100 text-red-700' : 'bg-white text-primary'
                  }`} data-testid="reading-timer">
                    <ClockCountdown size={13} weight="fill" /> {clock(left)}
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-gray-500">
                {t('readTest.progress', { done: answeredCount, total: questions.length })}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all"
                  style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
              </div>

              <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-6">
                {questions.map((item, i) => (
                  <button
                    key={item.reading_question_id}
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
                  data-testid="reading-submit">
                  <CheckCircle size={16} weight="fill" /> {t('readTest.handIn')}
                </button>
              )}
              {!isTest && (
                <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
                  <Lightning size={13} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                  {t('readTest.practiceHint')}
                </p>
              )}
            </div>
          </aside>

          {/* ---------------- QUESTION ---------------- */}
          <div>
            <div className="rounded-3xl border border-violet-100 bg-white p-5 shadow-xl shadow-violet-200/40 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t('readTest.questionN', { n: index + 1 })}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${LEVEL_STYLE[q.level] || 'bg-gray-100 text-gray-600'}`}>
                  {q.level}
                </span>
                {q.band && <span className="text-[11px] text-gray-500">{q.band}</span>}
                {q.doc_type && (
                  <span className="ml-auto rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-primary">
                    {q.doc_type}
                  </span>
                )}
              </div>

              {/* The document. whitespace-pre-line keeps the line breaks of a
                  note, a sign or an advert — their layout is part of the text. */}
              <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4" data-testid="reading-doc">
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-800">{q.text}</p>
              </div>

              {/* French only, as on the real paper — no translation beside the
                  document or the options. The English help appears once the
                  question has been answered. */}
              <p className="mt-5 font-heading text-base font-bold text-gray-900">{q.question_fr}</p>

              {/* -------- OPTIONS -------- */}
              <div className="mt-4 space-y-2.5">
                {(correction?.options || q.options).map((o) => {
                  const picked = answers[q.reading_question_id] === o.id;
                  const marked = Boolean(correction);
                  const isRight = marked && o.is_correct;
                  const isWrongPick = marked && picked && !o.is_correct;

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
                          <span className="font-semibold text-gray-900">{o.text}</span>
                          {isRight && <CheckCircle size={16} weight="fill" className="shrink-0 text-green-600" />}
                          {isWrongPick && <XCircle size={16} weight="fill" className="shrink-0 text-red-600" />}
                        </span>
                        {/* Why this option is right, or why it is not. Shown for
                            every option, not just the one that was picked —
                            ruling the others out is the skill being taught. */}
                        {marked && o.explanation && (
                          <span className={`mt-2 block rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            o.is_correct ? 'bg-green-100/70 text-green-900' : 'bg-white/80 text-gray-600'
                          }`}>
                            <span className="font-bold uppercase tracking-wide">
                              {o.is_correct ? t('readTest.correctLabel') : t('readTest.wrongLabel')}
                            </span>{' — '}{o.explanation}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* -------- KEY LINE + VOCABULARY -------- */}
              {correction && (
                <div className="mt-5 grid gap-4 sm:grid-cols-2" data-testid="reading-explanation">
                  {correction.key_line_fr && (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                        <Quotes size={12} weight="fill" /> {t('readTest.keyLine')}
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
                        {t('readTest.vocabulary')}
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
              )}

              {/* -------- PREV / NEXT -------- */}
              <div className="mt-6 flex items-center justify-between gap-3">
                <button onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0} className="btn-outline text-sm disabled:opacity-40">
                  <CaretLeft size={15} weight="bold" /> {t('readTest.prev')}
                </button>
                <span className="text-xs text-gray-400">{index + 1} / {questions.length}</span>
                <button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                  disabled={index === questions.length - 1}
                  className="btn-primary text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-40"
                  data-testid="reading-next">
                  {t('readTest.next')} <CaretRight size={15} weight="bold" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
