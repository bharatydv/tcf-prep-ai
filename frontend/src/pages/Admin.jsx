import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api, errMsg, catColor } from '../lib/api';
import { useT } from '../i18n';
import { Seo } from '../lib/seo';

/* id drives the switch below; label is a translation key. */
const TABS = [
  { id: 'analytics', label: 'admin.tabAnalytics' },
  { id: 'users', label: 'admin.tabUsers' },
  { id: 'submissions', label: 'admin.tabSubmissions' },
  { id: 'prompts', label: 'admin.tabPrompts' },
  { id: 'questions', label: 'admin.tabQuestions' },
  { id: 'topics', label: 'admin.tabTopics' },
  { id: 'sim-prompts', label: 'admin.tabSimPrompts' },
  { id: 'blog', label: 'admin.tabBlog' },
  { id: 'providers', label: 'admin.tabProviders' },
];

export default function Admin() {
  const t = useT();
  const [tab, setTab] = useState('analytics');
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <Seo titleKey="seo.admin.title" path="/admin" noindex />
      <h1 className="text-3xl font-bold">{t('admin.title')}</h1>
      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === item.id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            data-testid={`admin-tab-${item.id}`}>
            {t(item.label)}
          </button>
        ))}
      </div>
      <div className="mt-8">
        {tab === 'analytics' && <Analytics />}
        {tab === 'users' && <Users />}
        {tab === 'submissions' && <Submissions />}
        {tab === 'prompts' && <Prompts />}
        {tab === 'questions' && <Questions />}
        {tab === 'topics' && <Topics />}
        {tab === 'sim-prompts' && <SimPrompts />}
        {tab === 'blog' && <Blog />}
        {tab === 'providers' && <AIProviders />}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ Analytics ---- */
function Analytics() {
  const t = useT();
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/admin/analytics').then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label={t('admin.totalUsers')} value={data.total_users} />
        <Stat label={t('admin.totalSubmissions')} value={data.total_submissions} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-heading font-semibold">{t('admin.errorBreakdown')}</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {Object.entries(data.error_breakdown).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="pill" style={{ background: catColor(k) }}>{t(`cat.${k}`)}</span>
                <span className="font-semibold">{v}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-6">
          <h2 className="font-heading font-semibold">{t('admin.topErrors')}</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
            {data.top_errors.map((e, i) => (
              <li key={i}><span className="text-red-600">{e.error}</span> <span className="text-gray-400">×{e.count}</span></li>
            ))}
            {!data.top_errors.length && <p className="text-gray-400">{t('admin.noErrors')}</p>}
          </ol>
        </section>
      </div>
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div className="card p-5"><p className="text-sm text-gray-500">{label}</p><p className="mt-1 font-heading text-3xl font-bold">{value}</p></div>
);
const Spinner = () => <div className="flex justify-center py-16"><div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" /></div>;

/* -------------------------------------------------------- AI Providers ---- */
const AI_LABELS = {
  transcribe_provider: 'admin.transcribeProvider',
  speaking_grader_provider: 'admin.speakingGrader',
  writing_grader_provider: 'admin.writingGrader',
};

