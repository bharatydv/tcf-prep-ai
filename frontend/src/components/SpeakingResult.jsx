/* One graded spoken answer, rendered.
 *
 * Lifted out of SpeakingRecord so a result can be read somewhere other than
 * the page that produced it: a sitting keeps every tâche's grade, and a
 * candidate who wants to see what they got wrong in tâche 1 should not have to
 * record it again to find out.
 *
 * `tts` is passed in rather than built here. One synthesiser belongs to the
 * page: with three of these open on a sitting, a second play button must stop
 * the first rather than talk over it.
 *
 * `idPrefix` keeps the play buttons apart when more than one result is on
 * screen — without it, tâche 1's "corrected" button and tâche 3's are the same
 * button as far as the synthesiser is concerned.
 */
import { Fragment } from 'react';
import { CheckCircle, XCircle, Sparkle } from '@phosphor-icons/react';
import { SpeakButton } from './SpeakButton';
import { SpeakingGrid } from './SpeakingGrid';
import { TranscriptDiff } from './TranscriptDiff';
import { useT } from '../i18n';

// Each note names one sound in one word. The word gets a play button of its
// own, because "the nasal vowel in « etranger » was not produced distinctly"
// is advice you cannot act on until you have heard the vowel done right.
const ISSUE_KEYS = ['vowel', 'nasal', 'liaison', 'consonant', 'stress', 'rhythm'];

/* How much an error costs, mirroring VALID_SEVERITIES in backend/server.py.
   Absent on a correction the grader did not weigh, which is why there is no
   default entry here to fall back to. */
const SEVERITY_TONE = {
  major: 'bg-rose-100 text-rose-700',
  moderate: 'bg-amber-100 text-amber-700',
  minor: 'bg-gray-100 text-gray-500',
};

const CAT_LABELS = {
  prepositions: 'Prépositions', spelling: 'Orthographe', conjugation: 'Conjugaison',
  gender_number: 'Accord', anglicism: 'Anglicismes', improvement: 'Améliorations C1',
};

/* Tâches 1 and 2 are practised without words on screen, so their results are
   read the same way. Hiding the transcript during the conversation and then
   printing it underneath the grade would be a rule that lasts ninety seconds.

   The corrected rewrite goes with it: it is the same answer with the mistakes
   taken out, so showing it hands back everything that was said. What stays is
   the part that teaches — the criteria, the individual corrections, and the
   suggestions — none of which reproduces the answer as a whole. */
