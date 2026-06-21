import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api, errMsg, CATEGORY_META } from '../lib/api';

const TABS = ['Analytics', 'Users', 'Submissions', 'Prompts', 'Exam Questions', 'Recent Topics', 'Simulator Prompts', 'Blog'];

export default function Admin() {
  const [tab, setTab] = useState('Analytics');
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold">Admin Panel</h1>
      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === t ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            data-testid={`admin-tab-${t.toLowerCase().replace(/ /g, '-')}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-8">
        {tab === 'Analytics' && <Analytics />}
        {tab === 'Users' && <Users />}
        {tab === 'Submissions' && <Submissions />}
        {tab === 'Prompts' && <Prompts />}
        {tab === 'Exam Questions' && <Questions />}
        {tab === 'Recent Topics' && <Topics />}
        {tab === 'Simulator Prompts' && <SimPrompts />}
        {tab === 'Blog' && <Blog />}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ Analytics ---- */
function Analytics() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/admin/analytics').then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Total users" value={data.total_users} />
        <Stat label="Total submissions" value={data.total_submissions} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-heading font-semibold">Global error breakdown</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {Object.entries(data.error_breakdown).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="pill" style={{ background: CATEGORY_META[k]?.color }}>{CATEGORY_META[k]?.label || k}</span>
                <span className="font-semibold">{v}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-6">
          <h2 className="font-heading font-semibold">Top 10 exact errors</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
            {data.top_errors.map((e, i) => (
              <li key={i}><span className="text-red-600">{e.error}</span> <span className="text-gray-400">×{e.count}</span></li>
            ))}
            {!data.top_errors.length && <p className="text-gray-400">No errors recorded yet.</p>}
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

/* ---------------------------------------------------------------- Users ---- */
function Users() {
  const [users, setUsers] = useState(null);
  useEffect(() => { api.get('/api/admin/users').then((r) => setUsers(r.data.users)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!users) return <Spinner />;
  return (
    <section className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Used</th><th className="px-5 py-3">Streak</th><th className="px-5 py-3">Joined</th></tr>
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
  const [subs, setSubs] = useState(null);
  useEffect(() => { api.get('/api/admin/submissions').then((r) => setSubs(r.data.submissions)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!subs) return <Spinner />;
  return (
    <section className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">User</th><th className="px-5 py-3">Source</th><th className="px-5 py-3">Level</th><th className="px-5 py-3">Score</th><th className="px-5 py-3">Errors</th><th className="px-5 py-3">Excerpt</th></tr>
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
  const [items, load] = useCrud('/api/prompts', 'prompts');
  const empty = { title: '', description: '', category: 'general', level: 'C1' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    try {
      if (editing) await api.put(`/api/admin/prompts/${editing}`, form);
      else await api.post('/api/admin/prompts', form);
      toast.success('Saved'); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/prompts/${id}`); toast.success('Deactivated'); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? 'Edit prompt' : 'New writing prompt'}</h2>
        <Field label="Title"><input className="input" value={form.title} onChange={set('title')} data-testid="prompt-title-input" /></Field>
        <Field label="Description"><textarea className="input min-h-[100px]" value={form.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category"><input className="input" value={form.category} onChange={set('category')} /></Field>
          <Field label="Level"><input className="input" value={form.level} onChange={set('level')} /></Field>
        </div>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save} data-testid="save-prompt-button">{editing ? 'Update' : 'Create'}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
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
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => { setEditing(p.prompt_id); setForm({ title: p.title, description: p.description, category: p.category, level: p.level }); }}>Edit</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(p.prompt_id)}>Delete</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- Questions ---- */
function Questions() {
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
      toast.success('Saved'); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/exam/questions/${id}`); toast.success('Deactivated'); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['reading-comprehension', 'oral-comprehension'].map((t) => (
          <button key={t} onClick={() => { setExamType(t); setEditing(null); setForm(empty); }}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${examType === t ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
            {t === 'reading-comprehension' ? 'Reading' : 'Listening'}
          </button>
        ))}
      </div>
      {!items ? <Spinner /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card space-y-4 p-6">
            <h2 className="font-heading font-semibold">{editing ? 'Edit question' : 'New question'}</h2>
            <Field label="Passage / transcript"><textarea className="input min-h-[90px]" value={form.text} onChange={set('text')} /></Field>
            <Field label="Question"><input className="input" value={form.question} onChange={set('question')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              {['a', 'b', 'c', 'd'].map((id) => (
                <Field key={id} label={`Option ${id.toUpperCase()}`}><input className="input" value={form[id]} onChange={set(id)} /></Field>
              ))}
            </div>
            <Field label="Correct answer">
              <select className="input" value={form.correct_answer} onChange={set('correct_answer')}>
                {['a', 'b', 'c', 'd'].map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
              </select>
            </Field>
            <div className="flex gap-3">
              <button className="btn-primary" onClick={save}>{editing ? 'Update' : 'Create'}</button>
              {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
            </div>
          </section>
          <section className="space-y-3">
            {items.map((q) => (
              <div key={q.question_id} className="card flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-medium">{q.question}</p>
                  <p className="mt-1 text-xs text-gray-500">Answer: {q.correct_answer?.toUpperCase()}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => {
                    setEditing(q.question_id);
                    const o = Object.fromEntries((q.options || []).map((x) => [x.id, x.text]));
                    setForm({ text: q.text, question: q.question, a: o.a || '', b: o.b || '', c: o.c || '', d: o.d || '', correct_answer: q.correct_answer });
                  }}>Edit</button>
                  <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(q.question_id)}>Delete</button>
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
  const [items, load] = useCrud('/api/admin/recent-topics', 'topics');
  const empty = { title: '', task_type: 1, topic_text: '', model_answer: '', target_level: 'B2', month_label: '' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'task_type' ? Number(e.target.value) : e.target.value });

  const save = async () => {
    try {
      if (editing) await api.put(`/api/admin/recent-topics/${editing}`, form);
      else await api.post('/api/admin/recent-topics', form);
      toast.success('Saved'); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/recent-topics/${id}`); toast.success('Deactivated'); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? 'Edit topic' : 'New recent topic'}</h2>
        <Field label="Title"><input className="input" value={form.title} onChange={set('title')} data-testid="topic-title-input" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Task">
            <select className="input" value={form.task_type} onChange={set('task_type')}>
              {[1, 2, 3].map((t) => <option key={t} value={t}>Tâche {t}</option>)}
            </select>
          </Field>
          <Field label="Target level"><input className="input" value={form.target_level} onChange={set('target_level')} /></Field>
          <Field label="Month label"><input className="input" placeholder="Janvier 2026" value={form.month_label} onChange={set('month_label')} /></Field>
        </div>
        <Field label="Consigne (topic text)"><textarea className="input min-h-[90px]" value={form.topic_text} onChange={set('topic_text')} /></Field>
        <Field label="Model answer"><textarea className="input min-h-[180px]" value={form.model_answer} onChange={set('model_answer')} data-testid="model-answer-textarea" /></Field>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save} data-testid="save-topic-button">{editing ? 'Update' : 'Create'}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
        </div>
      </section>
      <section className="space-y-3">
        {items.map((t) => (
          <div key={t.topic_id} className={`card flex items-start justify-between gap-4 p-5 ${t.is_active ? '' : 'opacity-50'}`}>
            <div>
              <p className="font-semibold">{t.title}</p>
              <p className="text-xs text-gray-500">Tâche {t.task_type} · {t.target_level} · {t.month_label || '—'} {t.is_active ? '' : '· inactive'}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => {
                setEditing(t.topic_id);
                setForm({ title: t.title, task_type: t.task_type, topic_text: t.topic_text, model_answer: t.model_answer || '', target_level: t.target_level, month_label: t.month_label || '' });
              }}>Edit</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(t.topic_id)}>Delete</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-gray-400">No topics yet — create the first one.</p>}
      </section>
    </div>
  );
}

