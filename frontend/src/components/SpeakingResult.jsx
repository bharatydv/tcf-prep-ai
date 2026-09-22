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
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF THIS PAGE
 * ---------------------------------------------------------------------------
 * It used to be an error report: level, then grid, then everything that was
 * wrong. That describes one answer accurately and teaches badly, because it
 * answers none of the questions the person reading it has — what did I do
 * right, what should I fix first, have I done this before, am I improving.
 *
 * So: the result, then what went well, then the three things to fix, then the
 * corrections, then the mistakes that are not new, then the stronger version,
 * then what to practise, then the examiner's grid. The grid did not move
 * because it stopped mattering; it moved because it is the detail, and detail
 * belongs after the answer to "what now".
 *
 * Nothing that was on this page has been taken off it.
 */
import { useMemo, useState } from 'react';
import { CheckCircle, XCircle, Sparkle } from '@phosphor-icons/react';
import { SpeakButton } from './SpeakButton';
import { OwnVoiceButton } from './OwnVoiceButton';
import { CorrectionText } from './CorrectionText';
import { SpeakingGrid } from './SpeakingGrid';
import { TranscriptDiff } from './TranscriptDiff';
import {
  ResultHero, DidWell, Priorities, Recurring, Progress, Vocabulary,
  NextStep, PracticeCta, Panel, TOKENS, CAT_LABELS, KIND_TONE,
  KIND_ROW, KIND_LABEL,
} from './speakingReport';
import { useOwnVoice } from '../lib/ownVoice';
import { findClip } from '../lib/speechClips';
import { useT } from '../i18n';

// Each note names one sound in one word. The word gets a play button of its
// own, because "the nasal vowel in « etranger » was not produced distinctly"
// is advice you cannot act on until you have heard the vowel done right.
const ISSUE_KEYS = ['vowel', 'nasal', 'liaison', 'consonant', 'stress', 'rhythm'];

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

/* Where "Practice my mistakes" goes. A plain href rather than a router Link:
   this component deliberately imports no react-router — see speakingReport. */
const PRACTICE_HREF = '/review';

/* How many corrections are shown before "View all". Enough to be worth
   reading, few enough that the page does not open with twenty rows. */
const IMPORTANT_COUNT = 5;

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

