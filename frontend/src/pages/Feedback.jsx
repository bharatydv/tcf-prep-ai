import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { BackLink, ErrorHighlightedText } from '../components/shared';
import { RecordingPlayer } from '../components/RecordingPlayer';
import { SpeakButton } from '../components/SpeakButton';
import { CorrectionText } from '../components/CorrectionText';
import { useSpeak } from '../lib/speak';
import { useT } from '../i18n';
import { displayMark } from '../lib/tcf';
import { Seo } from '../lib/seo';
import { trackResultView } from '../lib/analytics';

/* Same two sources the dashboard counts as speaking. */
const SPEAKING_SOURCES = new Set(['speaking', 'conversation']);

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
          skill: SPEAKING_SOURCES.has(row.source || '') ? 'speaking' : 'writing',
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
  // Spoken work reads its "text" back as a transcript, and may have the
  // recording behind it. Written work never does.
  const spoken = SPEAKING_SOURCES.has(sub.source || '');
  /* Tâches 1 and 2 are practised and marked without the words on screen, and
     this page is where a candidate comes back to them days later. Showing the
     transcript here would undo the rule with one extra click.
     The recording stays: hearing yourself is the whole point, and it is the
     thing the real exam denies you rather than the thing it grades. */
  const hideTranscript = spoken && (sub.task_type === 1 || sub.task_type === 2);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Seo titleKey="seo.feedback.title" noindex />
      <BackLink testid="feedback-back" />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t('fb.title')}</h1>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">{t('fb.score')}</p>
            {/* The mark the exam would print, not the grader's working 0-100:
                a candidate reads /20, and two scales on one page is how you
                get someone reporting a 68 to an immigration officer. */}
            <p className="font-heading text-4xl font-bold text-primary" data-testid="overall-score">
              {displayMark(sub.overall_score, sub.tcf_level) ?? '—'}
              <span className="text-xl text-gray-400">/20</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">{t('fb.level')}</p>
            <p className="font-heading text-4xl font-bold" data-testid="tcf-level">{sub.tcf_level}</p>
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

      <section className="card mt-6 p-8">
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
        {hideTranscript ? (
          <p className="text-sm leading-relaxed text-gray-600" data-testid="transcript-withheld">
            {t('speak.transcriptHidden')}
          </p>
        ) : (
          <>
            <ErrorHighlightedText text={sub.original_text} errors={sub.errors} />
            <p className="mt-4 text-xs text-gray-400">{t('fb.hoverHint')}</p>
          </>
        )}
      </section>

      {Object.entries(byCat).map(([cat, errs]) => (
        <section key={cat} className="card mt-6 overflow-hidden">
          <div className="px-6 py-3 font-heading font-semibold" style={{ background: CATEGORY_META[cat]?.color }}>
            {CATEGORY_META[cat]?.label} ({errs.length})
          </div>
          {/* Phones: one stacked block per error. */}
          <ul className="divide-y divide-gray-100 sm:hidden">
            {errs.map((e, i) => (
              <li key={i} className="px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('fb.colError')}</p>
                {/* Both sides are playable. What was said and what should have
                    been said only become a lesson when they can be heard one
                    after the other — the same reason the speaking result plays
                    both, and the same button doing it. */}
                <p className="mt-0.5 flex items-start gap-2 text-sm">
                  <CorrectionText said={e.error} correction={e.correction} side="said" />
                  <SpeakButton text={e.error} id={`m-${cat}-err-${i}`} {...tts} />
                </p>
                <p className="mt-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('fb.colCorrection')}</p>
                <p className="mt-0.5 flex items-start gap-2 text-sm">
                  <CorrectionText said={e.error} correction={e.correction} side="fix" />
                  <SpeakButton text={e.correction} id={`m-${cat}-fix-${i}`} {...tts} />
                </p>
                <p className="mt-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('fb.colExplanation')}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{e.explanation}</p>
              </li>
            ))}
          </ul>
          {/* sm and up: the table, in a container that scrolls rather than clips. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-6 py-2">{t('fb.colError')}</th><th className="px-6 py-2">{t('fb.colCorrection')}</th><th className="px-6 py-2">{t('fb.colExplanation')}</th></tr>
              </thead>
              <tbody>
                {errs.map((e, i) => (
                  <tr key={i} className="border-t border-gray-100 align-top">
                    {/* Only the words that changed carry colour. The whole
                        cell in red said the whole phrase was wrong, when
                        usually one word in it is. */}
                    <td className="px-6 py-3">
                      <span className="flex items-start gap-2">
                        <CorrectionText said={e.error} correction={e.correction} side="said" />
                        <SpeakButton text={e.error} id={`d-${cat}-err-${i}`} {...tts} />
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className="flex items-start gap-2">
                        <CorrectionText said={e.error} correction={e.correction} side="fix" />
                        <SpeakButton text={e.correction} id={`d-${cat}-fix-${i}`} {...tts} />
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{e.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {[['fb.suggestions', sub.improvement_suggestions], ['fb.linkingWords', sub.linking_words], ['fb.vocabulary', sub.vocabulary_suggestions]].map(([titleKey, items]) => (
          <section key={titleKey} className="card p-6">
            <h3 className="font-heading font-semibold">{t(titleKey)}</h3>
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              {(items || []).length ? items.map((s, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span>{s}</li>) : <li className="text-gray-400">—</li>}
            </ul>
          </section>
        ))}
      </div>

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
