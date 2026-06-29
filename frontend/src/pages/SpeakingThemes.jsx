import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Lock, CaretRight, BookOpen } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const TACHE_LABEL = {
  1: 'Tâche 1 : Écrire un message (60 à 120 mots)',
  2: 'Tâche 2 : Rédiger un article (120 à 150 mots)',
  3: 'Tâche 3 : Comparer deux avis (120 à 180 mots)',
};

export default function SpeakingThemes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tache = parseInt(searchParams.get('tache'), 10) || 1;
  const mode = searchParams.get('mode') === 'upload' ? 'upload' : 'record';

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/api/themes?task_type=${tache}`)
      .then(({ data }) => setThemes(data.themes || []))
      .catch(() => setThemes([]))
      .finally(() => setLoading(false));
  }, [tache]);

  const isPremiumUser = user?.subscription_status === 'premium';

  const openTheme = (t) => {
    if (!user) return navigate('/login');
    if (t.is_premium && !isPremiumUser) {
      toast.error('Ce thème est réservé aux membres Pro.');
      return navigate('/pricing');
    }
    navigate(`/speaking/record?tache=${tache}&theme=${t.theme_id}&mode=${mode}`);
  };

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <button
          onClick={() => navigate('/speaking/tasks')}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          data-testid="back-to-tasks"
        >
          <ArrowLeft size={16} /> Back to tasks
        </button>

        <div className="mb-3 text-center">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">Select a writing theme</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">
            Choose a theme for your writing practice. Track your progress and improve with personalized feedback.
          </p>
        </div>

        <div className="mb-8 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-4 py-1.5 text-xs font-bold text-primary">
            {TACHE_LABEL[tache]}
          </span>
        </div>

        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
          </div>
        ) : themes.length === 0 ? (
          <p className="text-center text-sm text-gray-500">No themes available yet.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((t) => {
              const locked = t.is_premium && !isPremiumUser;
              const count = t.question_count ?? 0;
              return (
                <button
                  key={t.theme_id}
                  onClick={() => openTheme(t)}
                  data-testid={`theme-${t.theme_id}`}
                  className={`flex flex-col rounded-3xl border bg-white p-6 text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50 ${
                    locked ? 'border-amber-100' : 'border-violet-100'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${
                      locked ? 'bg-amber-50' : 'bg-violet-100'
                    }`}>
                      {locked ? <Lock size={20} weight="fill" className="text-amber-500" /> : (t.emoji || <BookOpen size={20} weight="duotone" className="text-primary" />)}
                    </span>
                    {t.is_premium ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">Pro</span>
                    ) : (
                      <CaretRight size={18} className="text-gray-300" />
                    )}
                  </div>

                  <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t.name}</h3>
                  {t.description && (
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{t.description}</p>
                  )}

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Attempted questions</span>
                      <span className="font-semibold text-gray-700">{locked ? '—' : `0/${count}`}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: '0%' }} />
                    </div>
                    <p className="mt-1 text-right text-[10px] text-gray-400">{locked ? 'Upgrade to unlock' : '0% completed'}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}