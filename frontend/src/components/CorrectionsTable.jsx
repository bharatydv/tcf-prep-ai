/* The corrections table: what you said, what it should have been, and why.
 *
 * Lifted out of SpeakingResult so the same table can be read somewhere other
 * than the page that produced one result. The dashboard asks the same two
 * questions across everything a learner has written and said — which
 * corrections matter most, and which ones keep coming back — and answering
 * them in a different shape meant the learner had to re-learn how to read
 * their own mistakes on every screen.
 *
 * Everything that only a result page can supply is optional. `tts` adds the
 * play buttons, `clips`/`own` play the candidate's own recording where there
 * is one; with neither, the table is the same five columns without audio,
 * which is exactly what an aggregated list can honestly offer.
 */
import { useMemo, useState } from 'react';
import { SpeakButton } from './SpeakButton';
import { OwnVoiceButton } from './OwnVoiceButton';
import { CorrectionText } from './CorrectionText';
import {
  TOKENS, catLabel, KIND_TONE, KIND_ROW, KIND_LABEL,
} from './speakingReport';
import { useT } from '../i18n';

/* How much an error costs, mirroring VALID_SEVERITIES in backend/server.py.
   Absent on a correction the grader did not weigh, which is why there is no
   default entry here to fall back to. */
const SEVERITY_TONE = {
  major: 'bg-[#fff1f2] text-[#b91c1c]',
  moderate: 'bg-[#fff8e7] text-[#92400e]',
  minor: 'bg-[#f1f5f9] text-[#64748b]',
};

/* One cell, the prototype's padding and rule. Named because it is repeated
   five times a row and a table whose columns disagree about their padding by
   a pixel is a table that looks slightly broken and cannot be pointed at. */
const CELL = 'border-b border-[#e7e2f2] px-[13px] py-[14px] align-top text-[12px] break-words';

/* What turns one <td> into a labelled line of a card below lg.
 *
 * The same cells, restyled — not a second copy of the rows. Two copies would
 * mean two play buttons carrying the same id, and the synthesiser keys on the
 * id: pressing one would stop the other. The column heading comes back as the
 * label through `data-label`, so nothing on the row loses its name when the
 * header row goes away. */
const STACK = 'max-lg:block max-lg:w-full max-lg:border-b-0 max-lg:px-[14px] max-lg:pb-0 max-lg:pt-[10px] max-lg:before:mb-[4px] max-lg:before:block max-lg:before:text-[9px] max-lg:before:font-bold max-lg:before:uppercase max-lg:before:tracking-[0.06em] max-lg:before:text-[#64748b] max-lg:before:content-[attr(data-label)]';

/* The columns, as shares of the card rather than pixels, so the table is
   always exactly as wide as the space it has. Written out as whole class
   names because Tailwind's JIT reads this file for literals — see the note in
   speakingReport. The Remember column only exists when something fills it,
   and the other four widen to take back its share. */
const COLUMNS = (hasRemember) => (hasRemember
  ? [['speak.colSaid', 'w-[19%]'], ['speak.colFix', 'w-[19%]'],
     ['speak.colType', 'w-[12%]'], ['speak.colWhy', 'w-[26%]'],
     ['report.colRemember', 'w-[24%]']]
  : [['speak.colSaid', 'w-[24%]'], ['speak.colFix', 'w-[24%]'],
     ['speak.colType', 'w-[14%]'], ['speak.colWhy', 'w-[38%]']]);

/* How many corrections are shown before "View all". Enough to be worth
   reading, few enough that the page does not open with twenty rows. */
export const IMPORTANT_COUNT = 5;

/* Highest-impact first.
 *
 * The grader returns its errors in the order they were said, which is the one
 * order that carries no information about which of them matters. A real
 * mistake outranks a stylistic suggestion, and a major outranks a minor —
 * both are stated per row now, so the page can sort by them instead of
 * hoping the reader works it out.
 *
 * A row the grader did not label sits with the errors rather than below the
 * upgrades: an unlabelled row is an old result, and every row on an old
 * result was a mistake.
 */
