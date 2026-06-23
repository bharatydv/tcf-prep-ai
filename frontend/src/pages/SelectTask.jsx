import { useNavigate } from 'react-router-dom';
import {
  ChatText, Article, Scales, ClockCountdown, PenNib, ArrowLeft,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';

const TACHES = [
  { n: 1, title: 'Tâche 1 : Écrire un message', range: '60 – 120 mots',
    desc: 'Rédigez un message personnel à un ami ou un collègue.', icon: ChatText },
  { n: 2, title: 'Tâche 2 : Rédiger un article', range: '120 – 150 mots',
    desc: 'Racontez une expérience personnelle dans un texte ou un article.', icon: Article },
  { n: 3, title: 'Tâche 3 : Comparer deux avis', range: '120 – 180 mots',
    desc: 'Comparez deux opinions sur un sujet de société et donnez votre point de vue.', icon: Scales },
];

export default function SelectTask() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const chooseTache = (t) => {
    if (!user) return navigate('/login');
    navigate(`/practice/themes?tache=${t.n}`);
  };

  const startSimulator = () => {
    if (!user) return navigate('/login');
    navigate('/exam-simulator');
  };

  return (
    <main className="overflow-x-clip bg-white">
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <button
          onClick={() => navigate('/practice')}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          data-testid="back-to-modes"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl font-extrabold text-gray-900">Select a task — Practice mode</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600">
            Choose a writing task to practice, or run the full AI exam simulator.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {TACHES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.n}
                onClick={() => chooseTache(t)}
                data-testid={`select-tache-${t.n}`}
                className="flex flex-col rounded-3xl border border-violet-100 bg-white p-6 text-left shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-primary">
                  <Icon size={22} weight="fill" />
                </span>
                <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t.title}</h3>
                <p className="mt-1 text-xs font-semibold text-primary">{t.range}</p>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{t.desc}</p>
                <span className="btn-primary mt-5 w-full justify-center !bg-gradient-to-r !from-primary !to-fuchsia-600">
                  <PenNib size={16} weight="fill" /> Select task
                </span>
              </button>
            );
          })}
        </div>

        {/* AI Simulator card */}
        <div className="mt-5">
          <button
            onClick={startSimulator}
            data-testid="select-ai-simulator"
            className="flex w-full flex-col items-start gap-3 rounded-3xl border border-pink-100 bg-gradient-to-br from-pink-50 to-fuchsia-50 p-6 text-left shadow-soft transition hover:shadow-xl hover:shadow-pink-200/50 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-100 text-pink-700">
                <ClockCountdown size={24} weight="fill" />
              </span>
              <div>
                <h3 className="font-heading text-base font-bold text-gray-900">AI Exam Simulator</h3>
                <p className="mt-1 text-sm text-gray-600">All 3 tâches under one timer, with a combined score report.</p>
              </div>
            </div>
            <span className="btn-primary shrink-0 justify-center !bg-gradient-to-r !from-pink-600 !to-fuchsia-600">
              <ClockCountdown size={16} weight="fill" /> Start simulator
            </span>
          </button>
        </div>
      </section>
    </main>
  );
}