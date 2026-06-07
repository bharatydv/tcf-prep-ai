import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LockSimple, Eye, Lightning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg, BACKEND_URL } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AccentToolbar, AnalysisProgress, streamAnalysis } from '../components/shared';

const TASK_LABELS = { 1: 'Tâche 1 · Message', 2: 'Tâche 2 · Récit', 3: 'Tâche 3 · Argumentation' };

export default function RecentTopics() {
  const [topics, setTopics] = useState([]);
  const [task, setTask] = useState(0);
  const [month, setMonth] = useState('');

  useEffect(() => {
    api.get('/api/recent-topics', { params: task ? { task_type: task } : {} })
      .then(({ data }) => setTopics(data.topics)).catch(() => {});
  }, [task]);

  const months = [...new Set(topics.map((t) => t.month_label).filter(Boolean))];
  const shown = topics.filter((t) => !month || t.month_label === month);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Sujets récents du TCF Canada</h1>
      <p className="mt-2 max-w-2xl text-gray-600">
        Sujets d'expression écrite tombés récemment, avec corrigés modèles rédigés par nos professeurs.
        Essayez d'abord, comparez ensuite.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((t) => (
            <button key={t} onClick={() => setTask(t)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${task === t ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              data-testid={`filter-task-${t}`}>
              {t === 0 ? 'Toutes' : `Tâche ${t}`}
            </button>
          ))}
        </div>
        {months.length > 0 && (
          <select className="input !w-auto !py-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="month-filter">
            <option value="">Tous les mois</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <Link key={t.topic_id} to={`/recent-topics/${t.topic_id}`} className="card card-hover flex flex-col p-6" data-testid={`topic-${t.topic_id}`}>
            <div className="flex flex-wrap gap-2">
              <span className="pill bg-violet-50 text-primary">{TASK_LABELS[t.task_type] || `Tâche ${t.task_type}`}</span>
              {t.month_label && <span className="pill bg-gray-100 text-gray-600">{t.month_label}</span>}
              <span className="pill bg-green-50 text-green-700">{t.target_level}</span>
            </div>
            <h3 className="mt-3 font-heading text-lg font-semibold">{t.title}</h3>
            <p className="mt-2 flex-1 text-sm text-gray-600">{(t.topic_text || '').slice(0, 140)}…</p>
            <span className="mt-4 text-sm font-semibold text-primary">Voir le sujet →</span>
          </Link>
        ))}
        {!shown.length && <p className="col-span-full py-10 text-center text-gray-400">Aucun sujet pour ce filtre — l'administrateur peut en ajouter via le panneau admin.</p>}
      </div>
    </main>
  );
}

export function RecentTopicDetail() {
  const { topicId } = useParams();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState(null);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [stage, setStage] = useState(null);
  const [showModel, setShowModel] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [lastSubmission, setLastSubmission] = useState(null);
  const taRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    api.get(`/api/recent-topics/${topicId}`)
      .then(({ data }) => setTopic(data.topic))
      .catch((e) => setError(errMsg(e)));
  }, [topicId, user]);

  if (!user) {
    return (
      <main className="px-4 py-20 text-center">
        <p className="text-gray-600">Connectez-vous pour consulter les sujets et leurs corrigés modèles.</p>
        <Link to="/login" className="btn-primary mt-4 inline-flex">Se connecter</Link>
      </main>
    );
  }
  if (error) return <main className="px-4 py-20 text-center text-gray-600">{error}</main>;
  if (!topic) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  if (stage) return <main className="px-4 py-16"><AnalysisProgress current={stage} /></main>;

  const submit = async () => {
    if (!text.trim()) return toast.error('Écrivez votre réponse d’abord !');
    setStage('parsing');
    await streamAnalysis(BACKEND_URL, { text, source: 'practice', label: topic.title }, {
      onStage: setStage,
      onComplete: async (sub) => {
        await refreshUser();
        setStage(null); setWriting(false); setAttempted(true); setLastSubmission(sub);
        toast.success(`Analyse terminée — niveau ${sub.tcf_level}. Le corrigé modèle est maintenant débloqué !`);
      },
      onError: (detail, status) => {
        setStage(null); toast.error(detail);
        if (status === 402) navigate('/pricing');
      },
    });
  };

  const modelVisible = !topic.model_answer_locked && topic.model_answer && (attempted || showModel);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link to="/recent-topics" className="text-sm font-semibold text-primary">← Tous les sujets</Link>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="pill bg-violet-50 text-primary">{TASK_LABELS[topic.task_type]}</span>
        {topic.month_label && <span className="pill bg-gray-100 text-gray-600">{topic.month_label}</span>}
        <span className="pill bg-green-50 text-green-700">Niveau cible {topic.target_level}</span>
      </div>
      <h1 className="mt-3 text-3xl font-bold">{topic.title}</h1>

      <section className="card mt-6 p-6">
        <h2 className="font-heading font-semibold">Consigne</h2>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed text-gray-700">{topic.topic_text}</p>
      </section>

      {writing ? (
        <section className="mt-6">
          <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setText(next)} />
          <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} lang="fr"
            className="input paper-textarea mt-3 p-6 shadow-card" placeholder="Rédigez votre réponse…" data-testid="topic-textarea" />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">{text.trim() ? text.trim().split(/\s+/).length : 0} mots</span>
            <div className="flex gap-3">
              <button className="btn-outline" onClick={() => setWriting(false)}>Annuler</button>
              <button className="btn-primary" onClick={submit} data-testid="submit-topic-button"><Lightning size={18} weight="fill" /> Analyser</button>
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => setWriting(true)} data-testid="write-answer-button">Écrire ma réponse</button>
          {lastSubmission && (
            <Link to={`/feedback/${lastSubmission.submission_id}`} className="btn-outline">Voir ma correction</Link>
          )}
          {!attempted && !topic.model_answer_locked && (
            <button className="btn-outline" onClick={() => setShowModel(!showModel)} data-testid="show-model-toggle">
              <Eye size={18} /> {showModel ? 'Masquer le corrigé' : 'Afficher le corrigé — je veux juste lire'}
            </button>
          )}
        </div>
      )}

      {topic.model_answer_locked ? (
        <section className="card mt-6 border-amber-200 bg-amber-50/60 p-8 text-center">
          <LockSimple size={28} className="mx-auto text-amber-500" />
          <h2 className="mt-2 font-heading font-semibold">Corrigé modèle verrouillé</h2>
          <p className="mt-1 text-sm text-gray-600">Vous avez utilisé vos 3 corrigés gratuits ce mois-ci. Passez en premium pour un accès illimité.</p>
          <Link to="/pricing" className="btn-primary mt-4 inline-flex">Voir les formules</Link>
        </section>
      ) : modelVisible ? (
        <section className="card mt-6 border-green-200 p-6" data-testid="model-answer">
          <h2 className="font-heading font-semibold text-green-700">Corrigé modèle ({topic.target_level})</h2>
          <p className="mt-3 whitespace-pre-wrap leading-relaxed text-gray-800">{topic.model_answer}</p>
        </section>
      ) : (
        <p className="mt-6 text-sm text-gray-500">💡 Le corrigé modèle s'affiche après l'envoi de votre propre réponse (ou via le bouton « je veux juste lire »).</p>
      )}
    </main>
  );
}
