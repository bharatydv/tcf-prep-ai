import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lightning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { BACKEND_URL } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';
import { AccentToolbar, AnalysisProgress, BackLink, streamAnalysis } from '../components/shared';

export default function CheckWriting() {
  const { user, refreshUser } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState('');
  const [label, setLabel] = useState(location.state?.label || '');
  const [stage, setStage] = useState(null);
  const taRef = useRef(null);

  const submit = async () => {
    if (!text.trim()) return toast.error(t('check.pasteFirst'));
    // The progress dialog now sits over the form rather than replacing it,
    // so the button behind it still exists and can be reached from the
    // keyboard. A second submit would spend a second credit.
    if (stage) return;
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
        // 402 is handled by the paywall, which keeps the learner on the page
        // with their text intact instead of navigating to /pricing.
      },
    });
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {stage && <AnalysisProgress current={stage} />}
      <Seo titleKey="seo.check.title" path="/check-writing" noindex />
      <BackLink />
      <h1 className="text-3xl font-bold">{t('check.title')}</h1>
      <p className="mt-2 max-w-2xl text-gray-600">
        {t('check.subtitle')}
      </p>
      {user?.subscription_status !== 'premium' && (
        <span className="pill mt-3 bg-violet-50 text-primary">{t('check.freeAttempts', { used: user?.free_submissions_used ?? 0, total: user?.free_trial_total ?? 6 })}</span>
      )}
      <input className="input mt-6" placeholder={t('check.labelPlaceholder')}
        value={label} onChange={(e) => setLabel(e.target.value)} data-testid="paste-label-input" />
      <div className="mt-3">
        <AccentToolbar textareaRef={taRef} onInsert={(_c, next) => setText(next)} />
      </div>
      <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} lang="fr"
        className="input paper-textarea mt-3 p-6 shadow-card" placeholder={t('check.textPlaceholder')}
        data-testid="paste-textarea" />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-gray-500">{text.trim() ? text.trim().split(/\s+/).length : 0} mots</span>
        <button className="btn-primary" onClick={submit} data-testid="submit-paste-button">
          <Lightning size={18} weight="fill" /> {t('check.analyse')}
        </button>
      </div>
    </main>
  );
}