/* --------------------------------------------------------- SimulatorPrompts ---- */
function SimPrompts() {
  const [items, load] = useCrud('/api/admin/simulator-prompts', 'prompts');
  const empty = { task_type: 1, text: '' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const save = async () => {
    try {
      if (editing) await api.put(`/api/admin/simulator-prompts/${editing}`, form);
      else await api.post('/api/admin/simulator-prompts', form);
      toast.success('Saved'); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/simulator-prompts/${id}`); toast.success('Deactivated'); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? 'Edit simulator prompt' : 'New simulator prompt'}</h2>
        <Field label="Task">
          <select className="input" value={form.task_type} onChange={(e) => setForm({ ...form, task_type: Number(e.target.value) })}>
            {[1, 2, 3].map((t) => <option key={t} value={t}>Tâche {t}</option>)}
          </select>
        </Field>
        <Field label="Consigne"><textarea className="input min-h-[120px]" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save}>{editing ? 'Update' : 'Create'}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
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
              <button className="btn-outline !px-3 !py-1 text-xs" onClick={() => { setEditing(p.sim_prompt_id); setForm({ task_type: p.task_type, text: p.text }); }}>Edit</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(p.sim_prompt_id)}>Delete</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );

  /* ---------------------------------------------------------------- Blog ---- */
function Blog() {
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
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      is_published: form.is_published,
    };
    try {
      if (editing) await api.put(`/api/admin/blog/${editing}`, payload);
      else await api.post('/api/admin/blog', payload);
      toast.success('Saved'); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    try { await api.delete(`/api/admin/blog/${id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  if (!items) return <Spinner />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <h2 className="font-heading font-semibold">{editing ? 'Edit post' : 'New blog post'}</h2>
        <Field label="Title"><input className="input" value={form.title} onChange={set('title')} data-testid="blog-title-input" /></Field>
        <Field label="Excerpt (short summary)"><textarea className="input min-h-[70px]" value={form.excerpt} onChange={set('excerpt')} /></Field>
        <Field label="Content (Markdown or HTML)"><textarea className="input min-h-[220px] font-mono text-xs" value={form.content} onChange={set('content')} data-testid="blog-content-textarea" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Author"><input className="input" value={form.author} onChange={set('author')} /></Field>
          <Field label="Tags (comma-separated)"><input className="input" placeholder="tcf, grammaire" value={form.tags} onChange={set('tags')} /></Field>
        </div>
        <Field label="Cover image URL"><input className="input" value={form.cover_image} onChange={set('cover_image')} /></Field>
        <Field label="Meta description (SEO)"><input className="input" value={form.meta_description} onChange={set('meta_description')} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
          <span className="font-medium text-gray-600">Published</span>
        </label>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={save} data-testid="save-blog-button">{editing ? 'Update' : 'Create'}</button>
          {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
        </div>
      </section>
      <section className="space-y-3">
        {items.map((p) => (
          <div key={p.post_id} className={`card flex items-start justify-between gap-4 p-5 ${p.is_published ? '' : 'opacity-50'}`}>
            <div>
              <p className="font-semibold">{p.title}</p>
              <p className="text-xs text-gray-500">/{p.slug} · {p.author} {p.is_published ? '' : '· draft'}</p>
              {p.tags?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.tags.map((t) => <span key={t} className="pill bg-violet-50 text-xs text-primary">{t}</span>)}
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
              }}>Edit</button>
              <button className="btn-outline !border-red-200 !px-3 !py-1 text-xs !text-red-600" onClick={() => del(p.post_id)}>Delete</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="text-sm text-gray-400">No posts yet — write the first one.</p>}
      </section>
    </div>
  );
}
}
