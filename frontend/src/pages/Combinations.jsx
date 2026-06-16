import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack, Play, CaretDown, Star, Eye, Clock,
} from '@phosphor-icons/react';

/* ------------------------------------------------------------------ data ----
   Static placeholder content. Replace `COMBINATIONS` with real data from your
   backend later (e.g. GET /api/combinations). Each combination has 3 tâches. */
const TASK_META = [
  { n: 1, type: 'Message court', words: '60-120 mots', time: '10 min', badge: 'bg-primary' },
  { n: 2, type: 'Narration', words: '120-150 mots', time: '20 min', badge: 'bg-green-600' },
  { n: 3, type: 'Argumentation', words: '120-180 mots', time: '30 min', badge: 'bg-fuchsia-600' },
];

const COMBINATIONS = Array.from({ length: 13 }, (_, i) => ({
  id: i + 1,
  title: `Combinaison ${i + 1}`,
  tasks: [
    { ...TASK_META[0], prompt: 'Contenu à ajouter — Tâche 1 (message court).' },
    { ...TASK_META[1], prompt: 'Contenu à ajouter — Tâche 2 (narration).' },
    { ...TASK_META[2], prompt: 'Contenu à ajouter — Tâche 3 (argumentation).' },
  ],
}));

/* ------------------------------------------------------------- one tâche ---- */
function TaskBlock({ task }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg font-heading text-xs font-bold text-white ${task.badge}`}>
            {task.n}
          </span>
          <span className="font-heading text-sm font-bold text-gray-900">Tâche {task.n}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{task.type}</span><span>·</span><span>{task.words}</span><span>·</span>
          <span className="inline-flex items-center gap-1"><Clock size={13} /> {task.time}</span>
          <Star size={15} className="ml-1 cursor-pointer text-gray-300 hover:text-amber-400" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">{task.prompt}</p>
      <button
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-600"
        data-testid={`view-correction-${task.n}`}
      >
        <Eye size={16} weight="fill" /> Voir la correction
      </button>
    </div>
  );
}

/* ----------------------------------------------------- one combination row -- */
function CombinationRow({ combo, open, onToggle, onSimulate }) {
  return (
    <div className="overflow-hidden rounded-2xl shadow-soft">
      {/* header bar */}
      <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-primary to-fuchsia-600 px-5 py-4">
        <button onClick={onToggle} className="flex flex-1 items-center gap-3 text-left" data-testid={`combo-toggle-${combo.id}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-white">
            <Stack size={18} weight="fill" />
          </span>
          <span className="font-heading text-base font-bold text-white">{combo.title}</span>
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={onSimulate}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 font-heading text-sm font-bold text-primary shadow transition hover:scale-105"
            data-testid={`combo-simulate-${combo.id}`}
          >
            <Play size={15} weight="fill" /> Simulateur
          </button>
          <button onClick={onToggle} aria-label="Toggle" data-testid={`combo-caret-${combo.id}`}>
            <CaretDown size={20} weight="bold" className={`text-white transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* expandable body */}
      {open && (
        <div className="space-y-4 bg-violet-50/40 p-4">
          {combo.tasks.map((t) => <TaskBlock key={t.n} task={t} />)}
        </div>
      )}
    </div>
  );
}

/* ===================================================================== page */
export default function Combinations() {
  const navigate = useNavigate();
  const [openId, setOpenId] = useState(1);  // first one open by default

  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-6 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-violet-400/25 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl px-4 pb-7 pt-8 text-center sm:px-6">
          <h1 className="font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            Recent{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">Topics</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600">
            Browse exam combinations, review model corrections, and run the full simulator for each set of 3 tâches.
          </p>
        </div>
      </section>

      {/* COMBINATIONS LIST */}
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="space-y-4">
          {COMBINATIONS.map((combo) => (
            <CombinationRow
              key={combo.id}
              combo={combo}
              open={openId === combo.id}
              onToggle={() => setOpenId(openId === combo.id ? null : combo.id)}
              onSimulate={() => navigate('/exam-simulator')}
            />
          ))}
        </div>
      </section>
    </main>
  );
}