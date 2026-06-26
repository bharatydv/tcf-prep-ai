import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkle, Compass, Headphones, ClockCountdown, CheckCircle,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';

const FREE_LIMIT = 5;

export default function ListeningHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const startPractice = () => navigate('/listening/practice');
  const startTest = () => {
    if (!user) return navigate('/login');
    navigate('/listening/test');
  };

  return (
    <main className="overflow-x-clip bg-white">
      {/* SLIM ACTION BAR */}
      <section className="border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2.5 px-4 py-3 sm:px-6">
          <Link to="/methodology"
            className="btn-primary !py-1.5 text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <Compass size={16} weight="fill" /> Methodology
          </Link>
          <Link to="/recent-topics"
            className="btn-primary !py-1.5 text-sm !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <Sparkle size={16} weight="fill" /> New Topics
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
          <h2 className="font-heading text-2xl font-extrabold text-gray-900">Listening — choose how you want to work</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">
            Practice audio passages one at a time, or sit a full timed listening test.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* PRACTICE */}
          <div className="flex flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-soft transition hover:shadow-xl hover:shadow-violet-200/50">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                <Headphones size={24} weight="fill" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-extrabold text-gray-900">Practice mode</h3>
                <p className="text-xs font-semibold text-primary">Learn at your own pace</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-600">
              Listen to audio passages one at a time and check your answers instantly.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="shrink-0 text-primary" /> Audio + multiple-choice questions</li>
              <li className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="shrink-0 text-primary" /> Instant correct/incorrect feedback</li>
              <li className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="shrink-0 text-primary" /> No timer, no pressure</li>
            </ul>
            <button onClick={startPractice}
              className="btn-primary mt-6 w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
              <Headphones size={18} weight="fill" /> Start practice
            </button>
          </div>

          {/* TEST */}
          <div className="flex flex-col rounded-3xl border border-pink-100 bg-white p-6 shadow-soft transition hover:shadow-xl hover:shadow-pink-200/50">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-100 text-pink-700">
                <ClockCountdown size={24} weight="fill" />
              </span>
              <div>
                <h3 className="font-heading text-lg font-extrabold text-gray-900">Test mode</h3>
                <p className="text-xs font-semibold text-pink-700">Simulate the real exam</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-600">
              Answer a full set of passages under a timer, then get your score.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="shrink-0 text-pink-600" /> Full set of questions</li>
              <li className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="shrink-0 text-pink-600" /> Real exam timer</li>
              <li className="flex items-center gap-2"><CheckCircle size={16} weight="fill" className="shrink-0 text-pink-600" /> Score report at the end</li>
            </ul>
            <button onClick={startTest}
              className="btn-primary mt-6 w-full justify-center !bg-gradient-to-r !from-pink-600 !to-fuchsia-600">
              <ClockCountdown size={18} weight="fill" /> Start test
            </button>
          </div>
        </div>

        <p className="mx-auto mt-5 max-w-xl pb-12 text-center text-xs leading-relaxed text-gray-400">
          This is a practice tool, not the official TEF/TCF exam. Scores are estimates to guide your preparation.
        </p>
      </section>
    </main>
  );
}
