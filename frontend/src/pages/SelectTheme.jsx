import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { useSeo } from '../lib/seo';
import { BackLink } from '../components/shared';
import { ThemeCard } from '../components/ThemeCard';

const TACHE_LABEL = { 1: 'themes.tache1', 2: 'themes.tache2', 3: 'themes.tache3' };

export default function SelectTheme() {
  // A hook rather than an element, so no early return — loading, empty,
  // or "coming soon" — can skip it and leave the page inheriting the
  // shell's canonical, which points at the homepage.
  useSeo({ titleKey: 'seo.themes.title', descKey: 'seo.themes.desc', path: '/practice/themes' });

  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tache = parseInt(searchParams.get('tache'), 10) || 1;

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  /* Its own request: /api/themes is public and cached for everyone,
     and this answer is one person's. Failing quietly is right — a
     picker that cannot say what you already did is still a picker. */
  const [attempts, setAttempts] = useState({});

  useEffect(() => {
    /* skill=writing matters: speaking themes also carry tâche 2 and 3
       questions, so without it they show up on the writing theme page. */
    api.get(`/api/themes?task_type=${tache}&skill=writing`)
      .then(({ data }) => setThemes(data.themes || []))
      .catch(() => setThemes([]))
      .finally(() => setLoading(false));
  }, [tache]);

  useEffect(() => {
    if (!user) return;
    api.get('/api/themes/attempts', { params: { skill: 'writing' } })
      .then(({ data }) => setAttempts(data.attempts || {}))
      .catch(() => setAttempts({}));
  }, [user]);

  const isPremiumUser = user?.subscription_status === 'premium';

  /* The parameter used to be named `t`, which shadowed the translator and made
     the premium branch throw instead of showing its toast. */
  const openTheme = (theme) => {
    if (!user) return navigate('/login');
    if (theme.is_premium && !isPremiumUser) {
      toast.error(t('themes.proOnlyDup'));
      return navigate('/pricing');
    }
    navigate(`/practice/write?tache=${tache}&theme=${theme.theme_id}`);
  };

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <BackLink to="/practice/tasks" label={t('themes.backToTasks')} className="!mb-6" testid="back-to-tasks" />

        <div className="mb-3 text-center">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('themes.selectWriting')}</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">{t('themes.chooseSub')}</p>
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
          <p className="text-center text-sm text-gray-500">{t('themes.none')}</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => (
              <ThemeCard key={theme.theme_id} theme={theme}
                ns="themes" locked={theme.is_premium && !isPremiumUser}
                attempt={attempts[theme.theme_id]} onOpen={openTheme} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
