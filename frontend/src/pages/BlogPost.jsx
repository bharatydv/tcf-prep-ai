import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarBlank, User } from '@phosphor-icons/react';
import { api } from '../lib/api';

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return String(d).slice(0, 10); }
}

/* Very small, safe markdown -> HTML for headings, bold, links, lists, paragraphs.
   If you write posts in HTML already, it passes through fine. */
function renderContent(src) {
  if (!src) return '';
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(src);
  if (looksHtml) return src;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = src.split(/\r?\n/);
  let html = '';
  let inList = false;
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (/^### /.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${esc(line.slice(4))}</h3>`; continue; }
    if (/^## /.test(line))  { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${esc(line.slice(3))}</h2>`; continue; }
    if (/^# /.test(line))   { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${esc(line.slice(2))}</h2>`; continue; }
    if (/^[-*] /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(esc(line.slice(2)))}</li>`; continue; }
    if (line === '') { if (inList) { html += '</ul>'; inList = false; } continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${inline(esc(line))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
}

export default function BlogPost() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/blog/${slug}`)
      .then(({ data }) => setPost(data.post))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!post) return;
    document.title = `${post.title} | MonFrancais Blog`;

    // Meta description (SEO/AEO)
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', post.meta_description || post.excerpt || '');

    // Article JSON-LD (strong for SEO + AI citation)
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'blog-jsonld';
    ld.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.meta_description || post.excerpt || '',
      author: { '@type': 'Organization', name: post.author || 'MonFrancais' },
      datePublished: post.created_at,
      dateModified: post.updated_at || post.created_at,
      image: post.cover_image || undefined,
    });
    document.getElementById('blog-jsonld')?.remove();
    document.head.appendChild(ld);

    return () => {
      document.getElementById('blog-jsonld')?.remove();
      if (prevDesc != null) meta.setAttribute('content', prevDesc);
    };
  }, [post]);

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </main>
    );
  }

  if (notFound || !post) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-heading text-2xl font-bold text-gray-900">Article not found</h1>
        <p className="mt-2 text-gray-600">This post may have been moved or unpublished.</p>
        <button onClick={() => navigate('/blog')} className="btn-primary mt-6 !bg-gradient-to-r !from-primary !to-fuchsia-600">
          <ArrowLeft size={18} /> Back to blog
        </button>
      </main>
    );
  }

  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-10 sm:px-6">
          <Link to="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <ArrowLeft size={16} /> All articles
          </Link>
          <h1 className="mt-4 font-heading text-3xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-4xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1.5"><User size={15} /> {post.author || 'MonFrancais'}</span>
            <span className="flex items-center gap-1.5"><CalendarBlank size={15} /> {fmtDate(post.created_at)}</span>
            {Array.isArray(post.tags) && post.tags.map((t) => (
              <span key={t} className="pill bg-white/80 capitalize text-primary">{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* COVER */}
      {post.cover_image && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <img src={post.cover_image} alt={post.title}
            className="mt-8 w-full rounded-3xl object-cover shadow-xl shadow-violet-200/40" />
        </div>
      )}

      {/* BODY */}
      <article
        className="prose-blog mx-auto max-w-3xl px-4 py-12 sm:px-6"
        dangerouslySetInnerHTML={{ __html: renderContent(post.content) }}
      />

      {/* FOOTER CTA */}
      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <div className="rounded-3xl bg-gradient-to-r from-primary via-purple-600 to-fuchsia-600 p-8 text-center">
          <h2 className="font-heading text-2xl font-extrabold text-white">Ready to evaluate your French writing?</h2>
          <p className="mt-2 text-sm text-violet-100/90">Get instant AI feedback and your estimated TEF/TCF score band.</p>
          <Link to="/practice" className="btn-primary mt-5 !bg-white !text-primary hover:!brightness-100">
            Try the Writing Assistant
          </Link>
        </div>
      </section>
    </main>
  );
}
