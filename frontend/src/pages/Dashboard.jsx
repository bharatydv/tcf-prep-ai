import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Fire, Trophy, GameController } from '@phosphor-icons/react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, LineChart, Line,
} from 'recharts';
import { api, CATEGORY_META } from '../lib/api';
import { Heatmap } from '../components/shared';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [heatmap, setHeatmap] = useState({});
  const [mistakes, setMistakes] = useState(null);
  const [subs, setSubs] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/dashboard/stats').then(({ data }) => setStats(data)).catch(() => {});
    api.get('/api/dashboard/heatmap').then(({ data }) => setHeatmap(data.heatmap)).catch(() => {});
    api.get('/api/mistakes/summary').then(({ data }) => setMistakes(data)).catch(() => {});
    api.get('/api/submissions').then(({ data }) => setSubs(data.submissions)).catch(() => {});
  }, []);

  if (!stats) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  const breakdownData = Object.entries(stats.error_breakdown).map(([k, v]) => ({
    name: CATEGORY_META[k]?.label || k, count: v, color: CATEGORY_META[k]?.color || '#ddd',
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold">Tableau de bord</h1>

      {/* stat cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Soumissions', stats.total_submissions, null],
          ['Score moyen', stats.average_score, null],
          ['Série actuelle', stats.current_streak, <Fire size={20} weight="fill" className="text-orange-500" />],
          ['Meilleure série', stats.longest_streak, <Trophy size={20} weight="fill" className="text-amber-500" />],
        ].map(([label, value, icon]) => (
          <div key={label} className="card p-5">
            <p className="flex items-center gap-2 text-sm text-gray-500">{icon}{label}</p>
            <p className="mt-1 font-heading text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {mistakes?.narrative && (
        <div className="card mt-6 border-l-4 border-l-green-500 bg-green-50/50 p-5 text-sm font-medium text-green-800" data-testid="progress-narrative">
          {mistakes.narrative}
        </div>
      )}

      {/* charts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-heading font-semibold">Tendance des scores (10 derniers)</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer>
              <AreaChart data={stats.score_trend}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="score" stroke="#7C3AED" strokeWidth={2.5} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card p-6">
          <h2 className="font-heading font-semibold">Erreurs par catégorie</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer>
              <BarChart data={breakdownData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {breakdownData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* mistakes USP */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold">Vos points faibles</h2>
            <span className="text-xs text-gray-400">basé sur votre historique d'erreurs</span>
          </div>
          <div className="mt-4 space-y-4">
            {(mistakes?.weak_points || []).map((w) => (
              <div key={w.category} className="rounded-xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="pill" style={{ background: CATEGORY_META[w.category]?.color }}>{w.label} · {w.count} erreurs</span>
                  <button className="btn-primary !px-3 !py-1.5 text-xs"
                    onClick={() => navigate(`/review?category=${w.category}`)} data-testid={`review-${w.category}`}>
                    <GameController size={14} weight="fill" /> Réviser cette catégorie
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-600">{w.tip}</p>
              </div>
            ))}
            {!mistakes?.weak_points?.length && <p className="text-sm text-gray-500">Aucune erreur enregistrée pour l'instant — écrivez un premier texte !</p>}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="font-heading font-semibold">Erreurs récurrentes</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {(mistakes?.repeat_leaders || []).slice(0, 6).map((m) => (
              <li key={m.mistake_id} className="rounded-lg bg-gray-50 p-3">
                <span className="text-red-600">{m.error_text}</span> → <span className="font-medium text-green-700">{m.correction}</span>
                <span className="ml-2 text-xs text-gray-400">×{m.times_repeated + 1}</span>
              </li>
            ))}
            {!mistakes?.repeat_leaders?.length && <li className="text-gray-400">Aucune erreur répétée 💪</li>}
          </ul>
        </section>
      </div>

      {/* errors per 100 words trend */}
      {mistakes?.trend?.length > 1 && (
        <section className="card mt-6 p-6">
          <h2 className="font-heading font-semibold">Erreurs pour 100 mots (par mois)</h2>
          <p className="text-xs text-gray-400">Normalisé par volume écrit : la progression reste visible même si vous écrivez plus.</p>
          <div className="mt-4 h-52">
            <ResponsiveContainer>
              <LineChart data={mistakes.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="errors_per_100_words" stroke="#7C3AED" strokeWidth={2.5} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* heatmap */}
      <section className="card mt-6 p-6">
        <h2 className="font-heading font-semibold">Activité sur 365 jours</h2>
        <div className="mt-4"><Heatmap data={heatmap} /></div>
      </section>

      {/* history */}
      <section className="card mt-6 overflow-hidden">
        <h2 className="px-6 pt-6 font-heading font-semibold">Historique</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-6 py-2">Date</th><th className="px-6 py-2">Niveau</th><th className="px-6 py-2">Score</th><th className="px-6 py-2">Erreurs</th><th className="px-6 py-2"></th></tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.submission_id} className="border-t border-gray-100">
                <td className="px-6 py-3">{s.created_at?.slice(0, 10)}</td>
                <td className="px-6 py-3 font-semibold">{s.tcf_level}</td>
                <td className="px-6 py-3">{s.overall_score}</td>
                <td className="px-6 py-3">{s.errors?.length ?? 0}</td>
                <td className="px-6 py-3"><Link to={`/feedback/${s.submission_id}`} className="font-semibold text-primary">Voir</Link></td>
              </tr>
            ))}
            {!subs.length && <tr><td colSpan="5" className="px-6 py-6 text-center text-gray-400">Aucune soumission pour l'instant.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
