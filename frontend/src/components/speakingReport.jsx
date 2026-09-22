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
import { useState } from 'react';
import { markOutOf20, nclcFromMark, levelFromScore } from '../lib/tcf';
import { useT } from '../i18n';

/* ---------------------------------------------------------------------------
 * THE DESIGN TOKENS
 * ---------------------------------------------------------------------------
 * Taken literally from the agreed prototype rather than approximated with the
 * nearest Tailwind step: #e7e2f2 is not gray-200, #effcf3 is not green-50, and
 * a page assembled out of near-misses does not look like the thing that was
 * signed off. They are named here once so a colour has one home, and the
 * correction table imports the same ones.
 *
 * Written out literally every time, never interpolated: Tailwind's JIT scans
 * this file for whole class names, so a class assembled from a variable is a
 * class whose CSS is never generated and whose colour silently does not
 * apply. `border-[#e7e2f2]` is the only form that works here.
 *
 * The three gradients are classes rather than inline styles for a related
 * reason: an inline background is set through the CSSOM, and jsdom drops a
 * `linear-gradient()` it cannot parse, so the hero rendered as white text on
 * white in every test and preview while looking fine in a browser. As a class
 * it is ordinary CSS and behaves the same everywhere.
 */

export const TOKENS = {
  card: `rounded-[18px] border border-[#e7e2f2] bg-white p-[22px] shadow-[0_6px_22px_rgba(35,20,70,0.05)]`,
  title: 'font-heading text-[18px] font-extrabold tracking-[-0.25px] text-[#171322]',
  desc: `mt-[4px] text-[12px] text-[#64748b]`,
  primary: `rounded-[10px] bg-[#7c3aed] px-[14px] py-[10px] text-center text-[12px] font-extrabold text-white transition hover:bg-[#6d28d9]`,
  secondary: `rounded-[10px] bg-[#f2edff] px-[14px] py-[10px] text-center text-[12px] font-extrabold text-[#7c3aed] transition hover:bg-[#e9e0ff]`,
  /* Badges: 9px, 900, uppercase, wide-tracked pills. */
  badge: 'inline-flex items-center rounded-full px-[8px] py-[5px] text-[9px] font-black uppercase leading-none tracking-[0.05em]',
};

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
  error: 'bg-[#fff1f2] text-[#b91c1c]',
  better: 'bg-[#fff8e7] text-[#92400e]',
  upgrade: 'bg-[#eff6ff] text-[#1d4ed8]',
};

/* The row tint that goes with each, straight from the prototype. Almost
   white on purpose — enough to group a row, not enough to shout. */
