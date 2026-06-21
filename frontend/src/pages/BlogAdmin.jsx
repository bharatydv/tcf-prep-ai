import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlusCircle, PencilSimple, Trash, FloppyDisk, X } from '@phosphor-icons/react';
import { api } from '../lib/api';

const EMPTY = {
  title: '', slug: '', excerpt: '', content: '', cover_image: '',
  meta_description: '', author: 'MonFrancais', tags: '', is_published: true,
};

export default function BlogAdmin() {
  const [posts, setPosts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/api/admin/blog')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(() => toast.error('Could not load posts (admin only)'));
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setForm(EMPTY); setEditingId(null); };
  const startEdit = (p) => {
    setEditingId(p.post_id);
    setForm({
      title: p.title || '', slug: p.slug || '', excerpt: p.excerpt || '',
      content: p.content || '', cover_image: p.cover_image || '',
      meta_description: p.meta_description || '', author: p.author || 'MonFrancais',
      tags: Array.isArray(p.tags) ? p.tags.join(', ') : '',
      is_published: p.is_published !== false,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      return toast.error('Title and content are required.');
    }
    setSaving(true);
    const payload = {
      title: form.title,
      content: form.content,
      excerpt: form.excerpt,
      cover_image: form.cover_image,
      meta_description: form.meta_description,
      author: form.author,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      is_published: form.is_published,
      slug: form.slug || undefined,
    };
    try {
      if (editingId) {
        await api.put(`/api/admin/blog/${editingId}`, payload);
        toast.success('Post updated');
      } else {
        await api.post('/api/admin/blog', payload);
        toast.success('Post created');
      }
      startNew();
      load();
    } catch (e) {
      toast.error('Save failed — are you logged in as admin?');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/admin/blog/${p.post_id}`);
      toast.success('Post deleted');
      if (editingId === p.post_id) startNew();
      load();
    } catch {
      toast.error('Delete failed');
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-heading text-3xl font-extrabold text-gray-900">Blog admin</h1>
      <p className="mt-2 text-sm text-gray-600">Create and manage blog posts. Posts marked published appear at <code>/blog</code>.</p>

      {/* EDITOR */}
      <div className="mt-8 rounded-3xl border border-violet-100 bg-white p-6 shadow-xl shadow-violet-200/40">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-gray-900">
            {editingId ? 'Edit post' : 'New post'}
          </h2>
          {editingId && (
            <button onClick={startNew} className="btn-outline !py-1.5 text-sm"><X size={16} /> Cancel edit</button>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Title *</span>
            <input className="input !rounded-xl mt-1" value={form.title} onChange={set('title')} placeholder="How to reach CLB 7 in writing" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Slug (optional)</span>
            <input className="input !rounded-xl mt-1" value={form.slug} onChange={set('slug')} placeholder="auto-generated from title" />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-gray-700">Excerpt (short summary for cards & SEO)</span>
          <input className="input !rounded-xl mt-1" value={form.excerpt} onChange={set('excerpt')} maxLength={300} placeholder="One or two sentences shown on the blog list." />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-gray-700">Content * (Markdown or HTML)</span>
          <textarea className="input !rounded-xl mt-1 min-h-[260px] font-mono text-sm" value={form.content} onChange={set('content')}
            placeholder={'## Heading\n\nWrite your article here. Use **bold**, lists with - dashes, and [links](https://example.com).'} />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Cover image URL</span>
            <input className="input !rounded-xl mt-1" value={form.cover_image} onChange={set('cover_image')} placeholder="https://…" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Tags (comma-separated)</span>
            <input className="input !rounded-xl mt-1" value={form.tags} onChange={set('tags')} placeholder="writing, tcf, clb7" />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Meta description (SEO)</span>
            <input className="input !rounded-xl mt-1" value={form.meta_description} onChange={set('meta_description')} maxLength={170} placeholder="Up to ~160 characters." />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Author</span>
            <input className="input !rounded-xl mt-1" value={form.author} onChange={set('author')} />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={form.is_published} onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))} />
          <span className="text-sm font-semibold text-gray-700">Published (visible on the site)</span>
        </label>

        <div className="mt-6 flex gap-3">
          <button onClick={save} disabled={saving} className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <FloppyDisk size={18} weight="fill" /> {saving ? 'Saving…' : (editingId ? 'Update post' : 'Create post')}
          </button>
          {!editingId && (
            <button onClick={startNew} className="btn-outline"><PlusCircle size={18} /> Clear</button>
          )}
        </div>
      </div>

      {/* LIST */}
      <h2 className="mt-10 font-heading text-lg font-bold text-gray-900">All posts ({posts.length})</h2>
      <div className="mt-4 space-y-3">
        {posts.length === 0 && <p className="text-sm text-gray-500">No posts yet.</p>}
        {posts.map((p) => (
          <div key={p.post_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <p className="font-heading text-sm font-bold text-gray-900">
                {p.title}
                {p.is_published === false && <span className="pill ml-2 bg-amber-100 text-amber-700">Draft</span>}
              </p>
              <p className="text-xs text-gray-400">/blog/{p.slug}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(p)} className="btn-outline !py-1.5 text-sm"><PencilSimple size={15} /> Edit</button>
              <button onClick={() => remove(p)} className="btn-outline !py-1.5 text-sm !border-red-200 !text-red-600 hover:!bg-red-50"><Trash size={15} /> Delete</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