function AIProviders() {
  const t = useT();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState(null);

  const load = useCallback(() => {
    api.get('/api/admin/ai-providers')
      .then((r) => { setData(r.data); setSel(r.data.current || {}); })
      .catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  /* A key can be present and still be rejected, out of credit, or pointed at a
     retired model. Only a live call tells them apart. */
  const runTests = async () => {
    setTesting(true);
    try {
      const { data: res } = await api.post('/api/admin/ai-providers/test');
      setTests(res.results);
      const all = Object.values(res.results);
      const ok = all.filter((r) => r.ok).length;
      const msg = t('admin.testDone', { ok, total: all.length });
      if (ok === all.length) toast.success(msg); else toast.error(msg);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/admin/ai-providers', sel);
      toast.success(t('admin.aiUpdated'));
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  if (!data) return <Spinner />;
  const dirty = Object.keys(sel).some((k) => sel[k] !== data.current[k]);

  return (
    <div className="space-y-6">
      <section className="card space-y-5 p-6">
        <div>
          <h2 className="font-heading font-semibold">{t('admin.providers')}</h2>
          <p className="mt-1 text-sm text-gray-500">
{t('admin.aiHint')}</p>
        </div>

        {Object.keys(data.options).map((key) => (
          <div key={key}>
            <label className="block text-sm font-semibold text-gray-800">{AI_LABELS[key] ? t(AI_LABELS[key]) : key}</label>
            <select
              value={sel[key] || ''}
              onChange={(e) => setSel((s) => ({ ...s, [key]: e.target.value }))}
              className="input mt-2 max-w-md"
              data-testid={`ai-select-${key}`}>
              {data.options[key].map((p) => (
                <option key={p} value={p} disabled={!data.keys_present[p]}>
                  {p}{!data.keys_present[p] ? t('admin.noApiKey') : ''}{p === data.env_defaults[key] ? t('admin.defaultSuffix') : ''}
                </option>
              ))}
            </select>
            {sel[key] && !data.keys_present[sel[key]] && (
              <p className="mt-1 text-sm font-semibold text-red-600">{t('admin.noKeyWarning', { provider: sel[key] })}</p>
            )}
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={!dirty || saving} className="btn-primary disabled:opacity-50" data-testid="ai-save">
            {saving ? t('admin.saving') : t('admin.saveChanges')}
          </button>
          {dirty && <span className="text-sm text-amber-600">{t('admin.unsaved')}</span>}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-heading font-semibold">{t('admin.keysAvailable')}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.keys(data.keys_present).map((p) => (
            <span key={p} className={`pill ${data.keys_present[p] ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {p} {data.keys_present[p] ? '✓' : '✗'}
            </span>
          ))}
        </div>
      </section>

      {/* A present key still fails if it is revoked, out of credit, or the
          model was retired. Only a live call distinguishes those. */}
      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading font-semibold">{t('admin.testResults')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('admin.testHint')}</p>
          </div>
          <button onClick={runTests} disabled={testing}
            className="btn-outline shrink-0 disabled:opacity-50" data-testid="ai-test">
            {testing ? t('admin.testing') : t('admin.testAll')}
          </button>
        </div>

        {(tests || Object.keys(data.last_errors || {}).length > 0) && (
          <div className="mt-4 space-y-2">
            {Object.entries(tests || {}).map(([p, r]) => (
              <div key={p} data-testid={`ai-test-${p}`}
                className={`rounded-xl border p-3 text-sm ${r.ok ? 'border-green-200 bg-green-50/60' : 'border-red-200 bg-red-50/60'}`}>
                <p className="font-semibold text-gray-900">
                  {r.ok ? '✓' : '✗'} {p}
                  <span className="ml-2 font-mono text-xs font-normal text-gray-500">{r.model}</span>
                </p>
                {!r.ok && <p className="mt-1 break-words text-xs text-red-700">{r.error}</p>}
              </div>
            ))}
            {!tests && Object.entries(data.last_errors || {}).map(([p, err]) => (
              <div key={p} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                <p className="font-semibold text-gray-900">{p}</p>
                <p className="mt-1 break-words text-xs text-amber-800">{t('admin.lastError', { error: err })}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Users ---- */
function Users() {
  const t = useT();
  const [users, setUsers] = useState(null);
  useEffect(() => { api.get('/api/admin/users').then((r) => setUsers(r.data.users)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!users) return <Spinner />;
  return (
    <section className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>{['admin.thName', 'admin.thEmail', 'admin.thRole', 'admin.thPlan', 'admin.thUsed', 'admin.thStreak', 'admin.thJoined'].map((k) => <th key={k} className="px-5 py-3">{t(k)}</th>)}</tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.user_id} className="border-t border-gray-100">
              <td className="px-5 py-3 font-medium">{u.name}</td>
              <td className="px-5 py-3">{u.email}</td>
              <td className="px-5 py-3">{u.role === 'admin' ? <span className="pill bg-purple-50 text-purple-700">admin</span> : 'user'}</td>
              <td className="px-5 py-3">{u.subscription_status}</td>
              <td className="px-5 py-3">{u.free_submissions_used}</td>
              <td className="px-5 py-3">{u.current_streak ?? 0}</td>
              <td className="px-5 py-3">{u.created_at?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ----------------------------------------------------------- Submissions ---- */
function Submissions() {
  const t = useT();
  const [subs, setSubs] = useState(null);
  useEffect(() => { api.get('/api/admin/submissions').then((r) => setSubs(r.data.submissions)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!subs) return <Spinner />;
  return (
    <section className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>{['admin.thDate', 'admin.thUser', 'admin.thSource', 'admin.thLevel', 'admin.thScore', 'admin.thErrors', 'admin.thExcerpt'].map((k) => <th key={k} className="px-5 py-3">{t(k)}</th>)}</tr>
        </thead>
        <tbody>
          {subs.map((s) => (
            <tr key={s.submission_id} className="border-t border-gray-100 align-top">
              <td className="px-5 py-3 whitespace-nowrap">{s.created_at?.slice(0, 10)}</td>
              <td className="px-5 py-3 font-mono text-xs">{s.user_id}</td>
              <td className="px-5 py-3">{s.source || 'practice'}</td>
              <td className="px-5 py-3 font-semibold">{s.tcf_level}</td>
              <td className="px-5 py-3">{s.overall_score}</td>
              <td className="px-5 py-3">{s.errors?.length ?? 0}</td>
              <td className="max-w-xs px-5 py-3 text-gray-500">{(s.original_text || '').slice(0, 80)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------------------------------------------------- generic CRUD pieces ---- */
function useCrud(listUrl, key) {
  const [items, setItems] = useState(null);
  const load = useCallback(() => {
    api.get(listUrl).then((r) => setItems(r.data[key])).catch((e) => toast.error(errMsg(e)));
  }, [listUrl, key]);
  useEffect(load, [load]);
  return [items, load];
}

function Field({ label, children }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-gray-600">{label}</span>{children}</label>;
}

/* -------------------------------------------------------------- Prompts ---- */
function Prompts() {
  const t = useT();
  const [items, load] = useCrud('/api/prompts', 'prompts');
  const empty = { title: '', description: '', category: 'general', level: 'C1' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    try {
      if (editing) await api.put(`/api/admin/prompts/${editing}`, form);
      else await api.post('/api/admin/prompts', form);
      toast.success(t('admin.saved')); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/prompts/${id}`); toast.success(t('admin.deactivated')); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? t('admin.editPrompt') : t('admin.newPrompt')}</h2>
        <Field label={t('admin.titleField')}><input className="input" value={form.title} onChange={set('title')} data-testid="prompt-title-input" /></Field>
        <Field label={t('admin.description')}><textarea className="input min-h-[100px]" value={form.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('admin.category')}><input className="input" value={form.category} onChange={set('category')} /></Field>
          <Field label={t('admin.level')}><input className="input" value={form.level} onChange={set('level')} /></Field>
        </div>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save} data-testid="save-prompt-button">{editing ? t('admin.update') : t('admin.create')}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>{t('admin.cancel')}</button>}
        </div>
      </section>
      <section className="space-y-3">
        {items.map((p) => (
          <div key={p.prompt_id} className="card flex items-start justify-between gap-4 p-5">
            <div>
              <p className="font-semibold">{p.title}</p>
              <p className="text-xs text-gray-500">{p.category} · {p.level}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => { setEditing(p.prompt_id); setForm({ title: p.title, description: p.description, category: p.category, level: p.level }); }}>{t('admin.edit')}</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(p.prompt_id)}>{t('admin.delete')}</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- Questions ---- */
function Questions() {
  const t = useT();
  const [examType, setExamType] = useState('reading-comprehension');
  const [items, setItems] = useState(null);
  const load = useCallback(() => {
    api.get(`/api/exam/questions/${examType}`).then((r) => setItems(r.data.questions)).catch((e) => toast.error(errMsg(e)));
  }, [examType]);
  useEffect(load, [load]);

  const empty = { text: '', question: '', a: '', b: '', c: '', d: '', correct_answer: 'a' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const payload = {
      exam_type: examType, text: form.text, question: form.question,
      options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: form[id] })),
      correct_answer: form.correct_answer,
    };
    try {
      if (editing) await api.put(`/api/admin/exam/questions/${editing}`, payload);
      else await api.post('/api/admin/exam/questions', payload);
      toast.success(t('admin.saved')); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/exam/questions/${id}`); toast.success(t('admin.deactivated')); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['reading-comprehension', 'oral-comprehension'].map((type) => (
          <button key={type} onClick={() => { setExamType(type); setEditing(null); setForm(empty); }}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${examType === type ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
            {type === 'reading-comprehension' ? t('admin.reading') : t('admin.listening')}
          </button>
        ))}
      </div>
      {!items ? <Spinner /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card space-y-4 p-6">
            <h2 className="font-heading font-semibold">{editing ? t('admin.editQuestion') : t('admin.newQuestion')}</h2>
            <Field label={t('admin.passage')}><textarea className="input min-h-[90px]" value={form.text} onChange={set('text')} /></Field>
            <Field label={t('admin.question')}><input className="input" value={form.question} onChange={set('question')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              {['a', 'b', 'c', 'd'].map((id) => (
                <Field key={id} label={t('admin.option', { id: id.toUpperCase() })}><input className="input" value={form[id]} onChange={set(id)} /></Field>
              ))}
            </div>
            <Field label={t('admin.correctAnswer')}>
              <select className="input" value={form.correct_answer} onChange={set('correct_answer')}>
                {['a', 'b', 'c', 'd'].map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
              </select>
            </Field>
            <div className="flex gap-3">
              <button className="btn-primary" onClick={save}>{editing ? t('admin.update') : t('admin.create')}</button>
              {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>{t('admin.cancel')}</button>}
            </div>
          </section>
          <section className="space-y-3">
            {items.map((q) => (
              <div key={q.question_id} className="card flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-medium">{q.question}</p>
                  <p className="mt-1 text-xs text-gray-500">{t('admin.questionAnswer', { answer: q.correct_answer?.toUpperCase() })}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => {
                    setEditing(q.question_id);
                    const o = Object.fromEntries((q.options || []).map((x) => [x.id, x.text]));
                    setForm({ text: q.text, question: q.question, a: o.a || '', b: o.b || '', c: o.c || '', d: o.d || '', correct_answer: q.correct_answer });
                  }}>{t('admin.edit')}</button>
                  <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(q.question_id)}>{t('admin.delete')}</button>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- RecentTopics ---- */
function Topics() {
  const t = useT();
  const [items, load] = useCrud('/api/admin/recent-topics', 'topics');
  const empty = { title: '', task_type: 1, topic_text: '', model_answer: '', target_level: 'B2', month_label: '' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'task_type' ? Number(e.target.value) : e.target.value });

  const save = async () => {
    try {
      if (editing) await api.put(`/api/admin/recent-topics/${editing}`, form);
      else await api.post('/api/admin/recent-topics', form);
      toast.success(t('admin.saved')); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/recent-topics/${id}`); toast.success(t('admin.deactivated')); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? t('admin.editTopic') : t('admin.newTopic')}</h2>
        <Field label={t('admin.titleField')}><input className="input" value={form.title} onChange={set('title')} data-testid="topic-title-input" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('admin.task')}>
            <select className="input" value={form.task_type} onChange={set('task_type')}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>Tâche {n}</option>)}
            </select>
          </Field>
          <Field label={t('admin.targetLevel')}><input className="input" value={form.target_level} onChange={set('target_level')} /></Field>
          <Field label={t('admin.monthLabel')}><input className="input" placeholder={t('admin.monthPlaceholder')} value={form.month_label} onChange={set('month_label')} /></Field>
        </div>
        <Field label={t('admin.consigneTopic')}><textarea className="input min-h-[90px]" value={form.topic_text} onChange={set('topic_text')} /></Field>
        <Field label={t('admin.modelAnswer')}><textarea className="input min-h-[180px]" value={form.model_answer} onChange={set('model_answer')} data-testid="model-answer-textarea" /></Field>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save} data-testid="save-topic-button">{editing ? t('admin.update') : t('admin.create')}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>{t('admin.cancel')}</button>}
        </div>
      </section>
      <section className="space-y-3">
        {/* the map variable used to be named `t`, shadowing the translator */}
        {items.map((topic) => (
          <div key={topic.topic_id} className={`card flex items-start justify-between gap-4 p-5 ${topic.is_active ? '' : 'opacity-50'}`}>
            <div>
              <p className="font-semibold">{topic.title}</p>
              <p className="text-xs text-gray-500">Tâche {topic.task_type} · {topic.target_level} · {topic.month_label || '—'} {topic.is_active ? '' : t('admin.inactiveSuffix')}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => {
                setEditing(topic.topic_id);
                setForm({ title: topic.title, task_type: topic.task_type, topic_text: topic.topic_text, model_answer: topic.model_answer || '', target_level: topic.target_level, month_label: topic.month_label || '' });
              }}>{t('admin.edit')}</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(topic.topic_id)}>{t('admin.delete')}</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-gray-400">{t('admin.noTopics')}</p>}
      </section>
    </div>
  );
}

