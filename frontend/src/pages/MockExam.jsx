import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, Headphones } from '@phosphor-icons/react';
import { api } from '../lib/api';

const TYPES = {
  'reading-comprehension': { label: 'Compréhension écrite', icon: BookOpen },
  'oral-comprehension': { label: 'Compréhension orale', icon: Headphones },
};

export default function MockExam() {
  const { examType } = useParams();
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);
  const meta = TYPES[examType];

  useEffect(() => {
    setQuestions(null); setAnswers({}); setDone(false);
    api.get(`/api/exam/questions/${examType}`).then(({ data }) => setQuestions(data.questions)).catch(() => setQuestions([]));
  }, [examType]);

  if (!meta) return <main className="px-4 py-20 text-center text-gray-600">Type d'examen inconnu.</main>;
  if (!questions) return <main className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></main>;

  const score = questions.filter((q) => answers[q.question_id] === q.correct_answer).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex gap-2">
        {Object.entries(TYPES).map(([key, t]) => (
          <Link key={key} to={`/exam/${key}`}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${key === examType ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <t.icon size={16} /> {t.label}
          </Link>
        ))}
      </div>
      <h1 className="mt-6 text-3xl font-bold">{meta.label}</h1>
      {examType === 'oral-comprehension' && <p className="mt-1 text-sm text-gray-500">Les transcriptions remplacent l'audio dans cette version d'entraînement.</p>}

      {done && (
        <div className="card mt-6 border-l-4 border-l-primary p-6" data-testid="exam-score">
          <p className="font-heading text-2xl font-bold">Score : {score} / {questions.length}</p>
          <p className="text-sm text-gray-600">Les bonnes réponses sont indiquées en vert ci-dessous.</p>
        </div>
      )}

      <div className="mt-6 space-y-6">
        {questions.map((q, i) => (
          <section key={q.question_id} className="card p-6" data-testid={`question-${i}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Question {i + 1}</p>
            <p className="mt-2 rounded-xl bg-gray-50 p-4 text-sm italic leading-relaxed text-gray-700">{q.text}</p>
            <p className="mt-3 font-medium">{q.question}</p>
            <div className="mt-3 space-y-2">
              {q.options.map((o) => {
                const picked = answers[q.question_id] === o.id;
                const showState = done && (o.id === q.correct_answer ? '!border-green-500 bg-green-50' : picked ? '!border-red-400 bg-red-50' : '');
                return (
                  <button key={o.id} disabled={done}
                    onClick={() => setAnswers({ ...answers, [q.question_id]: o.id })}
                    className={`block w-full rounded-xl border-2 px-4 py-2.5 text-left text-sm transition ${picked && !done ? 'border-primary bg-violet-50' : 'border-gray-200 hover:border-primary'} ${showState || ''}`}>
                    <strong className="mr-2 uppercase">{o.id}.</strong>{o.text}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!questions.length && <p className="py-10 text-center text-gray-400">Aucune question disponible — l'administrateur peut en ajouter.</p>}
      </div>

      {questions.length > 0 && !done && (
        <button className="btn-primary mt-8 w-full" onClick={() => setDone(true)}
          disabled={Object.keys(answers).length < questions.length} data-testid="finish-exam-button">
          Corriger ({Object.keys(answers).length}/{questions.length} répondues)
        </button>
      )}
      {done && <button className="btn-outline mt-4 w-full" onClick={() => { setAnswers({}); setDone(false); }}>Recommencer</button>}
    </main>
  );
}