export const KIND_ROW = {
  error: 'bg-[#fffdfd]',
  better: 'bg-[#fffefa]',
  upgrade: 'bg-[#fcfdff]',
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
    <section className={`${TOKENS.card} ${tone}`} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-[18px]">
        <div className="min-w-0">
          <h2 className={TOKENS.title}>{title}</h2>
          {description && <p className={TOKENS.desc}>{description}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-[15px]">{children}</div>
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
    <section
      className="rounded-[22px] bg-[image:linear-gradient(110deg,#6d28d9,#a21caf)] px-[29px] py-[27px] text-white shadow-[0_14px_35px_rgba(124,58,237,0.18)]"
      data-testid="result-hero">
      {/* No heading here. The prototype's hero carries one because it is a
          whole page; this is a block inside a page that already has a title
          above it, and a second "Your personalised feedback" under the first
          heading is a header for a section the reader is already in.
          The three numbers are the result, and they are what is left. */}
      <div className="grid gap-[12px] sm:grid-cols-3">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-[15px] bg-white px-[17px] py-[15px]">
            <p className={`text-[27px] font-black leading-none text-[#7c3aed]`}>{value}</p>
            <p className={`mt-[6px] text-[11px] text-[#64748b]`}>{label}</p>
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
      tone="!border-[#ccefd6] !bg-[#effcf3] [&_h2]:!text-[#166534]" testId="did-well">
      <ul className="list-disc pl-[20px]">
        {strengths.map((s, i) => (
          <li key={i} className="my-[7px] text-[13px] leading-[1.45] text-[#334155]">{s}</li>
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

const PRIORITY_DOT = ['bg-[#ef4444]', 'bg-[#f59e0b]', 'bg-[#3b82f6]'];

/* The corrections behind one priority, in the order they were said.
   Same filter as topPriorities, or the count on the row would not match the
   number of lines that open underneath it. */
function errorsIn(errors, category) {
  return (errors || []).filter((e) => (
    e.category === category && e.category !== 'improvement' && e.kind !== 'upgrade'
  ));
}

export function Priorities({ errors, practiceHref }) {
  const t = useT();
  const rows = topPriorities(errors);
  /* Which one is open, by category. One at a time: three lists open at once
     is the correction table again, and the table is already below. */
  const [open, setOpen] = useState(null);
  if (!rows.length) return null;
  return (
    <Panel title={t('report.priorities')} description={t('report.prioritiesSub')}
      testId="top-priorities">
      {rows.map((r, i) => {
        const isOpen = open === r.category;
        const found = errorsIn(errors, r.category);
        return (
          <div key={r.category}
            className="mt-[8px] overflow-hidden rounded-[12px] border border-[#e7e2f2] first:mt-0">
            {/* A row somebody can press. "Prépositions — 4 errors" names the
                habit; which four sentences it was said in is the thing that
                makes it fixable, and it was only ever findable by reading
                down the table below looking for the word. */}
            <button type="button"
              onClick={() => setOpen(isOpen ? null : r.category)}
              aria-expanded={isOpen}
              data-testid={`priority-${r.category}`}
              title={t(isOpen ? 'report.prioritiesClose' : 'report.prioritiesOpen')}
              className={`flex w-full items-center gap-[11px] px-[13px] py-[11px] text-left transition hover:bg-[#faf8ff] ${isOpen ? 'bg-[#faf8ff]' : ''}`}>
              <span className={`h-[10px] w-[10px] flex-none rounded-full ${PRIORITY_DOT[i]}`} />
              <span className="flex-1 text-[13px] font-extrabold text-[#171322]">
                {CAT_LABELS[r.category] || r.category}
              </span>
              <span className="text-[11px] text-[#64748b]">
                {countLabel(t, r.count, 'report.oneError', 'report.nErrors')}
              </span>
              {/* A caret drawn in CSS rather than an icon import: this file
                  deliberately depends on nothing but i18n and lib/tcf. */}
              <span aria-hidden="true"
                className={`flex-none text-[10px] text-[#7c3aed] transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                &#9654;
              </span>
            </button>
            {isOpen && (
              <ul className="border-t border-[#e7e2f2] bg-[#fcfbff] px-[13px] py-[10px]"
                data-testid={`priority-errors-${r.category}`}>
                {found.map((e, n) => (
                  <li key={n} className="border-b border-[#efeaf9] py-[8px] last:border-b-0">
                    {/* Said, then said correctly. Nothing struck through:
                        the wrong version is what they will recognise, and
                        crossing it out makes it the hardest line to read. */}
                    <p className="text-[12px] leading-[1.45] text-[#334155]">
                      <span className="text-[#b91c1c]">{e.error}</span>
                      <span className="px-[6px] text-[#94a3b8]">&rarr;</span>
                      <span className="font-extrabold text-[#166534]">{e.correction}</span>
                    </p>
                    {e.remember && (
                      <p className="mt-[3px] text-[11px] leading-[1.4] text-[#4c1d95]">
                        {e.remember}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <a href={practiceHref} className={`${TOKENS.secondary} mt-[12px] block w-full`}
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
      tone="!border-[#f4dfae] !bg-[#fffaf0]" testId="recurring-mistakes"
      aside={(
        <span className={`${TOKENS.badge} ${KIND_TONE.better}`}>
          {t('report.acrossAttempts')}
        </span>
      )}>
      <div className="grid gap-[13px] sm:grid-cols-2">
        {items.map((r) => (
          <div key={r.category} className="rounded-[13px] border border-[#f0e2bf] bg-white p-[14px]">
            <div className="flex items-center justify-between gap-[10px]">
              <p className="text-[13px] font-black text-[#171322]">
                {CAT_LABELS[r.category] || r.category}
              </p>
              <span className="shrink-0 rounded-full bg-[#fff8e7] px-[7px] py-[5px] text-[10px] font-black text-[#92400e]">
                {countLabel(t, r.times, 'report.oneTime', 'report.nTimes')}
              </span>
            </div>
            {r.example?.error && (
              <p className="mt-[9px] rounded-[9px] bg-[#fffaf0] px-[10px] py-[8px] text-[11px]">
                <span className="text-[#b91c1c]">{r.example.error}</span>
                <span className="mx-[6px] text-[#94a3b8]">→</span>
                <span className="font-extrabold text-[#15803d]">{r.example.correction}</span>
              </p>
            )}
          </div>
        ))}
      </div>
      <a href={practiceHref} className={`${TOKENS.secondary} mt-[12px] inline-block`}
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
    ? ['text-[#15803d]', `↑ ${t('report.improvedBy', { n: delta })}`]
    : delta < 0
      ? ['text-[#b91c1c]', `↓ ${t('report.downBy', { n: Math.abs(delta) })}`]
      : [`text-[#64748b]`, t('report.sameAsLast')];
  return (
    <Panel title={t('report.progress')} description={t('report.progressSub')}
      testId="attempt-progress">
      <div className="grid gap-[12px] sm:grid-cols-2">
        <div className={`rounded-[13px] border border-[#e7e2f2] p-[15px]`}>
          <p className={`text-[11px] text-[#64748b]`}>{t('report.previousAttempt')}</p>
          <p className="my-[3px] text-[24px] font-black text-[#94a3b8]">{then}/20</p>
          <p className={`text-[11px] text-[#64748b]`}>
            {countLabel(t, previous.errors, 'report.oneError', 'report.nErrors')}
          </p>
        </div>
        <div className={`rounded-[13px] border border-[#e7e2f2] p-[15px]`}>
          <p className={`text-[11px] text-[#64748b]`}>{t('report.currentAttempt')}</p>
          <p className={`my-[3px] text-[24px] font-black text-[#7c3aed]`}>{now}/20</p>
          <p className={`text-[11px] font-extrabold ${verdict[0]}`}>{verdict[1]}</p>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- vocabulary --
   A short list, deliberately. A page that hands somebody forty expressions
   has handed them none. */
export function Vocabulary({ items }) {
  const t = useT();
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <Panel title={t('report.vocab')} description={t('report.vocabSub')} testId="vocabulary">
      <div className="grid gap-[9px] sm:grid-cols-2">
        {items.map((v, i) => {
          const phrase = typeof v === 'string' ? v : v?.phrase;
          const meaning = typeof v === 'string' ? '' : v?.meaning;
          if (!phrase) return null;
          return (
            <div key={i} className={`rounded-[11px] border border-[#e7e2f2] px-[12px] py-[11px]`}>
              <p className="text-[13px] font-extrabold text-[#6d28d9]">{phrase}</p>
              {meaning && <p className="mt-[3px] text-[11px] text-[#64748b]">{meaning}</p>}
            </div>
          );
        })}
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
    <section
      className="rounded-[18px] border border-[#ddd2ff] bg-[image:linear-gradient(120deg,#f8f5ff,#fff)] p-[22px] shadow-[0_6px_22px_rgba(35,20,70,0.05)]"
      data-testid="next-step">
      <div className="grid gap-[18px] min-[900px]:grid-cols-[1.2fr_.8fr]">
        <div>
          <h3 className="font-heading text-[16px] font-extrabold text-[#171322]">
            {t('report.nextStep')}
          </h3>
          <p className={`mt-[8px] text-[12px] leading-[1.6] text-[#64748b]`}>
            {t('report.nextStepBody')}
          </p>
          <a href={practiceHref} className={`${TOKENS.primary} mt-[14px] inline-block`}>
            {t('report.startPractice')}
          </a>
        </div>
        <div className="grid content-start gap-[8px]">
          {areas.slice(0, 4).map((a, i) => (
            <div key={i}
              className={`rounded-[11px] border border-[#e7e2f2] bg-white px-[12px] py-[10px] text-[12px] leading-[1.45] text-[#334155]`}>
              <b className={`text-[#7c3aed]`}>{i + 1}.</b> {a}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- profile ---
   The four things an examiner marks, as four cards.
 *
 * The order is the prototype's — language, then task, then organisation, with
 * pronunciation last — rather than the grid's, which opens with phonology.
 * That matters here for a practical reason: phonology is the criterion most
 * often missing, because it needs a model that listened to the audio rather
 * than read the transcript, and a gap at the end of a row of four is a row of
 * three. A gap at the front is a hole.
 *
 * The labels are the ones the grid below already uses. The prototype calls
 * these "Task response" and "Pronunciation", which read more easily, but two
 * names for one criterion on one page is worse than a stiff name — and these
 * are the examiner's own terms, which is what a candidate will meet again.
 */
const PROFILE_CRITERIA = [
  ['linguistic', 'grid.linguistic'],
  ['adequacy', 'grid.adequacy'],
  ['discourse', 'grid.discourse'],
  ['phonology', 'grid.phonology'],
];

export function ProfileCards({ criteria }) {
  const t = useT();
  const cards = PROFILE_CRITERIA
    .map(([key, label]) => [key, label, criteria?.[key]])
    // Only what was actually marked. A criterion nobody judged rendered as a
    // zero-width bar would say the candidate failed it.
    .filter(([, , c]) => c && levelFromScore(c.score));
  if (!cards.length) return null;
  return (
    <div className="grid gap-[10px] sm:grid-cols-2 min-[900px]:grid-cols-4"
      data-testid="profile-cards">
      {cards.map(([key, label, c]) => (
        <div key={key} className="rounded-[13px] border border-[#e7e2f2] p-[14px]">
          <p className="text-[11px] text-[#64748b]">{t(label)}</p>
          <p className="mt-[4px] text-[20px] font-black text-[#171322]">
            {levelFromScore(c.score)}
          </p>
          {/* A fixed floor, so four cards whose comments run to different
              lengths still line their bars up with each other. */}
          <p className="mt-[5px] min-h-[31px] text-[11px] leading-[1.45] text-[#334155]">
            {c.comment}
          </p>
          <div className="mt-[10px] h-[6px] overflow-hidden rounded-full bg-[#eeeaf8]">
            <div className="h-full rounded-full bg-[image:linear-gradient(90deg,#7c3aed,#c026d3)]"
              style={{ width: `${Math.max(0, Math.min(100, Number(c.score) || 0))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- practice --
   One button, its own card, because it is the thing the page is asking the
   reader to go and do. */
export function PracticeCta({ practiceHref }) {
  const t = useT();
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-[20px] rounded-[18px] border border-[#e8d5ff] bg-[image:linear-gradient(115deg,#faf5ff,#fdf2f8)] p-[22px] shadow-[0_6px_22px_rgba(35,20,70,0.05)]"
      data-testid="practice-cta">
      <div className="min-w-0">
        <h2 className="font-heading text-[18px] font-extrabold tracking-[-0.25px] text-[#581c87]">
          {t('report.practiceTitle')}
        </h2>
        <p className={`mt-[5px] text-[12px] text-[#64748b]`}>{t('report.practiceBody')}</p>
      </div>
      <a href={practiceHref} className={`${TOKENS.primary} shrink-0`}>
        {t('report.practiceCta')}
      </a>
    </section>
  );
}
