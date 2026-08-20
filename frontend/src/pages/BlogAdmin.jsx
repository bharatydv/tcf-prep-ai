import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlusCircle, PencilSimple, Trash, FloppyDisk, X } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { BackLink } from '../components/shared';
import { useT } from '../i18n';

const EMPTY = {
  title: '', slug: '', excerpt: '', content: '', cover_image: '',
  meta_description: '', author: 'prepfrancais', tags: '', is_published: true,
};

export default function BlogAdmin() {
  const t = useT();
  const [posts, setPosts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/blog')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(() => toast.error(t('blogAdmin.loadFailed')));
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const startNew = () => { setForm(EMPTY); setEditingId(null); };
  const startEdit = (p) => {
    setEditingId(p.post_id);
    setForm({
      title: p.title || '', slug: p.slug || '', excerpt: p.excerpt || '',
      content: p.content || '', cover_image: p.cover_image || '',
      meta_description: p.meta_description || '', author: p.author || 'prepfrancais',
      tags: Array.isArray(p.tags) ? p.tags.join(', ') : '',
      is_published: p.is_published !== false,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      return toast.error(t('blogAdmin.required'));
    }
    setSaving(true);
    const payload = {
      title: form.title,
      content: form.content,
      excerpt: form.excerpt,
      cover_image: form.cover_image,
      meta_description: form.meta_description,
      author: form.author,
      tags: form.tags ? form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      is_published: form.is_published,
      slug: form.slug || undefined,
    };
    try {
      if (editingId) {
        await api.put(`/api/admin/blog/${editingId}`, payload);
        toast.success(t('blogAdmin.updated'));
      } else {
        await api.post('/api/admin/blog', payload);
        toast.success(t('blogAdmin.created'));
      }
      startNew();
      load();
    } catch (e) {
      toast.error(t('blogAdmin.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(t('blogAdmin.confirmDelete', { title: p.title }))) return;
    try {
      await api.delete(`/api/admin/blog/${p.post_id}`);
      toast.success(t('blogAdmin.deleted'));
      if (editingId === p.post_id) startNew();
      load();
    } catch {
      toast.error(t('blogAdmin.deleteFailed'));
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <BackLink to="/admin" label={t('blogAdmin.backToAdmin')} />
      <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('blogAdmin.title')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('blogAdmin.subtitleA')} <code>/blog</code>.</p>

      {/* EDITOR */}
      <div className="mt-8 rounded-3xl border border-violet-100 bg-white p-6 shadow-xl shadow-violet-200/40">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-gray-900">
            {editingId ? t('blogAdmin.editPost') : t('blogAdmin.newPost')}
          </h2>
          {editingId && (
            <button onClick={startNew} className="btn-outline !py-1.5 text-sm"><X size={16} /> {t('blogAdmin.cancelEdit')}</button>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.titleLabel')}</span>
            <input className="input !rounded-xl mt-1" value={form.title} onChange={set('title')} placeholder={t('blogAdmin.titlePlaceholder')} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.slugLabel')}</span>
            <input className="input !rounded-xl mt-1" value={form.slug} onChange={set('slug')} placeholder={t('blogAdmin.slugPlaceholder')} />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.excerptLabel')}</span>
          <input className="input !rounded-xl mt-1" value={form.excerpt} onChange={set('excerpt')} maxLength={300} placeholder={t('blogAdmin.excerptPlaceholder')} />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.contentLabel')}</span>
          <textarea className="input !rounded-xl mt-1 min-h-[260px] font-mono text-sm" value={form.content} onChange={set('content')}
            placeholder={t('blogAdmin.contentPlaceholder')} />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.coverLabel')}</span>
            <input className="input !rounded-xl mt-1" value={form.cover_image} onChange={set('cover_image')} placeholder={t('blogAdmin.coverPlaceholder')} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.tagsLabel')}</span>
            <input className="input !rounded-xl mt-1" value={form.tags} onChange={set('tags')} placeholder={t('blogAdmin.tagsPlaceholder')} />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.metaLabel')}</span>
            <input className="input !rounded-xl mt-1" value={form.meta_description} onChange={set('meta_description')} maxLength={170} placeholder={t('blogAdmin.metaPlaceholder')} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">{t('admin.author')}</span>
            <input className="input !rounded-xl mt-1" value={form.author} onChange={set('author')} />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={form.is_published} onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))} />
          <span className="text-sm font-semibold text-gray-700">{t('blogAdmin.publishedLabel')}</span>
        </label>

        <div className="mt-6 flex gap-3">
          <button onClick={save} disabled={saving} className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600">
            <FloppyDisk size={18} weight="fill" /> {saving ? t('admin.saving') : (editingId ? t('blogAdmin.updatePost') : t('blogAdmin.createPost'))}
          </button>
          {!editingId && (
            <button onClick={startNew} className="btn-outline"><PlusCircle size={18} /> {t('blogAdmin.clear')}</button>
          )}
        </div>
      </div>

      {/* LIST */}
      <h2 className="mt-10 font-heading text-lg font-bold text-gray-900">{t('blogAdmin.allPosts', { n: posts.length })}</h2>
      <div className="mt-4 space-y-3">
        {posts.length === 0 && <p className="text-sm text-gray-500">{t('blogAdmin.noPosts')}</p>}
        {posts.map((p) => (
          <div key={p.post_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <p className="font-heading text-sm font-bold text-gray-900">
                {p.title}
                {p.is_published === false && <span className="pill ml-2 bg-amber-100 text-amber-700">{t('blogAdmin.draft')}</span>}
              </p>
              <p className="text-xs text-gray-400">/blog/{p.slug}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(p)} className="btn-outline !py-1.5 text-sm"><PencilSimple size={15} /> {t('admin.edit')}</button>
              <button onClick={() => remove(p)} className="btn-outline !py-1.5 text-sm !border-red-200 !text-red-600 hover:!bg-red-50"><Trash size={15} /> {t('admin.delete')}</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
