import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, CaretRight, BookOpen } from '@phosphor-icons/react';
import { BackLink } from '../components/shared';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

/* These used to be the *writing* tâche labels, copy-pasted from SelectTheme. */
const TACHE_LABEL = { 1: 'speakThemes.tache1', 2: 'speakThemes.tache2', 3: 'speakThemes.tache3' };

export default function SpeakingThemes() {
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tache = parseInt(searchParams.get('tache'), 10) || 1;
  const mode = searchParams.get('mode') === 'upload' ? 'upload' : 'record';

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* Without skill=speaking the writing themes, which also have tâche 2 and 3
       questions, are listed here too. */
    api.get(`/api/themes?task_type=${tache}&skill=speaking`)
      .then(({ data }) => setThemes(data.themes || []))
      .catch(() => setThemes([]))
      .finally(() => setLoading(false));
  }, [tache]);

  const isPremiumUser = user?.subscription_status === 'premium';

  /* The parameter used to be named `t`, which shadowed the translator and made
     the premium branch throw instead of showing its toast. */
  const openTheme = (theme) => {
    if (!user) return navigate('/login');
    if (theme.is_premium && !isPremiumUser) {
      toast.error(t('speakThemes.proOnly'));
      return navigate('/pricing');
    }
    navigate(`/speaking/record?tache=${tache}&theme=${theme.theme_id}&mode=${mode}`);
  };

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <BackLink to="/speaking/tasks" label={t('themes.backToTasks')} className="!mb-6" testid="back-to-tasks" />

        <div className="mb-3 text-center">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('speakThemes.select')}</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">{t('speakThemes.chooseSub')}</p>
        </div>

        <div className="mb-8 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-4 py-1.5 text-xs font-bold text-primary">
            {t(TACHE_LABEL[tache])}
          </span>
        </div>

        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
          </div>
        ) : themes.length === 0 ? (
          <p className="text-center text-sm text-gray-500">{t('speakThemes.none')}</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => {
              const locked = theme.is_premium && !isPremiumUser;
              const count = theme.question_count ?? 0;
              return (
                <button
                  key={theme.theme_id}
                  onClick={() => openTheme(theme)}
                  data-testid={`theme-${theme.theme_id}`}
                  className={`flex flex-col rounded-3xl border bg-white p-6 text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50 ${
                    locked ? 'border-amber-100' : 'border-violet-100'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${
                      locked ? 'bg-amber-50' : 'bg-violet-100'
                    }`}>
                      {locked ? <Lock size={20} weight="fill" className="text-amber-500" /> : (theme.emoji || <BookOpen size={20} weight="duotone" className="text-primary" />)}
                    </span>
                    {theme.is_premium ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">{t('speakThemes.pro')}</span>
                    ) : (
                      <CaretRight size={18} className="text-gray-300" />
                    )}
                  </div>

                  <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{theme.name}</h3>
                  {theme.description && (
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{theme.description}</p>
                  )}

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{t('speakThemes.attempted')}</span>
                      <span className="font-semibold text-gray-700">{locked ? '—' : `0/${count}`}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500" style={{ width: '0%' }} />
                    </div>
                    <p className="mt-1 text-right text-[10px] text-gray-400">{locked ? t('themes.upgradeToUnlock') : t('themes.completed', { n: 0 })}</p>
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