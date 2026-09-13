/* One paper in the reading or listening picker.
 *
 * Shared because the two pickers were already copies of each other down to the
 * comments, and the state below is the kind that goes stale in one of them:
 * a paper the learner has already sat says so, and offers both ways back into
 * it rather than silently restarting the timed sitting they just finished.
 *
 * Only timed sittings are recorded — practice marks a question at a time and
 * writes no attempt — so an untouched-looking card means "never sat", not
 * "never opened". The copy says "sat", not "done", for that reason.
 *
 * Why two buttons and not three: there is no result page for a comprehension
 * paper to link to. The score below IS the result the product keeps, and
 * inventing a third button to a page that does not exist would be worse than
 * the two real choices — do it again against the clock, or walk through it
 * with the answers marked as you go.
 */
import { CaretRight, CheckCircle, Lock, ArrowCounterClockwise } from '@phosphor-icons/react';
import { useT } from '../i18n';

export function PaperCard({ paper, ns, isTest, accent, onOpen }) {
  const t = useT();
  const ready = paper.is_ready;
  const sat = ready ? paper.last_attempt : null;
  const pct = sat && sat.total ? Math.round((sat.score / sat.total) * 100) : null;

  const shell = `group flex flex-col overflow-hidden rounded-3xl border bg-white text-left shadow-soft transition ${
    ready ? `${accent.border} hover:-translate-y-1 hover:shadow-xl ${accent.ring}`
      : 'cursor-not-allowed border-gray-100 opacity-70'}`;

  const body = (
    <>
      <div className={`h-1.5 w-full bg-gradient-to-r ${ready ? accent.bar : 'from-gray-200 to-gray-300'}`} />
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl font-heading text-lg font-extrabold ${
            ready ? accent.icon : 'bg-gray-100 text-gray-400'}`}>
            {paper.test_number}
          </span>
          {!ready ? <Lock size={18} weight="fill" className="text-gray-300" />
            : sat ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold tabular-nums text-green-700"
                title={t(`${ns}.satOn`, { date: (sat.created_at || '').slice(0, 10) })}
                data-testid="paper-score">
                <CheckCircle size={12} weight="fill" /> {sat.score}/{sat.total}
              </span>
            ) : <CaretRight size={18} className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-400" />}
        </div>

        <h3 className="mt-4 font-heading text-base font-bold text-gray-900">
          {t(`${ns}.testN`, { n: paper.test_number })}
        </h3>
        <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">
          {!ready ? t(`${ns}.cardSoon`)
            : sat ? t(`${ns}.cardSat`, { pct, n: sat.attempts })
              : t(`${ns}.cardReady`, { n: paper.question_count })}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
            A1 → C2
          </span>
          {ready && !sat && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
              <CheckCircle size={11} weight="fill" /> {t(`${ns}.ready`)}
            </span>
          )}
        </div>
      </div>
    </>
  );

  // An untouched paper stays one big button: the whole card is the one thing
  // it can do. A card with two choices cannot be, because a button inside a
  // button is not something a browser will render.
  if (!sat) {
    return (
      <button onClick={() => onOpen(paper, isTest ? 'test' : 'practice')}
        disabled={!ready} data-testid={`${ns}-${paper.test_number}`}
        className={shell}>
        {body}
      </button>
    );
  }

  return (
    <div className={`${shell} cursor-default`} data-testid={`${ns}-${paper.test_number}`}>
      {body}
      <div className="flex gap-2 border-t border-gray-100 p-4 pt-3">
        {/* The mode the learner is already browsing first, because that is the
            one they came here for. */}
        <button onClick={() => onOpen(paper, isTest ? 'test' : 'practice')}
          data-testid="paper-again"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white transition hover:opacity-90">
          <ArrowCounterClockwise size={14} weight="bold" />
          {isTest ? t(`${ns}.retakeTest`) : t(`${ns}.practiseAgain`)}
        </button>
        <button onClick={() => onOpen(paper, isTest ? 'practice' : 'test')}
          data-testid="paper-other-mode"
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:border-primary hover:text-primary">
          {isTest ? t(`${ns}.practiseInstead`) : t(`${ns}.sitAsTest`)}
        </button>
      </div>
    </div>
  );
}
