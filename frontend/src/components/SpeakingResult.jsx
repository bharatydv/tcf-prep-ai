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
 * corrections, the transcript, the mistakes that are not new, the stronger
 * version, the questions a tâche 2 could also have asked, the vocabulary, the
 * suggestions, and what to practise.
 *
 * The examiner's grid used to close the page. It was taken off: the three
 * numbers at the top are the result, and a second block of criterion scores
 * under everything else read as a second, different result.
 */
import { useMemo } from 'react';
import { CheckCircle, XCircle, Sparkle, Question } from '@phosphor-icons/react';
import { SpeakButton } from './SpeakButton';
import { OwnVoiceButton } from './OwnVoiceButton';
import CorrectionsTable, { rankErrors } from './CorrectionsTable';
import { RecordingPlayer } from './RecordingPlayer';
import { TranscriptDiff, candidateText } from './TranscriptDiff';
import {
  ResultHero, DidWell, Priorities, Recurring, Progress, Vocabulary,
  NextStep, PracticeCta, Panel,
} from './speakingReport';
import { useOwnVoice } from '../lib/ownVoice';
import { findClip } from '../lib/speechClips';
import { useT } from '../i18n';
import RateCorrection from './RateCorrection';

// Each note names one sound in one word. The word gets a play button of its
// own, because "the nasal vowel in « etranger » was not produced distinctly"
// is advice you cannot act on until you have heard the vowel done right.
const ISSUE_KEYS = ['vowel', 'nasal', 'liaison', 'consonant', 'stress', 'rhythm'];

/* Where "Practice my mistakes" goes. A plain href rather than a router Link:
   this component deliberately imports no react-router — see speakingReport. */
const PRACTICE_HREF = '/review';

/* The whole answer, played back as it was actually spoken.
 *
 * The corrections already play the candidate's own voice a phrase at a time,
 * which is the right unit for fixing one mistake and the wrong one for
 * hearing yourself: fluency, hesitation, the pace of a two-minute answer and
 * whether it was finished are all things you can only judge over the whole
 * take. The file is already kept and already served — the result page simply
 * never offered it, so the only way to reach your own recording was the
 * attempt list on another page.
 *
 * Tâches 1 and 3 are the candidate speaking for a fixed window, so their
 * recording IS the answer, end to end. Tâche 2's is the same file with the
 * examiner's half cut out of it — the recorder pauses whenever it is not the
 * candidate's turn — so it is still kept and still marked, but it is a
 * stitched-together thing rather than a take to sit and listen to.
 */
const FULL_RECORDING_TACHES = [1, 3];

