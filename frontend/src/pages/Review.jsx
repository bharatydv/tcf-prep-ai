import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Cards, ListChecks, Lightning, Fire } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';

function shuffle(a) { return [...a].sort(() => Math.random() - 0.5); }

export default function Review() {
  const [params] = useSearchParams();
  const category = params.get('category');
  const [queue, setQueue] = useState(null);
  const [mode, setMode] = useState(null); // flashcards | mcq | sprint
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sprintLeft, setSprintLeft] = useState(120);

  const load = () => {
    api.get('/api/review/queue', { params: category ? { category } : {} })
      .then(({ data }) => setQueue(data))
      .catch((e) => toast.error(errMsg(e)));
  };
  useEffect(load, [category]);

  const items = useMemo(() => shuffle(queue?.due || []), [queue]);
  const currentItem = items[idx];
  const options = useMemo(() => {
    if (!currentItem) return [];
    const opts = new Set([currentItem.correction, currentItem.error_text]);
    if (currentItem.distractor) opts.add(currentItem.distractor);
    return shuffle([...opts]);
  }, [currentItem]);

  useEffect(() => {
    if (mode !== 'sprint' || summary) return;
    const id = setInterval(() => setSprintLeft((s) => {
      if (s <= 1) { clearInterval(id); finish(results); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [mode, summary]);

  const finish = async (finalResults) => {
    if (!finalResults.length) { setMode(null); return; }
    try {
      const { data } = await api.post('/api/review/submit', { mode, results: finalResults });
      setSummary(data);
      if (data.streak?.extended) toast.success(`🔥 ${data.streak.current_streak}-day streak!`);
      data.badges?.forEach((b) => toast.success(`🏅 Badge : ${b}`));
    } catch (e) { toast.error(errMsg(e)); }
  };

  const answer = (correct) => {
    const m = items[idx];
    const next = [...results, { mistake_id: m.mistake_id, correct }];
    setResults(next);
    setFlipped(false); setPicked(null);
    if (idx + 1 >= items.length) finish(next);
    else setIdx(idx + 1);
  };

  const start = (m) => { setMode(m); setIdx(0); setResults([]); setSummary(null); setFlipped(false); setPicked(null); setSprintLeft(120); };

  if (!queue) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  /* ---- summary screen ---- */
  if (summary) {
    const correct = results.filter((r) => r.correct).length;
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">Session terminée 🎉</h1>
        <div className="card mt-6 space-y-3 p-8">
          <p className="font-heading text-5xl font-bold text-primary">+{summary.xp_earned} XP</p>
          <p className="text-gray-600">{correct} / {results.length} corrects · {summary.newly_mastered.length} maîtrisés · XP total : {summary.total_xp}</p>
          {summary.badges?.map((b) => <p key={b} className="pill mx-auto bg-amber-50 text-amber-700">🏅 {b}</p>)}
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn-primary" onClick={() => { setMode(null); setSummary(null); load(); }}>Continuer</button>
          <Link to="/dashboard" className="btn-outline">Tableau de bord</Link>
        </div>
      </main>
    );
  }

  /* ---- hub ---- */
  if (!mode) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold">Révision de vos erreurs</h1>
        <p className="mt-2 text-gray-600">
          {category ? <>Catégorie : <span className="pill" style={{ background: CATEGORY_META[category]?.color }}>{CATEGORY_META[category]?.label}</span> · </> : null}
          <strong>{queue.due.length}</strong> erreurs à réviser aujourd'hui (répétition espacée : 1 / 3 / 7 / 14 jours). Les révisions sont gratuites et comptent pour votre série <Fire size={14} className="inline text-orange-500" weight="fill" />.
        </p>
        {queue.due.length === 0 ? (
          <div className="card mt-8 p-10 text-center">
            <p className="text-2xl">🎉 Rien à réviser !</p>
            <p className="mt-2 text-gray-600">Revenez demain, ou <Link to="/practice" className="font-semibold text-primary">écrivez un nouveau texte</Link>.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ['flashcards', Cards, 'Fix-it cards', 'Votre phrase erronée → formulez la correction → retournez la carte et auto-évaluez-vous.'],
              ['mcq', ListChecks, 'Choose-the-correct', 'QCM générés à partir de vos propres erreurs : erreur, correction, et un piège.'],
              ['sprint', Lightning, 'Category sprint', '2 minutes chrono sur vos erreurs dues — combien pouvez-vous en corriger ?'],
            ].map(([key, Icon, title, desc]) => (
              <button key={key} className="card card-hover p-6 text-left" onClick={() => start(key)} data-testid={`mode-${key}`}>
                <Icon size={28} weight="duotone" className="text-primary" />
                <h3 className="mt-3 font-heading text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-gray-600">{desc}</p>
              </button>
            ))}
          </div>
        )}
      </main>
    );
  }

  const m = items[idx];
  if (!m) return null;
  const meta = CATEGORY_META[m.category] || {};
  const progress = `${idx + 1} / ${items.length}`;

  /* ---- flashcards ---- */
  if (mode === 'flashcards') {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <div className="flex items-center justify-between text-sm text-gray-500"><span>Fix-it cards · {progress}</span><span className="pill" style={{ background: meta.color }}>{meta.label}</span></div>
        <div className="card flip-in mt-4 min-h-[260px] p-8" key={`${idx}-${flipped}`}>
          {!flipped ? (
            <>
              <p className="text-xs uppercase tracking-wide text-gray-400">Votre phrase (avec erreur)</p>
              <p className="mt-3 text-lg leading-relaxed text-red-700">{m.error_text}</p>
              <p className="mt-6 text-sm text-gray-500">Formulez la correction dans votre tête, puis retournez la carte.</p>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-gray-400">Correction</p>
              <p className="mt-3 text-lg font-medium leading-relaxed text-green-700">{m.correction}</p>
              <p className="mt-4 text-sm text-gray-600">{m.explanation}</p>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-center gap-3">
          {!flipped ? (
            <button className="btn-primary" onClick={() => setFlipped(true)} data-testid="flip-button">Retourner la carte</button>
          ) : (
            <>
              <button className="btn-outline !border-amber-300 !text-amber-600" onClick={() => answer(false)} data-testid="shaky-button">Encore fragile</button>
              <button className="btn-primary !bg-green-600 hover:!bg-green-500" onClick={() => answer(true)} data-testid="gotit-button">Je l'ai !</button>
            </>
          )}
        </div>
      </main>
    );
  }

  /* ---- mcq & sprint ---- */
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{mode === 'sprint' ? `Sprint · ${Math.floor(sprintLeft / 60)}:${String(sprintLeft % 60).padStart(2, '0')}` : `QCM · ${progress}`}</span>
        <span className="pill" style={{ background: meta.color }}>{meta.label}</span>
      </div>
      <div className="card mt-4 p-8">
        <p className="text-xs uppercase tracking-wide text-gray-400">Quelle est la forme correcte ?</p>
        <p className="mt-3 text-lg text-gray-800">« {m.error_text} »</p>
        <div className="mt-5 space-y-3">
          {options.map((opt) => {
            const isCorrect = opt === m.correction;
            const state = picked == null ? '' : isCorrect ? '!border-green-500 bg-green-50' : opt === picked ? '!border-red-400 bg-red-50' : 'opacity-50';
            return (
              <button key={opt} disabled={picked != null}
                className={`block w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-left text-sm transition hover:border-primary ${state}`}
                onClick={() => { setPicked(opt); setTimeout(() => answer(isCorrect), 900); }}>
                {opt}
              </button>
            );
          })}
        </div>
        {picked != null && <p className="mt-4 text-sm text-gray-600">{m.explanation}</p>}
      </div>
    </main>
  );
}