export function SpeakingResult({ result, tts, idPrefix = '', taskType = null }) {
  const t = useT();
  const showTranscript = taskType !== 1 && taskType !== 2;
  if (!result) return null;
  return (
    <div className="space-y-5">
      {result.language_mix?.detected && (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4"
          data-testid="language-mix">
          <XCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="font-heading text-sm font-bold text-amber-900">
              {t('speak.mixedTitle', {
                languages: (result.language_mix.languages || []).join(', '),
              })}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800/80">
              {t('speak.mixedBody')}
            </p>
            {result.language_mix.sample && (
              <p className="mt-1 text-xs italic text-amber-800/70">
                « {result.language_mix.sample} »
              </p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {result.answers_question ? (
              <CheckCircle size={28} weight="fill" className="text-green-500" />
            ) : (
              <XCircle size={28} weight="fill" className="text-amber-500" />
            )}
            <div>
              <p className="font-heading text-base font-bold text-gray-900">
                {result.answers_question ? t('speak.relevant') : t('speak.notRelevant')}
              </p>
              <p className="text-sm text-gray-600">{result.relevance_comment}</p>
            </div>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-400">{t('speak.level')}</p>
            <p className="font-heading text-3xl font-extrabold text-primary">{result.tcf_level}</p>
          </div>
        </div>
      </div>

      <SpeakingGrid result={result} />

      {!showTranscript && (
        <div className="rounded-3xl border border-violet-100 bg-violet-50/40 p-5"
          data-testid="transcript-withheld">
          <p className="text-xs leading-relaxed text-gray-600">{t('speak.transcriptHidden')}</p>
        </div>
      )}

      {/* The answer, twice, side by side.
          Stacking the transcript above the corrected version meant comparing
          two paragraphs by scrolling between them, and the whole value of
          having both is reading one against the other: every difference is a
          mistake that was made. Marked in place too — red on what was said,
          green on what replaced it — so a correction can be found in its own
          sentence rather than only in the table below. */}
      {showTranscript && (
      <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft"
        data-testid="transcript-diff">
        <p className="font-heading text-sm font-bold text-gray-900">{t('speak.transcript')}</p>
        <div className="mt-3">
          <TranscriptDiff
            transcript={result.transcript}
            corrected={result.corrected_version}
            errors={result.errors || []}
            action={(result.corrected_version || '').trim()
              ? <SpeakButton text={result.corrected_version} id={`${idPrefix}corrected`} {...tts} />
              : null} />
        </div>
        {(result.corrected_version || '').trim() && (
          <p className="mt-3 text-xs leading-relaxed text-gray-400">
            {t('speak.correctedNote')}
          </p>
        )}
      </div>
      )}

      {/* A table, because these are rows.
          Every correction is the same four facts — what was said, what it
          should have been, what kind of mistake it is, and why — and as
          stacked cards those four landed in a different place on every one,
          so nothing could be read down a column. Ten corrections are a list
          to scan, not ten paragraphs to read.

          Colour carries the wrong/right split, and it is deliberately not the
          ONLY thing that does: the strike-through, the column headings and the
          order of the two columns all say it as well, so the table still works
          for a reader who cannot separate red from green. */}
      {/* Wider than the page it sits in, once there is room for it.
          The sitting is laid out at max-w-3xl because that is a comfortable
          measure for reading a tâche brief, and four columns of table inside
          it are four cramped columns. From xl up this breaks out by 8rem a
          side — the page is centred, so that space is empty margin and taking
          it costs nothing. Below xl it stays in the column and the last
          column folds away instead. */}
      {Array.isArray(result.errors) && result.errors.length > 0 && (
        <div className="overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-soft xl:-mx-32 xl:w-[calc(100%+16rem)]">
          <p className="px-6 pb-3 pt-6 font-heading text-sm font-bold text-gray-900">
            {t('speak.corrections')}
          </p>
          {/* Three columns, and the explanation on a row of its own.
              As four columns this needed 44rem before the text stopped
              collapsing, which put a sideways scrollbar under every result and
              pushed the page wider than the window. "Why" is the only column
              holding a sentence rather than a phrase, so moving it to a full
              width row underneath takes the pressure off all three of the
              others — and it reads better there anyway, directly beneath the
              pair it explains rather than in a column beside it. */}
          {/* One table, two shapes.
              From md up "Why" is a fourth column, which is what it wants to be
              — the four facts of a correction read across a row. Below md
              there is not room for four columns of French without each one
              becoming a word wide, so the same text drops to a full-width row
              underneath. Same markup, one breakpoint, no second table to keep
              in step with this one. */}
          <table className="w-full table-fixed text-sm">
            <thead className="bg-gray-50 text-left text-[10.5px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-[30%] px-4 py-2.5 font-bold sm:px-6 md:w-[24%]">{t('speak.colSaid')}</th>
                <th className="w-[30%] px-3 py-2.5 font-bold md:w-[24%]">{t('speak.colFix')}</th>
                <th className="w-[40%] px-3 py-2.5 font-bold sm:px-4 md:w-[16%]">{t('speak.colType')}</th>
                <th className="hidden px-3 py-2.5 font-bold sm:px-6 md:table-cell">{t('speak.colWhy')}</th>
              </tr>
            </thead>
            <tbody>
              {result.errors.map((e, i) => (
                <Fragment key={i}>
                  {/* The rule sits on the row rather than between the
                      pairs, so a correction and its explanation read as one
                      block whichever shape the table is in. */}
                  <tr className="border-t border-violet-100 align-top">
                    <td className="break-words bg-rose-50/50 px-4 pb-2 pt-3 sm:px-6">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-red-600 line-through">{e.error}</span>
                        {/* Both sides are playable, not just the right one. A
                            speaker who cannot hear the difference between what
                            they said and what they should have said cannot fix
                            it, and the correction alone leaves them comparing a
                            sound to a spelling. */}
                        <SpeakButton text={e.error} id={`${idPrefix}said-${i}`} {...tts} />
                      </span>
                    </td>
                    <td className="break-words bg-green-50/50 px-3 pb-2 pt-3">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-green-700">{e.correction}</span>
                        <SpeakButton text={e.correction} id={`${idPrefix}fix-${i}`} {...tts} />
                      </span>
                    </td>
                    {/* Stacked, not in a row: two pills side by side is the
                        pair that forces this column wide. */}
                    <td className="px-3 pb-2 pt-3 sm:px-4">
                      <span className="flex flex-col items-start gap-1">
                        {SEVERITY_TONE[e.severity] && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_TONE[e.severity]}`}>
                            {t(`speak.severity.${e.severity}`)}
                          </span>
                        )}
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                          {CAT_LABELS[e.category] || e.category}
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-3 pb-2 pt-3 text-xs leading-relaxed text-gray-500 sm:px-6 md:table-cell">
                      {e.explanation}
                    </td>
                  </tr>
                  {e.explanation && (
                    <tr className="md:hidden">
                      <td colSpan={3}
                        className="px-4 pb-3 text-xs leading-relaxed text-gray-500 sm:px-6">
                        {e.explanation}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Array.isArray(result.pronunciation_errors) && result.pronunciation_errors.length > 0 && (
        <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft"
          data-testid="pronunciation-notes">
          <p className="font-heading text-sm font-bold text-gray-900">{t('speak.pronunciation')}</p>
          <div className="mt-3 space-y-3">
            {result.pronunciation_errors.map((e, i) => (
              <div key={i} className="rounded-2xl border border-sky-50 bg-sky-50/40 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-gray-900">{e.word}</span>
                  <SpeakButton text={e.word} id={`${idPrefix}say-${i}`} {...tts} />
                  <span className="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                    {ISSUE_KEYS.includes(e.issue) ? t(`speak.issue.${e.issue}`) : e.issue}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{e.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The candidate's own answer, rewritten well. Deliberately after
          the corrections: the errors say what went wrong one line at a
          time, and this is the same answer as a whole, which is the thing
          worth listening to twice. */}
      {(result.enhanced_version || '').trim() && (
        <div className="rounded-3xl border border-emerald-100 bg-emerald-50/40 p-6 shadow-soft"
          data-testid="enhanced-version">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-heading text-sm font-bold text-emerald-900">
              <Sparkle size={16} weight="fill" className="text-emerald-600" />
              {t('speak.enhancedTitle')}
            </p>
            <SpeakButton text={result.enhanced_version} id={`${idPrefix}enhanced`} {...tts} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-gray-800">
            {result.enhanced_version}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-emerald-800/80">
            {t('speak.enhancedNote')}
          </p>
        </div>
      )}

      {Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
        <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
          <p className="font-heading text-sm font-bold text-gray-900">{t('speak.suggestions')}</p>
          <ul className="mt-3 space-y-2">
            {result.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(result.vocabulary_suggestions) && result.vocabulary_suggestions.length > 0 && (
        <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
          <p className="font-heading text-sm font-bold text-gray-900">{t('speak.vocabulary')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.vocabulary_suggestions.map((v, i) => (
              <span key={i} className="rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-medium text-fuchsia-700">{v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SpeakingResult;
