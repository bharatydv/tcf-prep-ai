import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lightning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { BACKEND_URL } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AccentToolbar, AnalysisProgress, streamAnalysis } from '../components/shared';

export default function CheckWriting() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState('');
  const [label, setLabel] = useState(location.state?.label || '');
  const [stage, setStage] = useState(null);
  const taRef = useRef(null);

  const submit = async () => {
    if (!text.trim()) return toast.error('Collez votre texte d’abord !');
    setStage('parsing');
    await streamAnalysis(BACKEND_URL, { text, source: 'paste', label: label || null }, {
      onStage: setStage,
      onComplete: async (sub) => {
        await refreshUser();
        toast.success(`Analyse terminée — niveau ${sub.tcf_level}`);
        navigate(`/feedback/${sub.submission_id}`);
      },
      onError: (detail, status) => {
        setStage(null);
        toast.error(detail);
        if (status === 402) navigate('/pricing');
      },
    });
  };

  if (stage) return <main className="px-4 py-16"><AnalysisProgress current={stage} /></main>;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Check my writing</h1>
      <p className="mt-2 max-w-2xl text-gray-600">
        Paste any French text you wrote elsewhere — homework, an old essay, something a tutor corrected.
        It runs through the same AI grading, and every error joins your personal mistake history.
      </p>
      {user?.subscription_status !== 'premium' && (
        <span className="pill mt-3 bg-violet-50 text-primary">{user?.free_submissions_used} / 5 free attempts</span>
      )}
      <input className="input mt-6" placeholder="Label / topic (optional) — e.g. « Lettre de motivation »"
        value={label} onChange={(e) => setLabel(e.target.value)} data-testid="paste-label-input" />
      <div className="mt-3">
        <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setText(next)} />
      </div>
      <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} lang="fr"
        className="input paper-textarea mt-3 p-6 shadow-card" placeholder="Collez votre texte français ici…"
        data-testid="paste-textarea" />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-gray-500">{text.trim() ? text.trim().split(/\s+/).length : 0} mots</span>
        <button className="btn-primary" onClick={submit} data-testid="submit-paste-button">
          <Lightning size={18} weight="fill" /> Analyser
        </button>
      </div>
    </main>
  );
}
