/* The ask: who you are, and the PDF in return.
 *
 * One component for both places the offer is made, the exit dialog and the
 * guide page's hero, because there is one endpoint behind it and one set of
 * rules about what is stored. When this lived inside the dialog, putting the
 * same form on a page meant a second copy of the submit, and a second copy
 * of a submit is where one of them quietly stops joining the country code to
 * the number.
 *
 * What it does NOT ask for is a password. The answers here make a real
 * account, without one — see _account_for_lead in the backend. Demanding a
 * password before somebody has seen the thing they came for is the field
 * that empties the form; the password is asked for later, the first time
 * they try to practise, with every one of these answers already filled in.
 *
 * The page asks for a French level as well, because it has the room and the
 * level decides which of the ten themes is worth pointing them at. The
 * dialog does not: it opens over a page somebody is leaving, and every extra
 * row there is one more reason to close it.
 */
import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useT } from '../i18n';
import {
  CAPTURED_KEY, LEAD_RESOURCE, lastSource, remember, startDownload,
} from '../lib/leads';

/* The levels as the form offers them. The value is what is stored, so it is
   kept short and ASCII; the label is what is read. */
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1/C2', 'not-sure'];

/* A labelled row on the page, and nothing at all in the dialog.
 *
 * Defined out here, not inside the component, and that is not a style
 * preference: a component declared in a render body is a NEW component type
 * on every render, so React throws the old tree away and mounts a fresh one.
 * The input it wraps was therefore remounted on every keystroke — losing
 * focus and its value after a single character, which is a form nobody can
 * fill in.
 */
function Field({ page, label, htmlFor, children }) {
  if (!page) return children;
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-bold text-gray-900">
        {label}
      </label>
      {children}
    </div>
  );
}


export default function LeadCaptureForm({
  onDone, className = '', ctaKey = 'lead.cta', variant = 'dialog',
}) {
  const t = useT();
  const page = variant === 'page';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', code: '+1', phone: '', level: '',
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      /* The two boxes are joined here rather than on the server, so what is
         stored is what somebody would read back to you off their phone. */
      const code = form.code.trim().startsWith('+')
        ? form.code.trim() : `+${form.code.trim()}`;
      const { data } = await api.post('/leads', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: `${code} ${form.phone.trim()}`.trim(),
        level: page ? form.level : '',
        resource: LEAD_RESOURCE,
        source: page ? 'guide_page' : lastSource(),
      });
      remember(CAPTURED_KEY);
      startDownload(data.url);
      if (onDone) {
        onDone({ url: data.url, community: data.community !== false,
                 account: data.account || 'none' });
      }
    } catch (err) {
      /* The values stay in the boxes. A lead form that clears itself on a
         failed submit is a lead that never arrives. */
      setError(errMsg(err, t('lead.fail')));
    } finally {
      setBusy(false);
    }
  };

  /* The dialog is short on height, so its boxes carry their own name as a
     placeholder. The page has room for a label above each, which is what
     stays readable once something has been typed. */
  const field = `w-full rounded-xl border border-violet-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-violet-200 ${page ? 'h-12' : 'py-2'}`;

  return (
    <form onSubmit={submit} className={`${page ? 'space-y-4' : 'space-y-2'} ${className}`}
      data-testid="lead-form">
      <Field page={page} label={t('lead.name')} htmlFor={`lead-${variant}-name`}>
        <input className={field} value={form.name} onChange={set('name')}
          id={`lead-${variant}-name`}
          name="name" autoComplete="given-name" required minLength={2} maxLength={120}
          placeholder={t(page ? 'lead.namePh' : 'lead.name')} aria-label={t('lead.name')} />
      </Field>
      <Field page={page} label={t('lead.email')} htmlFor={`lead-${variant}-email`}>
        <input className={field} value={form.email} onChange={set('email')}
          id={`lead-${variant}-email`}
          name="email" type="email" autoComplete="email" required maxLength={255}
          placeholder={t(page ? 'lead.emailPh' : 'lead.email')} aria-label={t('lead.email')} />
      </Field>
      {/* The country code has its own box because without one the number
          cannot be written to: most people type the national number they say
          out loud, and a WhatsApp invite needs the international one. Two
          boxes ask for it without anybody having to be told. */}
      <Field page={page} label={t('lead.phone')} htmlFor={`lead-${variant}-phone`}>
        <div className="grid grid-cols-[4.5rem_1fr] gap-2">
          {/* Escaped for `v`-mode: see the note on the registration form. An
              unescaped ( makes Chrome discard the pattern. */}
          <input className={`${field} text-center`} value={form.code} onChange={set('code')}
            name="code" inputMode="tel" required maxLength={5} pattern="\+?[0-9]{1,4}"
            aria-label={t('lead.code')} />
          <input className={field} value={form.phone} onChange={set('phone')}
            id={`lead-${variant}-phone`}
            name="phone" type="tel" autoComplete="tel-national" required
            minLength={6} maxLength={20} pattern="[0-9\(\)\.\-\s]{6,20}"
            placeholder={t('lead.phone')} aria-label={t('lead.phone')} />
        </div>
      </Field>
      {page && (
        <Field page={page} label={t('lead.level')} htmlFor={`lead-${variant}-level`}>
          <select className={field} value={form.level} onChange={set('level')}
            id={`lead-${variant}-level`} name="level" required
            aria-label={t('lead.level')} data-testid="lead-level">
            <option value="" disabled>{t('lead.levelPh')}</option>
            {LEVELS.map((v) => (
              <option key={v} value={v}>{v === 'not-sure' ? t('lead.levelUnsure') : v}</option>
            ))}
          </select>
        </Field>
      )}
      {error && <p className="text-xs font-semibold text-rose-600" data-testid="lead-error">{error}</p>}
      <button type="submit" disabled={busy}
        className={`btn-primary w-full !bg-gradient-to-r !from-primary !to-fuchsia-600 text-sm disabled:opacity-60 ${page ? '!py-3.5 text-[15px]' : '!py-2.5'}`}>
        {busy ? t('lead.sending') : t(ctaKey)}
      </button>
    </form>
  );
}
