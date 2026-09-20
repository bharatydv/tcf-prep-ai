/* The sections of the speaking result that are about the learner rather than
 * about the answer.
 *
 * The result page used to be an error report: here is your level, here is
 * everything that was wrong. That is a correct description of one answer and
 * a poor way to teach anybody, because it answers none of the questions the
 * person reading it actually has — what did I do right, what should I fix
 * first, is this the same mistake as last time, and am I getting better.
 *
 * Each section here answers one of those. They live in their own file because
 * SpeakingResult is already long and because none of these shares anything
 * with the correction table beyond the same result object.
 *
 * Kept free of react-router on purpose: the one link out of here is a plain
 * <a>. components/shared.jsx imports react-router, whose exports map CRA's
 * Jest cannot resolve, and anything that imports it becomes untestable by
 * association — the same constraint TranscriptDiff documents.
 */
import { markOutOf20, nclcFromMark } from '../lib/tcf';
import { useT } from '../i18n';

/* French names for the grader's categories, as the correction table uses. */
export const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

/* Three states a row can be in, mirroring VALID_ERROR_KINDS in
   backend/server.py. Absent on a correction the grader did not label, which
   is why nothing here falls back to 'error': calling a stylistic suggestion a
   mistake is the thing the field exists to prevent. */
export const KIND_TONE = {
  error: 'bg-rose-50 text-rose-700',
  better: 'bg-amber-50 text-amber-800',
  upgrade: 'bg-blue-50 text-blue-700',
};

export const KIND_LABEL = {
  error: 'report.kindError',
  better: 'report.kindBetter',
  upgrade: 'report.kindUpgrade',
};

/* One error is not "1 errors". The dictionary does no pluralisation of its
   own, so the count picks the key — two lines here, and a wrong sentence on
   every single-mistake result otherwise. */
function countLabel(t, n, one, many) {
  return n === 1 ? t(one) : t(many, { n });
}

/* A section shell, so eleven sections do not each invent their own heading. */
export function Panel({ title, description, aside, tone = '', children, testId }) {
  return (
    <section className={`rounded-3xl border p-6 shadow-soft ${tone || 'border-violet-100 bg-white'}`}
      data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-extrabold text-gray-900">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
          )}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ hero ---
   The three numbers, first, because they are what the page is for. The mark
   out of 20 rather than the raw score: 20 is what the exam reports and what a
   candidate's target is expressed in. */
export function ResultHero({ result }) {
  const t = useT();
  const level = result.tcf_level;
  const mark = markOutOf20(result.overall_score, level);
  const nclc = nclcFromMark(mark);
  const stats = [
    [mark === null ? '—' : `${mark}/20`, t('report.scoreLabel')],
    [level || '—', t('report.levelLabel')],
    [nclc ? `CLB ${nclc}` : '—', t('report.clbLabel')],
  ];
  return (
    <section className="rounded-3xl bg-gradient-to-br from-primary to-fuchsia-600 p-6 text-white shadow-lg shadow-violet-200/50"
      data-testid="result-hero">
      <p className="text-[11px] font-black uppercase tracking-wider text-white/75">
        {t('report.eyebrow')}
      </p>
      <h2 className="mt-1 font-heading text-2xl font-extrabold tracking-tight">
        {t('report.title')}
      </h2>
      <p className="mt-1 text-sm text-white/85">{t('report.subtitle')}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-2xl bg-white p-4">
            <p className="font-heading text-2xl font-extrabold leading-none text-primary">{value}</p>
            <p className="mt-1.5 text-[11px] text-gray-500">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- did well / -----
   ------------------------------------------------------- top priorities ---
   Side by side, and in that order. What went right comes first because a page
   that opens with a list of faults is one most people stop reading. */
/* What the grader said went well, and a true fallback when it said nothing.
 *
 * The model is asked for strengths and usually returns them, but not always —
 * and a page whose whole premise is "what did I do right, first" must not
 * quietly lose that section on the results where the model was terse. When
 * there is no list, the relevance verdict stands in: the grader judged the
 * answer on topic, which is a real thing the candidate did and is not
 * invented here. When even that is missing the section stays out, because the
 * alternative is praise nobody earned. */
export function strengthLines(result) {
  const listed = Array.isArray(result?.strengths)
    ? result.strengths.filter((s) => String(s || '').trim())
    : [];
  if (listed.length) return listed;
  const relevance = String(result?.relevance_comment || '').trim();
  if (result?.answers_question && relevance) return [relevance];
  return [];
}

export function DidWell({ result, strengths: given }) {
  const t = useT();
  const strengths = given || strengthLines(result);
  if (!strengths.length) return null;
  return (
    <Panel title={t('report.didWell')} description={t('report.didWellSub')}
      tone="border-emerald-100 bg-emerald-50/50" testId="did-well">
      <ul className="space-y-2">
        {strengths.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-emerald-900">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            {s}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* The three categories that cost the most, counted from the corrections.
   Counted rather than asked of the model: the model already listed the
   errors, and a second opinion about its own list is one more thing that can
   disagree with what is on screen. */
export function topPriorities(errors) {
  const counts = {};
  (errors || []).forEach((e) => {
    // Style suggestions are not priorities — that is the whole point of the
    // distinction the Type column now draws.
    if (e.category === 'improvement' || e.kind === 'upgrade') return;
    counts[e.category] = (counts[e.category] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));
}

const PRIORITY_DOT = ['bg-rose-500', 'bg-amber-500', 'bg-blue-500'];

export function Priorities({ errors, practiceHref }) {
  const t = useT();
  const rows = topPriorities(errors);
  if (!rows.length) return null;
  return (
    <Panel title={t('report.priorities')} description={t('report.prioritiesSub')}
      testId="top-priorities">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.category}
            className="flex items-center gap-3 rounded-2xl border border-violet-100 px-4 py-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_DOT[i]}`} />
            <span className="flex-1 text-sm font-bold text-gray-900">
              {CAT_LABELS[r.category] || r.category}
            </span>
            <span className="text-xs text-gray-500">{countLabel(t, r.count, 'report.oneError', 'report.nErrors')}</span>
          </div>
        ))}
      </div>
      <a href={practiceHref}
        className="btn-outline mt-4 flex w-full justify-center !py-2.5 text-sm"
        data-testid="practice-priorities">
        {t('report.practicePriorities')}
      </a>
    </Panel>
  );
}

/* ------------------------------------------------------------- recurring ---
   The mistakes that are not new. More important than any single correction on
   this page, because a mistake made three times is a habit and a mistake made
   once is an accident — and the page cannot tell them apart without history. */
export function Recurring({ items, practiceHref }) {
  const t = useT();
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <Panel title={t('report.recurring')} description={t('report.recurringSub')}
      tone="border-amber-100 bg-amber-50/40" testId="recurring-mistakes"
      aside={(
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">
          {t('report.acrossAttempts')}
        </span>
      )}>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((r) => (
          <div key={r.category} className="rounded-2xl border border-amber-100 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-gray-900">
                {CAT_LABELS[r.category] || r.category}
              </p>
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                {countLabel(t, r.times, 'report.oneTime', 'report.nTimes')}
              </span>
            </div>
            {r.example?.error && (
              <p className="mt-2.5 rounded-xl bg-amber-50/60 px-3 py-2 text-xs">
                <span className="text-rose-700">{r.example.error}</span>
                <span className="mx-1.5 text-gray-400">→</span>
                <span className="font-semibold text-emerald-700">{r.example.correction}</span>
              </p>
            )}
          </div>
        ))}
      </div>
      <a href={practiceHref}
        className="btn-outline mt-4 flex w-full justify-center !py-2.5 text-sm"
        data-testid="practice-recurring">
        {t('report.practiceRecurring')}
      </a>
    </Panel>
  );
}