/* --------------------------------------------------------- SimulatorPrompts ---- */
function SimPrompts() {
  const t = useT();
  const [items, load] = useCrud('/api/admin/simulator-prompts', 'prompts');
  const empty = { task_type: 1, text: '' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const save = async () => {
    try {
      if (editing) await api.put(`/api/admin/simulator-prompts/${editing}`, form);
      else await api.post('/api/admin/simulator-prompts', form);
      toast.success(t('admin.saved')); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/simulator-prompts/${id}`); toast.success(t('admin.deactivated')); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? t('admin.editSimPrompt') : t('admin.newSimPrompt')}</h2>
        <Field label={t('admin.task')}>
          <select className="input" value={form.task_type} onChange={(e) => setForm({ ...form, task_type: Number(e.target.value) })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>Tâche {n}</option>)}
          </select>
        </Field>
        <Field label={t('admin.consigne')}><textarea className="input min-h-[120px]" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save}>{editing ? t('admin.update') : t('admin.create')}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>{t('admin.cancel')}</button>}
        </div>
      </section>
      <section className="space-y-3">
        {items.map((p) => (
          <div key={p.sim_prompt_id} className={`card flex items-start justify-between gap-4 p-5 ${p.is_active ? '' : 'opacity-50'}`}>
            <div>
              <span className="pill bg-violet-50 text-primary">Tâche {p.task_type}</span>
              <p className="mt-2 text-sm text-gray-700">{p.text}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => { setEditing(p.sim_prompt_id); setForm({ task_type: p.task_type, text: p.text }); }}>{t('admin.edit')}</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(p.sim_prompt_id)}>{t('admin.delete')}</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Blog ---- */
function Blog() {
  const t = useT();
  const [items, load] = useCrud('/api/admin/blog', 'posts');
  const empty = { title: '', excerpt: '', content: '', cover_image: '', meta_description: '', author: 'MonFrancais', tags: '', is_published: true };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const payload = {
      title: form.title,
      excerpt: form.excerpt,
      content: form.content,
      cover_image: form.cover_image,
      meta_description: form.meta_description,
      author: form.author,
      tags: form.tags ? form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      is_published: form.is_published,
    };
    try {
      if (editing) await api.put(`/api/admin/blog/${editing}`, payload);
      else await api.post('/api/admin/blog', payload);
      toast.success(t('admin.saved')); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/blog/${id}`); toast.success(t('admin.deleted')); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? t('admin.editPost') : t('admin.newPost')}</h2>
        <Field label={t('admin.titleField')}><input className="input" value={form.title} onChange={set('title')} data-testid="blog-title-input" /></Field>
        <Field label={t('admin.excerpt')}><textarea className="input min-h-[70px]" value={form.excerpt} onChange={set('excerpt')} /></Field>
        <Field label={t('admin.content')}><textarea className="input min-h-[220px] font-mono text-xs" value={form.content} onChange={set('content')} data-testid="blog-content-textarea" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.author')}><input className="input" value={form.author} onChange={set('author')} /></Field>
          <Field label={t('admin.tags')}><input className="input" placeholder={t('admin.tagsPlaceholder')} value={form.tags} onChange={set('tags')} /></Field>
        </div>
        <Field label={t('admin.coverImage')}><input className="input" value={form.cover_image} onChange={set('cover_image')} /></Field>
        <Field label={t('admin.metaDescription')}><input className="input" value={form.meta_description} onChange={set('meta_description')} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
          <span className="font-medium text-gray-600">{t('admin.published')}</span>
        </label>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save} data-testid="save-blog-button">{editing ? t('admin.update') : t('admin.create')}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>{t('admin.cancel')}</button>}
        </div>
      </section>
      <section className="space-y-3">
        {items.map((p) => (
          <div key={p.post_id} className={`card flex items-start justify-between gap-4 p-5 ${p.is_published ? '' : 'opacity-50'}`}>
            <div>
              <p className="font-semibold">{p.title}</p>
              <p className="text-xs text-gray-500">/{p.slug} · {p.author} {p.is_published ? '' : t('admin.draftSuffix')}</p>
              {p.tags?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.tags.map((tag) => <span key={tag} className="pill bg-violet-50 text-xs text-primary">{tag}</span>)}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => {
                setEditing(p.post_id);
                setForm({
                  title: p.title, excerpt: p.excerpt || '', content: p.content || '',
                  cover_image: p.cover_image || '', meta_description: p.meta_description || '',
                  author: p.author || 'MonFrancais',
                  tags: (p.tags || []).join(', '),
                  is_published: p.is_published,
                });
              }}>{t('admin.edit')}</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(p.post_id)}>{t('admin.delete')}</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-gray-400">{t('admin.noPosts')}</p>}
      </section>
    </div>
  );
}