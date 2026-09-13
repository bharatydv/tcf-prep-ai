import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BackLink } from '../components/shared';
import { ThemeCard } from '../components/ThemeCard';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { useSeo } from '../lib/seo';

/* These used to be the *writing* tâche labels, copy-pasted from SelectTheme. */
const TACHE_LABEL = { 1: 'speakThemes.tache1', 2: 'speakThemes.tache2', 3: 'speakThemes.tache3' };

export default function SpeakingThemes() {
  // A hook rather than an element, so no early return — loading, empty,
  // or "coming soon" — can skip it and leave the page inheriting the
  // shell's canonical, which points at the homepage.
  useSeo({ titleKey: 'seo.speakThemes.title', descKey: 'seo.speakThemes.desc', path: '/speaking/themes' });

  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tache = parseInt(searchParams.get('tache'), 10) || 1;
  const mode = searchParams.get('mode') === 'upload' ? 'upload' : 'record';

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  /* Its own request: /api/themes is public and cached for everyone,
     and this answer is one person's. Failing quietly is right — a
     picker that cannot say what you already did is still a picker. */
  const [attempts, setAttempts] = useState({});

  useEffect(() => {
    /* Without skill=speaking the writing themes, which also have tâche 2 and 3
       questions, are listed here too. */
    api.get(`/api/themes?task_type=${tache}&skill=speaking`)
      .then(({ data }) => setThemes(data.themes || []))
      .catch(() => setThemes([]))
      .finally(() => setLoading(false));
  }, [tache]);

  useEffect(() => {
    if (!user) return;
    api.get('/api/themes/attempts', { params: { skill: 'speaking' } })
      .then(({ data }) => setAttempts(data.attempts || {}))
      .catch(() => setAttempts({}));
  }, [user]);

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
            {themes.map((theme) => (
              <ThemeCard key={theme.theme_id} theme={theme}
                ns="speakThemes" locked={theme.is_premium && !isPremiumUser}
                attempt={attempts[theme.theme_id]} onOpen={openTheme} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}