/* -------------------------------------------------------------- progress ---
   This attempt against the last one. Absent on a first attempt rather than
   shown as an improvement of the entire score. */
export function Progress({ previous, result }) {
  const t = useT();
  if (!previous) return null;
  const now = markOutOf20(result.overall_score, result.tcf_level);
  const then = markOutOf20(previous.score, previous.level);
  if (now === null || then === null) return null;
  const delta = now - then;
  const verdict = delta > 0
    ? ['text-emerald-600', t('report.improvedBy', { n: delta })]
    : delta < 0
      ? ['text-rose-600', t('report.downBy', { n: Math.abs(delta) })]
      : ['text-gray-500', t('report.sameAsLast')];
  return (
    <Panel title={t('report.progress')} description={t('report.progressSub')}
      testId="attempt-progress">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-violet-100 p-4">
          <p className="text-[11px] text-gray-500">{t('report.previousAttempt')}</p>
          <p className="mt-1 font-heading text-2xl font-extrabold text-gray-400">{then}/20</p>
          <p className="text-[11px] text-gray-500">{countLabel(t, previous.errors, 'report.oneError', 'report.nErrors')}</p>
        </div>
        <div className="rounded-2xl border border-violet-100 p-4">
          <p className="text-[11px] text-gray-500">{t('report.currentAttempt')}</p>
          <p className="mt-1 font-heading text-2xl font-extrabold text-primary">{now}/20</p>
          <p className={`text-[11px] font-bold ${verdict[0]}`}>{verdict[1]}</p>
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- vocabulary -
   A short list, deliberately. A page that hands somebody forty expressions
   has handed them none. */
export function Vocabulary({ items }) {
  const t = useT();
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <Panel title={t('report.vocab')} description={t('report.vocabSub')} testId="vocabulary">
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((v, i) => (
          <div key={i} className="rounded-2xl border border-violet-100 px-4 py-3">
            <p className="text-sm font-bold text-primary">{v}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- next step ---
   What to practise, in order, ending with the advice not to reach for
   advanced French before the basics hold. */
export function NextStep({ focusAreas, practiceHref }) {
  const t = useT();
  const areas = Array.isArray(focusAreas) ? focusAreas.filter(Boolean) : [];
  if (!areas.length) return null;
  return (
    <Panel title={t('report.nextStep')} description={t('report.nextStepSub')}
      tone="border-violet-200 bg-violet-50/40" testId="next-step">
      <div className="grid gap-4 sm:grid-cols-[1.1fr_.9fr]">
        <div>
          <p className="text-sm leading-relaxed text-gray-700">{t('report.nextStepBody')}</p>
          <a href={practiceHref}
            className="btn-primary mt-4 inline-flex !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-5 !py-2.5 text-sm">
            {t('report.startPractice')}
          </a>
        </div>
        <div className="grid gap-2">
          {areas.slice(0, 4).map((a, i) => (
            <div key={i} className="rounded-2xl border border-violet-100 bg-white px-4 py-3 text-xs leading-relaxed text-gray-700">
              <span className="font-bold text-primary">{i + 1}.</span> {a}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- practice --
   One button, its own card, because it is the thing the page is asking the
   reader to go and do. */
export function PracticeCta({ practiceHref }) {
  const t = useT();
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-6"
      data-testid="practice-cta">
      <div className="min-w-0">
        <h2 className="font-heading text-base font-extrabold text-gray-900">
          {t('report.practiceTitle')}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">{t('report.practiceBody')}</p>
      </div>
      <a href={practiceHref}
        className="btn-primary shrink-0 !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-5 !py-2.5 text-sm">
        {t('report.practiceCta')}
      </a>
    </section>
  );
}
