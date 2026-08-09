import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EnvelopeSimple, Lock, User } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';

export default function Register() {
  const { register } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError(t('auth.tooShort'));
    if (form.password !== form.confirm) return setError(t('auth.mismatch'));
    setBusy(true);
    const res = await register(form.name, form.email, form.password);
    setBusy(false);
    if (res.ok) {
      toast.success(t('auth.created'));
      navigate(res.user.role === 'admin' ? '/admin' : '/practice');
    } else { setError(res.error); toast.error(res.error); }
  };

  return (
    <main className="flex min-h-[calc(100vh-65px)] items-center justify-center bg-gradient-to-br from-violet-50 via-white to-violet-100 px-4 py-12">
      <div className="card w-full max-w-md p-8">
        <span className="pill mb-4 bg-green-50 text-green-700" data-testid="free-attempts-badge">{t('auth.freeBadge')}</span>
        <h1 className="text-2xl font-bold">{t('auth.createAccount')}</h1>
        {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="register-error">{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="relative">
            <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" required placeholder={t('auth.fullName')} value={form.name} onChange={set('name')} data-testid="name-input" />
          </div>
          <div className="relative">
            <EnvelopeSimple size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type="email" required placeholder={t('auth.email')} value={form.email} onChange={set('email')} data-testid="email-input" />
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type="password" required placeholder={t('auth.passwordHint')} value={form.password} onChange={set('password')} data-testid="password-input" />
          </div>
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-11" type="password" required placeholder={t('auth.confirmPassword')} value={form.confirm} onChange={set('confirm')} data-testid="confirm-password-input" />
          </div>
          <button className="btn-primary w-full" disabled={busy} data-testid="register-button">
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {t('auth.createButton')}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-600">
          {t('auth.alreadyRegistered')} <Link to="/login" className="font-semibold text-primary">{t('auth.loginButton')}</Link>
        </p>
      </div>
    </main>
  );
}
