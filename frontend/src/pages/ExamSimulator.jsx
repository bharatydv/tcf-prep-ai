import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Timer, WarningCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AccentToolbar, ErrorHighlightedText } from '../components/shared';

const GUIDE = {
  1: { name: 'Tâche 1 — Message pratique court', min: 60, max: 120 },
  2: { name: 'Tâche 2 — Article, blog ou lettre', min: 120, max: 150 },
  3: { name: 'Tâche 3 — Texte argumentatif', min: 120, max: 180 },
};
const TOTAL = 60 * 60;

export default function ExamSimulator() {
  const { refreshUser } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | exam | submitting | results
  const [current, setCurrent] = useState(1);
  const [texts, setTexts] = useState({ 1: '', 2: '', 3: '' });
  const [seconds, setSeconds] = useState(TOTAL);
  const [attempt, setAttempt] = useState(null);
  const taRef = useRef(null);
  const warned = useRef({ 10: false, 2: false });

  useEffect(() => {
    api.get('/api/simulator/start').then(({ data }) => setTasks(data)).catch((e) => toast.error(errMsg(e)));
  }, []);

  const submit = useCallback(async (timeUsed) => {
    setPhase('submitting');
    try {
      const { data } = await api.post('/api/simulator/submit', {
        task1: { prompt: tasks.task1?.text || '', text: texts[1] },
        task2: { prompt: tasks.task2?.text || '', text: texts[2] },
        task3: { prompt: tasks.task3?.text || '', text: texts[3] },
        time_used_seconds: timeUsed,
      });
      setAttempt(data.attempt);
      setPhase('results');
      await refreshUser();
    } catch (e) {
      toast.error(errMsg(e));
      setPhase('exam');
    }
  }, [tasks, texts, refreshUser]);

  useEffect(() => {
    if (phase !== 'exam') return;
    const id = setInterval(() => {
      setSeconds((s) => {
        const next = s - 1;
        if (next === 600 && !warned.current[10]) { warned.current[10] = true; toast.warning('⏰ Plus que 10 minutes !'); }
        if (next === 120 && !warned.current[2]) { warned.current[2] = true; toast.warning('⏰ Plus que 2 minutes !'); }
        if (next <= 0) { clearInterval(id); toast.info('Temps écoulé — envoi automatique'); submit(TOTAL); return 0; }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, submit]);

  if (!tasks) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  if (phase === 'intro') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold">Simulateur d'examen — Expression écrite</h1>
        <div className="card mt-6 space-y-4 p-8">
          <p className="text-gray-700">Conditions réelles du TCF Canada :</p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>⏱️ <strong>60 minutes</strong> pour les 3 tâches, chrono strict (envoi automatique à zéro)</li>
            <li>📝 Tâche 1 : 60–120 mots · Tâche 2 : 120–150 mots · Tâche 3 : 120–180 mots</li>
            <li>🚫 Pas de correcteur orthographique, pas de copier-coller</li>
            <li>💳 Une simulation = <strong>1 crédit</strong> (et non 3)</li>
          </ul>
          <button className="btn-primary w-full" onClick={() => setPhase('exam')} data-testid="start-simulator-button">
            Commencer l'examen
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'submitting') {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
        <p className="text-gray-600">Correction des trois tâches en cours…</p>
      </main>
    );
  }

  if (phase === 'results' && attempt) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold">Résultats de la simulation</h1>
        <div className="card mt-6 flex flex-wrap items-center justify-around gap-6 p-8 text-center">
          <div><p className="text-sm text-gray-500">Score combiné</p><p className="font-heading text-5xl font-bold text-primary">{attempt.combined_score}</p></div>
          <div><p className="text-sm text-gray-500">Niveau CECR</p><p className="font-heading text-5xl font-bold">{attempt.tcf_level}</p></div>
          <div><p className="text-sm text-gray-500">Temps utilisé</p><p className="font-heading text-3xl font-bold">{Math.floor(attempt.time_used_seconds / 60)} min</p></div>
        </div>
        {[1, 2, 3].map((i) => {
          const t = attempt[`task${i}`];
          if (!t) return null;
          return (
            <section key={i} className="card mt-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-heading text-xl font-semibold">{GUIDE[i].name}</h2>
                <span className="pill bg-violet-50 text-primary">Score {t.analysis.overall_score} · {t.analysis.tcf_level}</span>
              </div>
              <p className="mt-1 text-sm italic text-gray-500">{t.prompt}</p>
              <div className="mt-4 rounded-xl bg-gray-50 p-5">
                <ErrorHighlightedText text={t.text || '(vide)'} errors={t.analysis.errors} />
              </div>
            </section>
          );
        })}
        <section className="card mt-6 p-6">
          <h2 className="font-heading text-xl font-semibold">Toutes les erreurs par catégorie</h2>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const errs = [1, 2, 3].flatMap((i) => (attempt[`task${i}`]?.analysis.errors || []).filter((e) => e.category === key));
            if (!errs.length) return null;
            return (
              <div key={key} className="mt-5">
                <span className="pill" style={{ background: meta.color }}>{meta.label} · {errs.length}</span>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {errs.map((e, j) => (
                      <tr key={j} className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-3 text-red-600">{e.error}</td>
                        <td className="py-2 pr-3 font-medium text-green-700">{e.correction}</td>
                        <td className="py-2 text-gray-600">{e.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
        <div className="mt-8 flex gap-3">
          <Link to="/review" className="btn-primary">Réviser mes erreurs</Link>
          <Link to="/dashboard" className="btn-outline">Tableau de bord</Link>
        </div>
      </main>
    );
  }

  /* ------ exam phase: distraction-free full screen ------ */
  const task = tasks[`task${current}`];
  const words = texts[current].trim() ? texts[current].trim().split(/\s+/).length : 0;
  const g = GUIDE[current];
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const low = seconds <= 120;

  return (
    <main className="fixed inset-0 z-40 overflow-y-auto bg-white">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <button key={i} onClick={() => setCurrent(i)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${current === i ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                data-testid={`task-tab-${i}`}>
                Tâche {i}
              </button>
            ))}
          </div>
          <span className={`pill text-base ${low ? 'bg-red-50 text-red-600' : 'bg-violet-50 text-primary'}`} data-testid="exam-timer">
            <Timer size={18} weight="fill" /> {mm}:{ss}
          </span>
        </div>

        <div className="card mt-5 p-5">
          <h2 className="font-heading font-semibold">{g.name}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{task?.text || 'Aucune consigne disponible.'}</p>
        </div>

        <div className="mt-4">
          <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setTexts({ ...texts, [current]: next })} />
        </div>
        <textarea key={current} ref={taRef} value={texts[current]} lang="fr" spellCheck="false"
          onChange={(e) => setTexts({ ...texts, [current]: e.target.value })}
          onPaste={(e) => { e.preventDefault(); toast.error('Le copier-coller est désactivé en mode examen'); }}
          className="input paper-textarea mt-3 p-6"
          placeholder={`Rédigez votre réponse (${g.min}–${g.max} mots)…`} data-testid={`task-textarea-${current}`} />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className={`flex items-center gap-1 text-sm font-medium ${words < g.min || words > g.max ? 'text-amber-600' : 'text-green-600'}`}>
            {(words < g.min || words > g.max) && <WarningCircle size={16} />}
            {words} mots <span className="text-gray-400">(min {g.min} · max {g.max})</span>
          </span>
          {current < 3 ? (
            <button className="btn-primary" onClick={() => setCurrent(current + 1)}>Tâche suivante →</button>
          ) : (
            <button className="btn-primary" onClick={() => submit(TOTAL - seconds)} data-testid="submit-exam-button">
              Terminer et corriger
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