const KIND_RANK = { error: 0, better: 1, upgrade: 2 };
const SEVERITY_RANK = { major: 0, moderate: 1, minor: 2 };

export function rankErrors(errors) {
  return (errors || [])
    .map((e, at) => ({ e, at }))
    .sort((a, b) => {
      const kind = (KIND_RANK[a.e.kind] ?? 0) - (KIND_RANK[b.e.kind] ?? 0);
      if (kind) return kind;
      const sev = (SEVERITY_RANK[a.e.severity] ?? 1) - (SEVERITY_RANK[b.e.severity] ?? 1);
      if (sev) return sev;
      return a.at - b.at;   // stable: the order they were said decides the rest
    });
}

export default function CorrectionsTable({
  errors,
  /* Ranked by impact unless the caller has its own order worth keeping — the
     recurring list is already sorted by how often each one came back, which
     is the whole reason it is a separate list. */
  rank = true,
  title = null, desc = null,
  tts = null, clips = null, own = null, idPrefix = '',
  testid = 'corrections-table',
  // A "×4" badge on rows that carry one: how often this mistake has recurred.
  repeats = false,
  className = '',
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);

  const ranked = useMemo(
    () => (rank ? rankErrors(errors) : (errors || []).map((e, at) => ({ e, at }))),
    [errors, rank]);

  if (!ranked.length) return null;

  const rows = showAll ? ranked : ranked.slice(0, IMPORTANT_COUNT);
  const hasMore = ranked.length > IMPORTANT_COUNT;
  /* Over every correction rather than the ones on screen, so the table does
     not gain a column halfway down "View all". */
  const hasRemember = ranked.some(({ e }) => e.remember);

  return (
    <section className={`${TOKENS.card} ${className}`} data-testid={testid}>
      <h2 className={TOKENS.title}>{title || t('report.corrections')}</h2>
      {/* The subtitle names the Remember column, so it only says so when
          there is one to name. */}
      <p className={TOKENS.desc}>
        {desc || t(hasRemember ? 'report.correctionsSub' : 'report.correctionsSubPlain')}
      </p>

      {/* The legend earns its place the moment a row can be something other
          than a mistake: without it "Upgrade" reads as a fourth severity. */}
      <div className="mb-[12px] mt-[15px] flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex flex-wrap gap-[7px]">
          {Object.keys(KIND_TONE).map((k) => (
            <span key={k} className={`${TOKENS.badge} ${KIND_TONE[k]}`}>
              {t(KIND_LABEL[k])}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-[#64748b]">
          {t('report.countSummary', { shown: rows.length, total: ranked.length })}
        </span>
      </div>

      {/* It never scrolls sideways. The columns are shares of the card rather
          than pixel widths, so the whole of every row is on screen at every
          width — a table you have to drag is a table whose last two columns
          most people never learn are there.

          Below lg the same cells become a stacked card, labelled by the
          heading each one lost. Nothing is hidden; it is laid out downwards. */}
      <div className="rounded-[14px] border border-[#e7e2f2] max-lg:border-0">
        <table className="w-full table-fixed border-collapse max-lg:block">
          <thead className="max-lg:hidden">
            <tr>
              {COLUMNS(hasRemember).map(([key, width]) => (
                <th key={key}
                  className={`${width} border-b border-[#e7e2f2] bg-[#faf8ff] px-[13px] py-[12px] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#64748b]`}>
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="max-lg:block lg:[&>tr:last-child>td]:border-b-0">
            {rows.map(({ e, at }) => (
              <tr key={at}
                className={`${KIND_ROW[e.kind] || ''} max-lg:mb-[10px] max-lg:block max-lg:rounded-[14px] max-lg:border max-lg:border-[#e7e2f2] max-lg:pb-[12px] max-lg:last:mb-0`}>
                {/* No wash of colour across the cell. The tint said "this
                    whole side is wrong", which is not what a correction
                    means — the wrong part is a word or two inside an
                    otherwise fine phrase, and that is what is marked. */}
                <td data-label={t('speak.colSaid')} className={`${CELL} ${STACK}`}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <CorrectionText said={e.error} correction={e.correction} side="said" />
                    {/* Both sides are playable, not just the right one. A
                        speaker who cannot hear the difference between what
                        they said and what they should have said cannot fix
                        it, and the correction alone leaves them comparing a
                        sound to a spelling.

                        The left one plays the candidate's own recording where
                        it can be found, and only falls back to the
                        synthesiser where it cannot — a machine reading your
                        mistake back in a clean accent is the least useful way
                        to hear it. Neither exists on an aggregated list, which
                        is why both are optional. */}
                    {clips?.[at] && own
                      ? <OwnVoiceButton clip={clips[at]} id={`${idPrefix}said-${at}`} {...own} />
                      : tts && <SpeakButton text={e.error} id={`${idPrefix}said-${at}`} {...tts} />}
                    {/* How often this one has come back. Only the recurring
                        list carries it; a single result has nothing to count. */}
                    {repeats && e.times_repeated > 1 && (
                      <span className={`${TOKENS.badge} bg-[#fff1f2] text-[#b91c1c]`}>
                        ×{e.times_repeated}
                      </span>
                    )}
                  </span>
                </td>
                <td data-label={t('speak.colFix')} className={`${CELL} ${STACK}`}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <CorrectionText said={e.error} correction={e.correction} side="fix" />
                    {tts && <SpeakButton text={e.correction} id={`${idPrefix}fix-${at}`} {...tts} />}
                  </span>
                </td>
                {/* Stacked, not in a row: pills side by side are what forces
                    this column wide. */}
                <td data-label={t('speak.colType')} className={`${CELL} ${STACK}`}>
                  <span className="flex flex-wrap items-center gap-[6px] lg:flex-col lg:items-start">
                    {/* What to do about it, above what it costs. Absent on an
                        old result, which had no such field and on which every
                        row was a mistake. */}
                    {KIND_TONE[e.kind] && (
                      <span className={`${TOKENS.badge} ${KIND_TONE[e.kind]}`}>
                        {t(KIND_LABEL[e.kind])}
                      </span>
                    )}
                    {SEVERITY_TONE[e.severity] && (
                      <span className={`${TOKENS.badge} ${SEVERITY_TONE[e.severity]}`}>
                        {t(`speak.severity.${e.severity}`)}
                      </span>
                    )}
                    <span className="text-[10px] text-[#64748b]">
                      {catLabel(t, e.category)}
                    </span>
                  </span>
                </td>
                <td data-label={t('speak.colWhy')}
                  className={`${CELL} ${STACK} leading-[1.5] text-[#334155]`}>
                  {e.explanation}
                </td>
                {/* The rule, not the explanation again. Its own box because it
                    is the one thing on the row worth carrying out of the page.

                    Only when at least one correction carries a rule. A grader
                    that returned none — and every result graded before the
                    field existed returned none — used to get a headed column
                    of empty cells, which reads as the page having lost
                    something rather than as the grader never having said it. */}
                {hasRemember && (
                  <td data-label={t('report.colRemember')} className={`${CELL} ${STACK}`}>
                    {e.remember && (
                      <span className="block rounded-[10px] border border-[#e4d8ff] bg-[#f5f0ff] p-[10px] leading-[1.45] text-[#4c1d95]">
                        {e.remember}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button type="button" onClick={() => setShowAll((v) => !v)}
          data-testid={`toggle-${testid}`}
          className={`${TOKENS.secondary} mt-[12px] w-full`}>
          {showAll ? t('report.viewFewer') : t('report.viewAll')}
        </button>
      )}
    </section>
  );
}
