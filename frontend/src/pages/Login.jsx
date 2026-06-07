import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EnvelopeSimple, Lock } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.ok) {
      toast.success(`Bienvenue, ${res.user.name} !`);
      navigate(res.user.role === 'admin' ? '/admin' : '/practice');
    } else {
      setError(res.error);
      toast.error(res.error);
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-65px)] items-center justify-center bg-gradient-to-br from-violet-50 via-white to-violet-100 px-4 py-12">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-gray-500">Log in to continue your TCF preparation.</p>
        {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="login-error">{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <EnvelopeSimple size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type="email" required placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} data-testid="email-input" />
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type="password" required placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} data-testid="password-input" />
          </div>
          <button className="btn-primary w-full" disabled={busy} data-testid="login-button">
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            Log in
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-600">
          No account yet? <Link to="/register" className="font-semibold text-primary">Start free</Link>
        </p>
      </div>
    </main>
  );
}
