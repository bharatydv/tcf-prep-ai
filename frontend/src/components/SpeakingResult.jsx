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
import { CheckCircle, XCircle, Sparkle } from '@phosphor-icons/react';
import { SpeakButton } from './SpeakButton';
import { SpeakingGrid } from './SpeakingGrid';
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

export function SpeakingResult({ result, tts, idPrefix = '' }) {
  const t = useT();
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

      <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
        <p className="font-heading text-sm font-bold text-gray-900">{t('speak.transcript')}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {result.transcript || t('speak.noSpeechLine')}
        </p>

        {/* The same answer with the mistakes taken out and nothing else
            changed. It sits in this card rather than its own because it
            is only worth anything read against the line above it: every
            difference between the two is a mistake that was made. The
            better-written version is further down and is a different
            question — not what went wrong, but what could have been. */}
        {(result.corrected_version || '').trim() && (
          <div className="mt-4 border-t border-violet-50 pt-4" data-testid="corrected-version">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-heading text-sm font-bold text-gray-900">
                {t('speak.correctedTitle')}
              </p>
              <SpeakButton text={result.corrected_version} id={`${idPrefix}corrected`} {...tts} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {result.corrected_version}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-gray-400">
              {t('speak.correctedNote')}
            </p>
          </div>
        )}
      </div>

      {Array.isArray(result.errors) && result.errors.length > 0 && (
        <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-soft">
          <p className="font-heading text-sm font-bold text-gray-900">{t('speak.corrections')}</p>
          <div className="mt-3 space-y-3">
            {result.errors.map((e, i) => (
              <div key={i} className="rounded-2xl border border-violet-50 bg-violet-50/40 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-red-500 line-through">{e.error}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-semibold text-green-600">{e.correction}</span>
                  {/* Reading that « Elle peut accepter » is right does not
                      tell you how it sounds, which is the whole subject
                      of a speaking test. */}
                  <SpeakButton text={e.correction} id={`${idPrefix}fix-${i}`} {...tts} />
                  <span className="ml-auto flex items-center gap-1.5">
                    {SEVERITY_TONE[e.severity] && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_TONE[e.severity]}`}>
                        {t(`speak.severity.${e.severity}`)}
                      </span>
                    )}
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{CAT_LABELS[e.category] || e.category}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{e.explanation}</p>
              </div>
            ))}
          </div>
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
