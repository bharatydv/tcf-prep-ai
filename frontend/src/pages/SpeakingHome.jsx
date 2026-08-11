import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkle, Compass, Microphone, ClockCountdown, CheckCircle,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

const FREE_LIMIT = 5;

export default function SpeakingHome() {
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  const startPractice = () => navigate('/speaking/tasks');
  const startTest = () => {
    if (!user) return navigate('/login');
    navigate('/speaking/test');
  };

  return (
    <main className="overflow-x-clip bg-white">
      {/* SLIM ACTION BAR */}
      <section className="border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2.5 px-4 py-3 sm:px-6">
          <Link to="/methodology"
            className="btn-primary !py-1.5 text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <Compass size={16} weight="fill" /> {t('practice.methodologyDup')}
          </Link>
          <Link to="/recent-topics"
            className="btn-primary !py-1.5 text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <Sparkle size={16} weight="fill" /> {t('practice.newTopicsDup')}
          </Link>
          {user && user.subscription_status !== 'premium' && (
            <span className="pill bg-white/80 text-primary shadow-sm">
              {user.free_submissions_used} / {FREE_LIMIT} free attempts
            </span>
          )}
        </div>
      </section>

      {/* MODE CHOICE */}
      <section className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
        <div className="mb-6 text-center">
          <h2 className="font-heading text-2xl font-extrabold text-gray-900">{t('speakHome.chooseMode')}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">
            {t('speakHome.chooseModeSub')}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* PRACTICE MODE */}
          <div className="flex flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-soft transition hover:shadow-xl hover:shadow-violet-200/50">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                <Microphone size={24} weight="fill" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-extrabold text-gray-900">{t('speakHome.practiceMode')}</h3>
                <p className="text-xs font-semibold text-primary">{t('speakHome.practiceModeSub')}</p>
              </div>
            </div>
            <ul className="mt-5 space-y-2.5 text-sm text-gray-600">
              <li className="flex items-start gap-2"><CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {t('speakHome.bullet1')}</li>
              <li className="flex items-start gap-2"><CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {t('speakHome.bullet2')}</li>
              <li className="flex items-start gap-2"><CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> {t('speakHome.bullet3')}</li>
            </ul>
            <button onClick={startPractice}
              className="btn-primary mt-6 w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
              <Microphone size={18} weight="fill" /> {t('speakHome.startPractice')}
            </button>
          </div>

          {/* TEST MODE */}
          <div className="flex flex-col rounded-3xl border border-pink-100 bg-white p-6 shadow-soft transition hover:shadow-xl hover:shadow-pink-200/50">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-100 text-pink-700">
                <ClockCountdown size={24} weight="fill" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-extrabold text-gray-900">{t('speakHome.testMode')}</h3>
                <p className="text-xs font-semibold text-pink-700">{t('speakHome.testModeSub')}</p>
              </div>
            </div>
            <p className="mt-5 text-xs font-bold uppercase tracking-wide text-gray-400">{t('speakHome.whatToExpect')}</p>
            <ul className="mt-2 space-y-2.5 text-sm text-gray-600">
              <li className="flex items-start gap-2"><CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-pink-600" /> {t('speakHome.testBullet1')}</li>
              <li className="flex items-start gap-2"><CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-pink-600" /> {t('speakHome.testBullet2')}</li>
              <li className="flex items-start gap-2"><CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-pink-600" /> {t('speakHome.testBullet3')}</li>
            </ul>
            <button onClick={startTest}
              className="btn-primary mt-6 w-full justify-center !bg-gradient-to-r !from-pink-600 !to-fuchsia-600">
              <ClockCountdown size={18} weight="fill" /> {t('speakHome.startSimulator')}
            </button>
          </div>
        </div>

        <p className="mx-auto mt-5 max-w-xl pb-12 text-center text-xs leading-relaxed text-gray-400">
          {t('common.disclaimerLevels')}
        </p>
      </section>
    </main>
  );
}