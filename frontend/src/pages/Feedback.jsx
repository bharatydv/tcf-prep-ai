import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { ErrorHighlightedText } from '../components/shared';

export default function Feedback() {
  const { submissionId } = useParams();
  const [sub, setSub] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/submissions/${submissionId}`)
      .then(({ data }) => setSub(data.submission))
      .catch((e) => { setError(errMsg(e)); toast.error(errMsg(e)); });
  }, [submissionId]);

  if (error) return <main className="px-4 py-20 text-center text-gray-600">{error} — <Link to="/dashboard" className="text-primary">retour</Link></main>;
  if (!sub) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  const byCat = {};
  sub.errors.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Correction détaillée</h1>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">Score</p>
            <p className="font-heading text-4xl font-bold text-primary" data-testid="overall-score">{sub.overall_score}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">Niveau</p>
            <p className="font-heading text-4xl font-bold" data-testid="tcf-level">{sub.tcf_level}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(CATEGORY_META).map(([k, m]) => (
          <span key={k} className="pill" style={{ background: m.color }}>{m.label} · {byCat[k]?.length || 0}</span>
        ))}
      </div>

      <section className="card mt-6 p-8">
        <h2 className="mb-4 font-heading text-lg font-semibold">Votre texte annoté</h2>
        <ErrorHighlightedText text={sub.original_text} errors={sub.errors} />
        <p className="mt-4 text-xs text-gray-400">Survolez une surbrillance pour voir la correction et l'explication.</p>
      </section>

      {Object.entries(byCat).map(([cat, errs]) => (
        <section key={cat} className="card mt-6 overflow-hidden">
          <div className="px-6 py-3 font-heading font-semibold" style={{ background: CATEGORY_META[cat]?.color }}>
            {CATEGORY_META[cat]?.label} ({errs.length})
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-6 py-2">Erreur</th><th className="px-6 py-2">Correction</th><th className="px-6 py-2">Explication</th></tr>
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
        {[['Suggestions d’amélioration', sub.improvement_suggestions], ['Mots de liaison à utiliser', sub.linking_words], ['Vocabulaire suggéré', sub.vocabulary_suggestions]].map(([title, items]) => (
          <section key={title} className="card p-6">
            <h3 className="font-heading font-semibold">{title}</h3>
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              {(items || []).length ? items.map((s, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span>{s}</li>) : <li className="text-gray-400">—</li>}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Link to="/review" className="btn-primary">Réviser ces erreurs</Link>
        <Link to="/practice" className="btn-outline">Nouvel essai</Link>
      </div>
    </main>
  );
}