// `taskType` is still accepted so callers need not change; nothing reads it now.
export function SpeakingResult({ result, tts, idPrefix = '', taskType = null }) { // eslint-disable-line no-unused-vars
  const t = useT();
  /* The transcript is shown for every tâche. It was withheld for tâches 1
     and 2 for a while (heard, not read, like the exam), but a correction of a
     sentence you cannot see is the part of the report that teaches least. */
  const showTranscript = true;
  const [showAll, setShowAll] = useState(false);
  /* The candidate's own voice, for the left-hand column. Needs three things
     that are each allowed to be missing — a kept recording, word timings from
     the transcriber, and a phrase that can be found among them — so every
     clip below may be null and the synthesiser takes the button back when it
     is. Hooks run before the early return; `result` being absent simply
     means there is nothing to look for. */
  const own = useOwnVoice(result?.submission_id, Boolean(result?.has_audio));
  const clips = useMemo(() => {
    const words = result?.speech_words;
    if (!own.supported || !Array.isArray(words) || !words.length) return [];
    return (result?.errors || []).map((e) => findClip(words, e.error));
  }, [result, own.supported]);
  /* Ranked once, each row carrying its original position so the clip and the
     play-button ids still belong to the right correction after sorting. */
  const ranked = useMemo(() => rankErrors(result?.errors), [result]);
  if (!result) return null;

  const history = result.history || {};
  const rows = showAll ? ranked : ranked.slice(0, IMPORTANT_COUNT);
  const hasMore = ranked.length > IMPORTANT_COUNT;
  /* Over every correction rather than the five on screen, so the table does
     not gain a column halfway down "View all". */
  const hasRemember = ranked.some(({ e }) => e.remember);

  return (
    <div className="space-y-5">
      <ResultHero result={result} />

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

      {/* What went right, beside what to fix first. Side by side because they
          are one thought: these held, those did not. */}
      <div className="grid gap-[18px] min-[900px]:grid-cols-2">
        <DidWell result={result} />
        <Priorities errors={result.errors} practiceHref={PRACTICE_HREF} />
      </div>

      {/* A table, because these are rows.
          Every correction is the same handful of facts — what was said, what
          it should have been, what kind of mistake it is, why, and the rule to
          take away — and as stacked cards those landed in a different place on
          every one, so nothing could be read down a column.

          Sized to break out of the prose column: the page is centred and the
          margin either side is empty, so from xl up the table takes it. */}
      {ranked.length > 0 && (
        <section className={TOKENS.card} data-testid="corrections-table">
          <h2 className={TOKENS.title}>{t('report.corrections')}</h2>
          {/* The subtitle names the Remember column, so it only says so
              when there is one to name. */}
          <p className={TOKENS.desc}>
            {t(hasRemember ? 'report.correctionsSub' : 'report.correctionsSubPlain')}
          </p>

          {/* The legend earns its place the moment a row can be something
              other than a mistake: without it "Upgrade" reads as a fourth
              severity. */}
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

          {/* It never scrolls sideways. The columns are shares of the card
              rather than pixel widths, so the whole of every row is on screen
              at every width — a table you have to drag is a table whose last
              two columns most people never learn are there.

              Below lg the same cells become a stacked card, labelled by the
              heading each one lost. Not the old folding, which dropped "Why"
              and "Remember" and so dropped the two columns the table exists
              for: nothing is hidden here, it is only laid out downwards. */}
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
                    {/* No wash of colour across the cell. The tint said
                        "this whole side is wrong", which is not what a
                        correction means — the wrong part is a word or two
                        inside an otherwise fine phrase, and that is what is
                        marked now. */}
                    <td data-label={t('speak.colSaid')} className={`${CELL} ${STACK}`}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <CorrectionText said={e.error} correction={e.correction} side="said" />
                        {/* Both sides are playable, not just the right one. A
                            speaker who cannot hear the difference between what
                            they said and what they should have said cannot fix
                            it, and the correction alone leaves them comparing a
                            sound to a spelling.

                            The left one plays the candidate's own recording
                            where it can be found, and only falls back to the
                            synthesiser where it cannot — a machine reading
                            your mistake back to you in a clean accent is the
                            least useful way to hear it. */}
                        {clips[at]
                          ? <OwnVoiceButton clip={clips[at]} id={`${idPrefix}said-${at}`} {...own} />
                          : <SpeakButton text={e.error} id={`${idPrefix}said-${at}`} {...tts} />}
                      </span>
                    </td>
                    <td data-label={t('speak.colFix')} className={`${CELL} ${STACK}`}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <CorrectionText said={e.error} correction={e.correction} side="fix" />
                        <SpeakButton text={e.correction} id={`${idPrefix}fix-${at}`} {...tts} />
                      </span>
                    </td>
                    {/* Stacked, not in a row: pills side by side are what
                        forces this column wide. */}
                    <td data-label={t('speak.colType')} className={`${CELL} ${STACK}`}>
                      <span className="flex flex-wrap items-center gap-[6px] lg:flex-col lg:items-start">
                        {/* What to do about it, added above what it costs.
                            Absent on an old result, which had no such field
                            and on which every row was a mistake. */}
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
                          {CAT_LABELS[e.category] || e.category}
                        </span>
                      </span>
                    </td>
                    <td data-label={t('speak.colWhy')}
                      className={`${CELL} ${STACK} leading-[1.5] text-[#334155]`}>
                      {e.explanation}
                    </td>
                    {/* The rule, not the explanation again. Its own box
                        because it is the one thing on the row worth carrying
                        out of the page. */}
                    {/* Only when at least one correction carries a rule.
                        A grader that returned none — and every result graded
                        before the field existed returned none — used to get a
                        headed column of five empty cells, which reads as the
                        page having lost something rather than as the grader
                        never having said it. */}
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
              data-testid="toggle-corrections"
              className={`${TOKENS.secondary} mt-[12px] w-full`}>
              {showAll ? t('report.viewFewer') : t('report.viewAll')}
            </button>
          )}
        </section>
      )}

      {/* The answer, twice, side by side.
          Stacking the transcript above the corrected version meant comparing
          two paragraphs by scrolling between them, and the whole value of
          having both is reading one against the other: every difference is a
          mistake that was made. Marked in place too — red on what was said,
          green on what replaced it — so a correction can be found in its own
          sentence rather than only in the table above. */}
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

      {/* The mistakes that are not new. Worth more than any single row above,
          and the only section on this page that knows about yesterday. */}
      <Recurring items={history.recurring} practiceHref={PRACTICE_HREF} />

      {/* The candidate's own answer, rewritten well. Deliberately after
          the corrections: the errors say what went wrong one line at a
          time, and this is the same answer as a whole, which is the thing
          worth listening to twice. Beside the original now, because an
          upgrade you cannot compare with what you said is just a better
          paragraph by somebody else. */}
      {(result.enhanced_version || '').trim() && (
        <Panel title={t('report.stronger')} description={t('report.strongerSub')}
          tone="border-emerald-100 bg-emerald-50/40" testId="enhanced-version"
          aside={<SpeakButton text={result.enhanced_version} id={`${idPrefix}enhanced`} {...tts} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            {showTranscript && (result.transcript || '').trim() && (
              <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                  {t('report.yourAnswer')}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{result.transcript}</p>
              </div>
            )}
            <div className="rounded-2xl border border-emerald-100 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                <Sparkle size={12} weight="fill" /> {t('report.strongerVersion')}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-800">
                {result.enhanced_version}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-emerald-800/80">
            {t('speak.enhancedNote')}
          </p>
        </Panel>
      )}

      <Vocabulary items={result.vocabulary_suggestions} />

      <PracticeCta practiceHref={PRACTICE_HREF} />

      <Progress previous={history.previous} result={result} />

      <NextStep focusAreas={result.focus_areas} practiceHref={PRACTICE_HREF} />

      {/* The examiner's grid. The detail behind the number at the top, which
          is why it reads after the answer to "what should I do now". Shown on
          its own now, without the "Your speaking profile" card and the
          summary cards that used to sit above it: those repeated, in miniature,
          exactly what the grid already says below them. */}
      <SpeakingGrid result={result} showNarrative={false} />

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
    </div>
  );
}

export default SpeakingResult;
