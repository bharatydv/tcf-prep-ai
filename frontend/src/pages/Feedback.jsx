import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { BackLink, ErrorHighlightedText } from '../components/shared';
import { useT } from '../i18n';

export default function Feedback() {
  const { submissionId } = useParams();
  const t = useT();
  const [sub, setSub] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/submissions/${submissionId}`)
      .then(({ data }) => setSub(data.submission))
      .catch((e) => { setError(errMsg(e)); toast.error(errMsg(e)); });
  }, [submissionId]);

  if (error) return <main className="px-4 py-20 text-center text-gray-600">{error} — <Link to="/dashboard" className="text-primary">{t('fb.backLink')}</Link></main>;
  if (!sub) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  const byCat = {};
  sub.errors.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });
  const caps = sub.caps_applied || [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BackLink testid="feedback-back" />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t('fb.title')}</h1>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">{t('fb.score')}</p>
            <p className="font-heading text-4xl font-bold text-primary" data-testid="overall-score">{sub.overall_score}</p>
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
        <h2 className="mb-4 font-heading text-lg font-semibold">{t('fb.annotated')}</h2>
        <ErrorHighlightedText text={sub.original_text} errors={sub.errors} />
        <p className="mt-4 text-xs text-gray-400">{t('fb.hoverHint')}</p>
      </section>

      {Object.entries(byCat).map(([cat, errs]) => (
        <section key={cat} className="card mt-6 overflow-hidden">
          <div className="px-6 py-3 font-heading font-semibold" style={{ background: CATEGORY_META[cat]?.color }}>
            {CATEGORY_META[cat]?.label} ({errs.length})
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-6 py-2">{t('fb.colError')}</th><th className="px-6 py-2">{t('fb.colCorrection')}</th><th className="px-6 py-2">{t('fb.colExplanation')}</th></tr>
            </thead>
            <tbody>
              {errs.map((e, i) => (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="px-6 py-3 text-red-600">{e.error}</td>
                  <td className="px-6 py-3 font-medium text-green-700">{e.correction}</td>
                  <td className="px-6 py-3 text-gray-600">{e.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
