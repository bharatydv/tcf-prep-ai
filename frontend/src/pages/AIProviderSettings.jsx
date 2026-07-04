import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';

/*
  Drop-in Admin section to switch AI providers per task.
  Usage: <AIProviderSettings /> inside your Admin page.
  Keys live in the server .env; this only selects which provider is active.
*/

const LABELS = {
  transcribe_provider: 'Transcription (audio → text)',
  speaking_grader_provider: 'Speaking analysis',
  writing_grader_provider: 'Writing analysis',
};

const HINTS = {
  transcribe_provider: 'Converts recorded audio into text. (Groq = fastest)',
  speaking_grader_provider: 'Analyzes the spoken answer and gives feedback.',
  writing_grader_provider: 'Analyzes written text and gives feedback.',
};

export default function AIProviderSettings() {
  const [data, setData] = useState(null);
  const [selection, setSelection] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/admin/ai-providers')
      .then(({ data }) => {
        setData(data);
        setSelection(data.current || {});
      })
      .catch(() => toast.error('Could not load AI provider settings.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = () => {
    setSaving(true);
    api.post('/api/admin/ai-providers', selection)
      .then(() => { toast.success('AI providers updated.'); load(); })
      .catch((e) => toast.error(e?.response?.data?.detail || 'Save failed.'))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-violet-100 bg-white p-6 shadow-soft">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 h-10 w-full animate-pulse rounded bg-gray-200" />
      </div>
    );
  }
  if (!data) return null;

  const dirty = Object.keys(selection).some(
    (k) => selection[k] !== data.current[k]);

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-6 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-extrabold text-gray-900">AI Providers</h2>
          <p className="mt-1 text-sm text-gray-500">
            Choose which AI service handles each task. API keys are configured on the server.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {Object.keys(data.options).map((key) => {
          const opts = data.options[key];
          return (
            <div key={key}>
              <label className="text-sm font-bold text-gray-800">{LABELS[key] || key}</label>
              <p className="text-xs text-gray-400">{HINTS[key]}</p>
              <select
                value={selection[key] || ''}
                onChange={(e) => setSelection((s) => ({ ...s, [key]: e.target.value }))}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {opts.map((p) => {
                  const hasKey = data.keys_present[p];
                  return (
                    <option key={p} value={p} disabled={!hasKey}>
                      {p}{!hasKey ? ' — no API key set' : ''}
                      {p === data.env_defaults[key] ? '  (default)' : ''}
                    </option>
                  );
                })}
              </select>
              {selection[key] && !data.keys_present[selection[key]] && (
                <p className="mt-1 text-xs font-semibold text-red-500">
                  ⚠ No API key for “{selection[key]}” in the server .env — analysis will fail.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={save} disabled={!dirty || saving}
          className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>

      <div className="mt-5 rounded-xl bg-violet-50/50 p-3 text-xs text-gray-500">
        <p className="font-semibold text-gray-700">Available keys on server:</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Object.keys(data.keys_present).map((p) => (
            <span key={p}
              className={`rounded-full px-2.5 py-1 font-medium ${
                data.keys_present[p] ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
              }`}>
              {p} {data.keys_present[p] ? '✓' : '✗'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
