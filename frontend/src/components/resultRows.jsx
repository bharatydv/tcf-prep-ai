/* The dashboard's result lists: one row shape for every graded paper and every
 * graded answer, whichever skill produced it.
 *
 * The dashboard grew its speaking sections first — whole Expression orale
 * papers, and the tâches practised loose — and Expression écrite never got
 * them. A written paper reached the page only as an undifferentiated line of
 * the history table, named by its CEFR level, so "how did I do on the writing
 * test I sat on Tuesday" was a question the page held the answer to and could
 * not be asked. Writing the same section a second time would have produced two
 * layouts that agree today and drift apart on the first change to either, so
 * both skills now render through here.
 *
 * Kept free of react-router on purpose, which is why the wrapper element is a
 * prop: components/shared.jsx imports react-router, whose exports map CRA's
 * Jest cannot resolve, and anything importing it becomes untestable by
 * association. The same constraint speakingReport.jsx documents.
 */
import { useState } from 'react';
import { useT } from '../i18n';

/* Each skill keeps the hue it has in the filter bar above, so a row can be
   placed without reading its heading. Written out as whole class names, never
   interpolated: Tailwind's JIT scans for complete names, and a class
   assembled from a variable has no CSS generated for it at all. */
const TINT = {
  speaking: { badge: 'bg-pink-100 text-pink-700', band: 'bg-pink-100 text-pink-700',
    hover: 'hover:border-pink-200 hover:bg-pink-50/40' },
  writing: { badge: 'bg-violet-100 text-primary', band: 'bg-violet-100 text-primary',
    hover: 'hover:border-violet-200 hover:bg-violet-50/40' },
};

/* One result: what it was, when, and the mark with the band that mark
 * converts to. `pending` replaces the mark for a paper that is not finished —
 * a mark averaged over the tâches that happen to have been answered is not
 * this candidate's result for the skill, and printing one would read as
 * though it were.
 */
export function ResultRow({
  skill, href, as: As = 'a', badge, title, meta,
  mark = null, band = null, pending = null, complete = false, testid,
}) {
  const t = useT();
  const tint = TINT[skill] || TINT.writing;
  // react-router's Link takes `to`; a plain anchor takes `href`. Passing both
  // would put an unknown `to` attribute on the <a> and warn on every row.
  const link = As === 'a' ? { href } : { to: href };
  return (
    <As {...link} data-testid={testid}
      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 px-4 py-3 transition ${tint.hover}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-heading text-sm font-extrabold ${tint.badge}`}>
        {badge}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-sm font-bold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-500">{meta}</span>
      </span>
      {pending ? (
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700"
          data-testid={testid ? `${testid}-pending` : undefined}>
          {pending}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="font-heading text-lg font-extrabold text-gray-900">
            {mark ?? '—'}<span className="text-xs text-gray-400">/20</span>
          </span>
          {band && (
            /* A finished paper's band is the green one the exam pages use; a
               single practice answer keeps the skill's own tint, because it is
               one attempt rather than a result for the paper. */
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
              complete ? 'bg-green-100 text-green-700' : tint.band}`}>
              {t('sexam.clb', { level: band })}
            </span>
          )}
        </span>
      )}
    </As>
  );
}

/* A card of them, with the heading, an optional notice, and a cap on how many
 * are shown before being asked. Twenty rows is a ledger, not a glance. */
export function ResultSection({
  title, note, notice, rows, testid, initial = 5, className = 'mt-5',
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (!rows.length && !notice) return null;
  const shown = all ? rows : rows.slice(0, initial);
  return (
    <section className={`card p-4 sm:p-6 ${className}`} data-testid={testid}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-[15px] font-bold text-gray-900">{title}</h2>
        {note && <span className="text-xs font-medium text-gray-400">{note}</span>}
      </div>
      {notice}
      <div className="space-y-2">{shown}</div>
      {!all && rows.length > initial && (
        <button type="button" onClick={() => setAll(true)}
          data-testid={testid ? `${testid}-more` : undefined}
          className="mt-3 text-xs font-semibold text-primary underline">
          {t('dash.showOlder', { n: rows.length - initial })}
        </button>
      )}
    </section>
  );
}

/* The per-tâche line under a paper's title: which tâches were answered and at
 * what level. An unanswered one is an em dash rather than absent, so three
 * tâches always occupy three slots and a paper missing its middle one is
 * readable as exactly that. */
export function taskLine(t, tasks) {
  return [1, 2, 3].map((n) => {
    const task = tasks[String(n)] || null;
    return (
      <span key={n} className="mr-2">
        {t('hist.tache', { n })} {task ? task.tcf_level : '—'}
      </span>
    );
  });
}