// `taskType` says which tâche this is, which decides whether the whole
// recording is offered below. See FULL_RECORDING_TACHES.
export function SpeakingResult({ result, tts, idPrefix = '', taskType = null }) {
  const t = useT();
  /* The transcript is shown for every tâche. It was withheld for tâches 1
     and 2 for a while (heard, not read, like the exam), but a correction of a
     sentence you cannot see is the part of the report that teaches least. */
  const showTranscript = true;
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
  /* What the candidate said, and only that. A roleplay transcript carries the
     agent's lines too, and "Your answer" beside the stronger version is the
     candidate's answer, not the conversation. */
  const answer = candidateText(result.transcript || result.original_text);
  /* Suggestions were saved under the writing flow's name before the full
     grade was kept, so an older result still has them there. */
  const suggestions = [result.suggestions, result.improvement_suggestions]
    .find((list) => Array.isArray(list) && list.some((x) => String(x || '').trim())) || [];
  const questions = Array.isArray(result.missed_questions)
    ? result.missed_questions.filter((q) => String(q?.question || '').trim())
    : [];
  /* Three things have to be true: the tâche is one whose recording is a whole
     answer, the recording was kept (nothing before this feature was, and an
     admin can delete one), and there is a submission to fetch it from. The
     player handles a file that has gone missing since; this only decides
     whether to ask for it at all. */
  const playWholeAnswer = Boolean(result.has_audio) && Boolean(result.submission_id)
    && FULL_RECORDING_TACHES.includes(Number(taskType));

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
      {/* The corrections, in the table every screen in the app reads them
          in — see CorrectionsTable. Sized to break out of the prose column:
          the page is centred and the margin either side is empty, so from xl
          up the table takes it. */}
      <CorrectionsTable errors={result.errors} tts={tts} clips={clips} own={own}
        idPrefix={idPrefix} />

      {/* The answer, twice, side by side.
          Stacking the transcript above the corrected version meant comparing
          two paragraphs by scrolling between them, and the whole value of
          having both is reading one against the other: every difference is a
          mistake that was made. Marked in place too — red on what was said,
          green on what replaced it — so a correction can be found in its own
          sentence rather than only in the table above. */}
      {/* Above the transcript, because the two are the same answer: what was
          said, and what it sounded like being said. */}
      {playWholeAnswer && (
        <RecordingPlayer submissionId={result.submission_id} />
      )}

      {showTranscript && (
      <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft"
        data-testid="transcript-diff">
        <p className="font-heading text-sm font-bold text-gray-900">{t('speak.transcript')}</p>
        <div className="mt-3">
          <TranscriptDiff
            transcript={result.transcript || result.original_text}
            corrected={result.corrected_version}
            errors={result.errors || []}
            /* The whole answer in the candidate's own voice. The player
               clamps the end to the recording's length, so "to the end" is
               simply a very late end. */
            saidAction={(
              <OwnVoiceButton clip={{ start: 0, end: 36000 }} id={`${idPrefix}said-all`} {...own} />
            )}
            action={(fixed) => (fixed
              ? <SpeakButton text={fixed} id={`${idPrefix}corrected`} {...tts} />
              : null)} />
        </div>
        {(ranked.length > 0 || (result.corrected_version || '').trim()) && (
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
            {showTranscript && answer && (
              <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                  {t('report.yourAnswer')}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{answer}</p>
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

      {/* Tâche 2 only: the grader returns these for the roleplay and nothing
          else. In French and ready to say, each with the English note on what
          it would have found out. */}
      {questions.length > 0 && (
        <Panel title={t('report.moreQuestions')} description={t('report.moreQuestionsSub')}
          tone="!border-[#f4dfae] !bg-[#fffaf0]" testId="more-questions">
          <ol className="grid gap-[9px]">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-[10px] rounded-[11px] border border-[#f0e2bf] bg-white px-[12px] py-[10px]">
                <Question size={16} weight="fill" className="mt-[2px] shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-extrabold text-[#171322]">{q.question}</span>
                  {q.why && <span className="mt-[2px] block text-[11px] leading-[1.45] text-[#64748b]">{q.why}</span>}
                </span>
                <SpeakButton text={q.question} id={`${idPrefix}ask-${i}`} {...tts} />
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Vocabulary items={result.vocabulary_suggestions} />

      {/* On every tâche. It used to show only where the grade had just come
          back, because a reopened result had lost it. */}
      {suggestions.length > 0 && (
        <Panel title={t('speak.suggestions')} description={t('report.suggestionsSub')}
          testId="suggestions">
          <ul className="grid gap-[8px]">
            {suggestions.filter((x) => String(x || '').trim()).map((x, i) => (
              <li key={i} className="flex items-start gap-[8px] text-[13px] leading-[1.45] text-[#334155]">
                <CheckCircle size={16} weight="fill" className="mt-[2px] shrink-0 text-[#7c3aed]" /> {x}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <PracticeCta practiceHref={PRACTICE_HREF} />

      <Progress previous={history.previous} result={result} />

      <NextStep focusAreas={result.focus_areas} practiceHref={PRACTICE_HREF} />

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

      <RateCorrection submissionId={result.submission_id} />
    </div>
  );
}

export { rankErrors };
export default SpeakingResult;
