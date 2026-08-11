import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ClockCountdown, CheckCircle, Lock, CaretRight, Lightning,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink } from '../components/shared';

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

  useEffect(() => {
    api.get('/api/reading/tests')
      .then(({ data }) => setTests(data.tests || []))
      .catch(() => setTests([]))
      .finally(() => setLoading(false));
  }, []);

  const open = (paper) => {
    if (!paper.is_ready) return;
    if (isTest && !user) return navigate('/login');
    navigate(`/reading/${isTest ? 'test' : 'practice'}/${paper.test_number}`);
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
            {tests.map((paper) => {
              const ready = paper.is_ready;
              return (
                <button
                  key={paper.test_number}
                  onClick={() => open(paper)}
                  disabled={!ready}
                  data-testid={`reading-test-${paper.test_number}`}
                  className={`group flex flex-col overflow-hidden rounded-3xl border bg-white text-left shadow-soft transition ${
                    ready
                      ? `${accent.border} hover:-translate-y-1 hover:shadow-xl ${accent.ring}`
                      : 'cursor-not-allowed border-gray-100 opacity-70'
                  }`}
                >
                  <div className={`h-1.5 w-full bg-gradient-to-r ${ready ? accent.bar : 'from-gray-200 to-gray-300'}`} />
                  <div className="flex flex-1 flex-col p-6">
                    <div className="flex items-start justify-between">
                      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl font-heading text-lg font-extrabold ${
                        ready ? accent.icon : 'bg-gray-100 text-gray-400'
                      }`}>
                        {paper.test_number}
                      </span>
                      {ready ? (
                        <CaretRight size={18} className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-400" />
                      ) : (
                        <Lock size={18} weight="fill" className="text-gray-300" />
                      )}
                    </div>

                    <h3 className="mt-4 font-heading text-base font-bold text-gray-900">
                      {t('readTests.testN', { n: paper.test_number })}
                    </h3>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">
                      {ready
                        ? t('readTests.cardReady', { n: paper.question_count })
                        : t('readTests.cardSoon')}
                    </p>

                    <div className="mt-4 flex items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                        A1 → C2
                      </span>
                      {ready && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                          <CheckCircle size={11} weight="fill" /> {t('readTests.ready')}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-gray-400">
          {t('readTests.footnote')}
        </p>
      </section>
    </main>
  );
}
