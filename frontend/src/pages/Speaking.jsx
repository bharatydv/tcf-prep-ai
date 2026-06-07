import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Microphone, Stop } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function Speaking() {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const toggle = async () => {
    if (!user) return toast.error('Connectez-vous pour utiliser le Speaking Lab');
    if (!recording) {
      setRecording(true); setMessage(''); setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      clearInterval(timer.current);
      setRecording(false); setBusy(true);
      try {
        const { data } = await api.post('/api/speaking/analyze', { duration_seconds: seconds });
        setMessage(data.message);
      } catch (e) { toast.error(errMsg(e)); }
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-14 text-center">
      <h1 className="text-3xl font-bold">Speaking Lab</h1>
      <p className="mt-2 text-gray-600">Entraînez-vous à l'expression orale du TCF Canada : enregistrez-vous en répondant à un sujet d'actualité.</p>

      <div className="card mx-auto mt-10 max-w-md p-10">
        <p className="mb-6 text-sm italic text-gray-600">« Certains pensent que les voyages forment la jeunesse, d'autres préfèrent découvrir le monde à travers les livres et Internet. Qu'en pensez-vous ? »</p>
        <button onClick={toggle} disabled={busy}
          className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full text-white transition ${recording ? 'recording bg-red-500' : 'bg-primary hover:bg-primary-light'}`}
          data-testid="record-button" aria-label={recording ? 'Stop recording' : 'Start recording'}>
          {recording ? <Stop size={36} weight="fill" /> : <Microphone size={36} weight="fill" />}
        </button>
        <p className="mt-4 font-heading text-xl font-semibold">
          {busy ? 'Analyse…' : recording ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : 'Appuyez pour enregistrer'}
        </p>
      </div>

      {message && (
        <div className="card mx-auto mt-6 max-w-md border-violet-200 bg-violet-50/50 p-6 text-sm text-gray-700" data-testid="speaking-message">
          {message}
          <div className="mt-4"><Link to="/practice" className="btn-primary !py-2 text-sm">Aller à l'Expression Écrite</Link></div>
        </div>
      )}
    </main>
  );
}
