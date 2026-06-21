import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkle, ArrowRight, CalendarBlank } from '@phosphor-icons/react';
import { api } from '../lib/api';

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return String(d).slice(0, 10); }
}

export default function Blog() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Blog — TEF / TCF tips, guides & strategies | MonFrancais';
    api.get('/api/blog')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO */}
      <section className="relative bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-6 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-violet-400/25 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-12 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm backdrop-blur">
            <Sparkle size={14} weight="fill" /> Blog
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            TEF / TCF{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">Tips & Guides</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600">
            Strategies, study plans and writing tips to help you reach CLB 7 and beyond on the TEF and TCF exams.
          </p>
        </div>
      </section>

      {/* LIST */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-12 text-center shadow-soft">
            <p className="font-heading text-lg font-bold text-gray-900">No articles yet</p>
            <p className="mt-2 text-sm text-gray-600">New posts are on the way — check back soon!</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <Link
                key={p.post_id}
                to={`/blog/${p.slug}`}
                data-testid={`blog-card-${p.slug}`}
                className="group flex flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-soft transition hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200/50"
              >
                {p.cover_image ? (
                  <div className="h-44 w-full overflow-hidden">
                    <img src={p.cover_image} alt={p.title}
                      className="h-full w-full object-cover transition group-hover:scale-105" />
                  </div>
                ) : (
                  <div className="h-2 w-full bg-gradient-to-r from-primary to-fuchsia-500" />
                )}
                <div className="flex flex-1 flex-col p-6">
                  {Array.isArray(p.tags) && p.tags.length > 0 && (
                    <span className="pill mb-3 self-start bg-violet-50 capitalize text-primary">{p.tags[0]}</span>
                  )}
                  <h2 className="font-heading text-lg font-bold leading-snug text-gray-900 group-hover:text-primary">
                    {p.title}
                  </h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{p.excerpt}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-gray-400">
                      <CalendarBlank size={14} /> {fmtDate(p.created_at)}
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                      Read <ArrowRight size={15} weight="bold" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
