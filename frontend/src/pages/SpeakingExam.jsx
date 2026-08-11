import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ClockCountdown, CheckCircle, CaretRight, Microphone, Handshake,
  Scales, ArrowClockwise, Lock,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink } from '../components/shared';
import ConversationModal from '../components/ConversationModal';

/* Test Mode for Expression orale: one numbered sitting, the three tâches in the
   order the real exam gives them. Tâches 1 and 2 are live roleplays and run in
   this page; tâche 3 is a prepared monologue, so it hands off to the recorder
   that already implements its 2 min preparation and 2 min 30 of speech. */

const TASK_ICON = { 1: Microphone, 2: Handshake, 3: Scales };

export default function SpeakingExam() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const setNumber = parseInt(params.get('set'), 10) || null;

  const [sets, setSets] = useState([]);
  const [paper, setPaper] = useState(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(null);           // 1 | 2 while a modal is open
  const [results, setResults] = useState({});       // taskType -> graded result

  useEffect(() => {
    api.get('/api/speaking/exam-sets')
      .then(({ data }) => setSets(data.sets || []))
      .catch(() => setSets([]))
      .finally(() => setLoading(false));
  }, []);

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
    setResults({});
  };

  const startTask = (n) => {
    if (!user) return navigate('/login');
    if (n === 3) {
      // The monologue recorder owns the preparation timer; send it the question.
      navigate(`/speaking/record?tache=3&q=${encodeURIComponent(paper.task3.question)}`);
      return;
    }
    setLive(n);
  };

  const onGraded = (taskType) => (data) => {
    setResults((r) => ({ ...r, [taskType]: data }));
    setLive(null);
  };

  /* ---------------- chooser ---------------- */
  if (!setNumber) {
    return (
      <main className="overflow-x-clip bg-white">
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <BackLink to="/speaking" className="!mb-6" testid="back-to-speaking" />
          <div className="mb-3 text-center">
            <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('sexam.title')}</h1>
            <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">{t('sexam.sub')}</p>
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
                    <h3 className="mt-4 font-heading text-base font-bold text-gray-900">
                      {t('sexam.setN', { n: s.set_number })}
                    </h3>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{s.task3_question}</p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-600">{s.task2_theme}</span>
                    </div>
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
  // A real sitting runs 1 → 2 → 3 with no skipping ahead, so a tâche unlocks
  // only once the one before it has been answered.
  const unlocked = (n) => n === 1 || Boolean(results[n - 1]);
  const finished = done === 3;
  const levels = stages.map((s) => results[s.n]?.tcf_level).filter(Boolean);
  const meanScore = finished
    ? Math.round(stages.reduce((sum, s) => sum + (results[s.n]?.overall_score || 0), 0) / 3)
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
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {stages.map((s) => {
            const Icon = TASK_ICON[s.n];
            const result = results[s.n];
            return (
              <div key={s.n} className={`rounded-3xl border p-5 shadow-soft ${
                result ? 'border-green-200 bg-green-50/40' : 'border-violet-100 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    result ? 'bg-green-100 text-green-700' : 'bg-violet-100 text-primary'}`}>
                    {result ? <CheckCircle size={20} weight="fill" /> : <Icon size={20} weight="fill" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading text-sm font-bold text-gray-900">{s.label}</p>
                      {s.theme && (
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-primary">{s.theme}</span>
                      )}
                      <span className="ml-auto text-[11px] text-gray-400">{s.meta}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-gray-800">{s.brief}</p>
                    {s.hints && <p className="mt-1 text-xs italic text-gray-500">({s.hints})</p>}

                    {result ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-primary shadow-sm">
                          {result.tcf_level} · {result.overall_score}/100
                        </span>
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
              </div>
            );
          })}
        </div>

        {finished && (
          <div className="mt-5 overflow-hidden rounded-3xl border border-green-200 shadow-soft" data-testid="exam-summary">
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-5 text-white">
              <p className="text-xs font-bold uppercase tracking-wide text-white/80">{t('sexam.doneTitle')}</p>
              <p className="mt-1 font-heading text-3xl font-extrabold">{meanScore}<span className="text-xl text-white/70">/100</span></p>
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
          consigne={paper.task1.brief}
          onCancel={() => setLive(null)} onGraded={onGraded(1)} />
      )}
      {live === 2 && (
        <ConversationModal mode="tache2" tacheTitle={paper.timings['2'].name}
          consigne={paper.task2.consigne}
          onCancel={() => setLive(null)} onGraded={onGraded(2)} />
      )}
    </main>
  );
}
