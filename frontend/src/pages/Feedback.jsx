import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { BackLink, ErrorHighlightedText } from '../components/shared';
import { RecordingPlayer } from '../components/RecordingPlayer';
import { useSpeak } from '../lib/speak';
import { useT } from '../i18n';
import { displayMark } from '../lib/tcf';
import { Seo } from '../lib/seo';
import { submissionSkill } from '../lib/speakingExam';
import { trackResultView } from '../lib/analytics';
import RateCorrection from '../components/RateCorrection';
import CorrectionsTable from '../components/CorrectionsTable';

export default function Feedback() {
  const { submissionId } = useParams();
  const t = useT();
  const [sub, setSub] = useState(null);
  const [error, setError] = useState('');
  /* Above the early returns below, because a hook that only runs once the
     submission has loaded is not a hook. */
  const tts = useSpeak();

  useEffect(() => {
    api.get(`/api/submissions/${submissionId}`)
      .then(({ data }) => {
        setSub(data.submission);
        /* The correction is on screen and readable. On the resolved request
           rather than on mount, because a result that failed to load was not
           read by anyone — and that difference is exactly the drop-off this
           event exists to measure.
           The band and which skill it was; never the text, the transcript, the
           recording or the submission id. */
        const row = data.submission || {};
        trackResultView({
          skill: submissionSkill(row),
          exam: 'tcf',
          level: row.tcf_level,
          source: row.source,
        });
      })
      .catch((e) => { setError(errMsg(e)); toast.error(errMsg(e)); });
  }, [submissionId]);

  if (error) return <main className="px-4 py-20 text-center text-gray-600">{error} — <Link to="/dashboard" className="text-primary">{t('fb.backLink')}</Link></main>;
  if (!sub) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  const byCat = {};
  sub.errors.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });
  const caps = sub.caps_applied || [];
  /* Spoken work reads its "text" back as a transcript, and may have the
     recording behind it. Written work never does.

     This used to test the source name against a list written out in this
     file, and the list had never heard of the `speaking_exam` that Test Mode
     writes — so a tâche recorded in a speaking paper came back as an essay,
     with no transcript and no way to play back what had been said. The row
     says which skill it is now. */
  const spoken = submissionSkill(sub) === 'speaking';

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Seo titleKey="seo.feedback.title" noindex />
      <BackLink testid="feedback-back" />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('fb.title')}</h1>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">{t('fb.score')}</p>
            {/* The mark the exam would print, not the grader's working 0-100:
                a candidate reads /20, and two scales on one page is how you
                get someone reporting a 68 to an immigration officer. */}
            <p className="font-heading text-3xl font-bold text-primary sm:text-4xl" data-testid="overall-score">
              {displayMark(sub.overall_score, sub.tcf_level) ?? '—'}
              <span className="text-xl text-gray-400">/20</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">{t('fb.level')}</p>
            <p className="font-heading text-3xl font-bold sm:text-4xl" data-testid="tcf-level">{sub.tcf_level}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(CATEGORY_META).map(([k, m]) => (
          <span key={k} className="pill" style={{ background: m.color }}>{m.label} · {byCat[k]?.length || 0}</span>
        ))}
      </div>

      {/* Why the level was lowered. Without this, a capped score looks arbitrary. */}
      {caps.length > 0 && (
        <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="caps-applied">
          <p className="text-sm font-bold text-amber-900">{t('fb.capsTitle')}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {caps.map((c, i) => (
              <li key={i} className="flex gap-2"><span>•</span>
                {/* Older rows stored a plain sentence; newer ones a code + params. */}
                {typeof c === 'string' ? c : t(`caps.${c.code}`, c.params)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card mt-6 p-5 sm:p-8">
        <h2 className="mb-4 font-heading text-lg font-semibold">
          {spoken ? t('fb.annotatedSpoken') : t('fb.annotated')}
        </h2>
        {/* The recording above the transcript it produced: what was said, then
            what was heard, then what was wrong with it. Reading a correction
            of a sentence you cannot hear yourself say is the part of speaking
            feedback that does the least work. */}
        {spoken && sub.has_audio && (
          <RecordingPlayer submissionId={sub.submission_id} className="mb-5" />
        )}
        {spoken && !sub.has_audio && (
          <p className="mb-5 text-xs text-gray-400" data-testid="recording-absent">
            {t('fb.audioMissing')}
          </p>
        )}
        <ErrorHighlightedText text={sub.original_text} errors={sub.errors} />
        <p className="mt-4 text-xs text-gray-400">{t('fb.hoverHint')}</p>
      </section>

      {/* The corrections, in the table every result in the app reads them
          in — see CorrectionsTable.

          This was one three-column table per category: the mistake, the fix,
          the explanation. It lost the three things the grader actually says
          about a correction — whether it is a mistake or a style suggestion,
          what it costs, and the rule worth carrying away — and it grouped by
          category, which sets a major error beside an optional upgrade with
          nothing to tell them apart. The same words, graded the same way,
          also looked like two different products depending on whether they
          had been written or spoken. */}
      <CorrectionsTable
        className="mt-6"
        testid="feedback-corrections"
        errors={sub.errors}
        tts={tts}
        idPrefix="fb-" />

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {[['fb.suggestions', sub.improvement_suggestions], ['fb.linkingWords', sub.linking_words], ['fb.vocabulary', sub.vocabulary_suggestions]].map(([titleKey, items]) => (
          <section key={titleKey} className="card p-6">
            <h3 className="font-heading font-semibold">{t(titleKey)}</h3>
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              {/* A vocabulary suggestion is {phrase, meaning}; the other two
                  lists are plain strings. Rendering the object straight into
                  the <li> threw "Objects are not valid as a React child" and
                  took the whole page down — so every graded answer whose
                  grader returned the glossed shape, which is what it is asked
                  for, had no feedback page at all. */}
              {(items || []).length ? items.map((item, i) => {
                const text = typeof item === 'string' ? item : item?.phrase;
                const gloss = typeof item === 'string' ? '' : item?.meaning;
                if (!text) return null;
                return (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>
                      {text}
                      {gloss && <span className="text-gray-400"> · {gloss}</span>}
                    </span>
                  </li>
                );
              }) : <li className="text-gray-400">—</li>}
            </ul>
          </section>
        ))}
      </div>

      <RateCorrection submissionId={sub.submission_id} />

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/review" className="btn-primary">{t('fb.reviewErrors')}</Link>
        <Link to="/practice" className="btn-outline">{t('fb.newAttempt')}</Link>
      </div>

      {/* The speaking pages already carry this; a bare "78 / C1" reads as an
          official verdict, and people book real exams on the strength of it. */}
      <p className="mt-6 text-xs leading-relaxed text-gray-400" data-testid="score-disclaimer">
        {t('fb.disclaimer')}
      </p>
    </main>
  );
}
