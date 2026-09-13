import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ClockCountdown, Lightning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { BackLink } from '../components/shared';
import { PaperCard } from '../components/PaperCard';

/* The ten papers, in either mode. Practice marks each question as it is
   answered; test withholds everything until the paper is handed in. Both read
   the same questions, so a learner can rehearse a paper and then sit it. */
export default function ReadingTests() {
  // The mode lives in the path (/reading/practice | /reading/test) rather than
  // in a param, so the two routes stay explicit and typos cannot reach here.
  const isTest = useLocation().pathname.startsWith('/reading/test');
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [freeTestsLeft, setFreeTestsLeft] = useState(null);

  useEffect(() => {
    // Require authentication for both practice and test modes
    if (!user) {
      navigate('/login');
      return;
    }

    api.get('/api/reading/tests')
      .then(({ data }) => {
        setTests(data.tests || []);
        // null is unlimited (premium); a number is what a free account has
        // left. Taken from the server rather than inferred from the user row,
        // because the count lives in reading_attempts and nowhere else.
        setFreeTestsLeft(data.free_tests_left ?? null);
      })
      .catch(() => setTests([]))
      .finally(() => setLoading(false));
  }, [user, navigate]);

  /* `mode` rather than the page's own mode: a paper the learner has
     already sat offers both, so the card says which one it means. */
  const open = (paper, mode = isTest ? 'test' : 'practice') => {
    if (!paper.is_ready) return;
    // One free timed sitting. Refused here rather than at hand-in, where the
    // learner has already spent the hour it takes to earn the refusal.
    if (mode === 'test' && freeTestsLeft === 0) {
      toast.info(t('read.testUsed'));
      return navigate('/pricing');
    }
    navigate(`/reading/${mode}/${paper.test_number}`);
  };

  const accent = isTest
    ? { chip: 'bg-pink-100 text-pink-700', icon: 'bg-pink-100 text-pink-700',
        ring: 'hover:shadow-pink-200/50', border: 'border-pink-100',
        bar: 'from-pink-600 to-fuchsia-600' }
    : { chip: 'bg-violet-100 text-primary', icon: 'bg-violet-100 text-primary',
        ring: 'hover:shadow-violet-200/50', border: 'border-violet-100',
        bar: 'from-primary to-fuchsia-600' };

  return (
    <main className="overflow-x-clip bg-white">
      <Seo titleKey="seo.readingPractice.title" descKey="seo.readingPractice.desc" path="/reading/practice" />
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <BackLink to="/reading" className="!mb-6" testid="back-to-reading" />

        <div className="mb-3 text-center">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">
            {isTest ? t('readTests.testTitle') : t('readTests.practiceTitle')}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
            {isTest ? t('readTests.testSub') : t('readTests.practiceSub')}
          </p>
        </div>

        <div className="mb-8 flex flex-wrap justify-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold ${accent.chip}`}>
            {isTest ? <ClockCountdown size={14} weight="fill" /> : <Lightning size={14} weight="fill" />}
            {isTest ? t('readTests.badgeTimed') : t('readTests.badgeInstant')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-xs font-bold text-gray-600">
            {t('readTests.badgeLevels')}
          </span>
        </div>

        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {tests.map((paper) => (
              <PaperCard key={paper.test_number} paper={paper}
                ns="readTests" isTest={isTest} accent={accent} onOpen={open} />
            ))}
          </div>
        )}

        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-gray-400">
          {t('readTests.footnote')}
        </p>
      </section>
    </main>
  );
}
