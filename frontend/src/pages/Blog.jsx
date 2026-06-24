import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkle, MagnifyingGlass, ArrowRight, CalendarBlank, Star,
} from '@phosphor-icons/react';
import { api } from '../lib/api';

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return String(d).slice(0, 10); }
}

/* Decorative Eiffel Tower / Paris skyline (inline SVG, no external asset) */
function ParisSkyline() {
  return (
    <svg viewBox="0 0 400 200" className="h-full w-full" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5">
        {/* Eiffel tower */}
        <path d="M300 30 L292 90 L284 170 M300 30 L308 90 L316 170" strokeLinecap="round" />
        <path d="M289 110 L311 110 M285 150 L315 150 M294 80 L306 80" />
        <path d="M284 170 L268 190 M316 170 L332 190" strokeLinecap="round" />
        <circle cx="300" cy="26" r="3" fill="currentColor" />
        {/* little buildings */}
        <rect x="40" y="150" width="26" height="40" rx="2" />
        <rect x="74" y="135" width="20" height="55" rx="2" />
        <path d="M100 145 h30 v45 h-30 z M100 145 l15 -14 l15 14" />
        <rect x="150" y="155" width="24" height="35" rx="2" />
        <path d="M196 150 a16 16 0 0 1 32 0 v40 h-32 z" />
        <rect x="240" y="160" width="20" height="30" rx="2" />
      </g>
    </svg>
  );
}

export default function Blog() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState('All');

  useEffect(() => {
    document.title = 'Blog — TEF / TCF tips, guides & strategies | MonFrancais';
    api.get('/api/blog')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  // Build category list from post tags
  const categories = useMemo(() => {
    const set = new Set();
    posts.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
    return ['All', ...Array.from(set)];
  }, [posts]);

  // Filter by search + category
  const filtered = useMemo(() => {
    return posts.filter((p) => {
      const matchesCat = activeCat === 'All' || (p.tags || []).includes(activeCat);
      const q = query.trim().toLowerCase();
      const matchesQuery = !q
        || (p.title || '').toLowerCase().includes(q)
        || (p.excerpt || '').toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [posts, query, activeCat]);

  const featured = filtered[0] || null;
  const rest = featured ? filtered.slice(1) : [];

  return (
    <main className="overflow-x-clip bg-white">
      {/* HERO with skyline */}
      <section className="relative overflow-hidden bg-gradient-to-br from-violet-100 via-fuchsia-50 to-violet-200">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-6 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-40 w-[420px] max-w-[60%] text-violet-400">
            <ParisSkyline />
          </div>
        </div>
        <div className="relative mx-auto max-w-4xl px-4 pb-12 pt-12 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary shadow-sm">
            <Sparkle size={14} weight="fill" /> Blog
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
            TEF / TCF{' '}
            <span className="bg-gradient-to-r from-primary via-fuchsia-600 to-fuchsia-500 bg-clip-text text-transparent">Tips &amp; Guides</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-700">
            Strategies, study plans and writing tips to help you reach CLB 7 and beyond on the TEF and TCF exams.
          </p>

          {/* Search */}
          <div className="mx-auto mt-6 flex max-w-md items-center gap-2 rounded-full border border-violet-200 bg-white/90 px-4 py-2 shadow-sm">
            <MagnifyingGlass size={18} className="text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
              data-testid="blog-search"
            />
          </div>

          {/* Category pills */}
          {categories.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCat(c)}
                  data-testid={`blog-cat-${c}`}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition ${
                    activeCat === c
                      ? 'bg-gradient-to-r from-primary to-fuchsia-600 text-white shadow'
                      : 'border border-violet-200 bg-white/80 text-gray-600 hover:bg-white'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-12 text-center shadow-soft">
            <p className="font-heading text-lg font-bold text-gray-900">
              {posts.length === 0 ? 'No articles yet' : 'No articles match your search'}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              {posts.length === 0 ? 'New posts are on the way — check back soon!' : 'Try a different keyword or category.'}
            </p>
          </div>
        ) : (
          <>
            {/* FEATURED ARTICLE */}
            {featured && (
              <div className="mb-10">
                <h2 className="mb-4 flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wide text-primary">
                  <Star size={16} weight="fill" /> Featured article
                </h2>
                <Link
                  to={`/blog/${featured.slug}`}
                  data-testid="blog-featured"
                  className="group grid overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-soft transition hover:shadow-xl hover:shadow-violet-200/50 md:grid-cols-2"
                >
                  <div className="relative min-h-[220px] overflow-hidden bg-gradient-to-br from-violet-200 to-fuchsia-200">
                    {featured.cover_image ? (
                      <img src={featured.cover_image} alt={featured.title}
                        className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-violet-400">
                        <Sparkle size={56} weight="duotone" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col justify-center p-7">
                    {Array.isArray(featured.tags) && featured.tags[0] && (
                      <span className="pill mb-3 self-start bg-violet-50 capitalize text-primary">{featured.tags[0]}</span>
                    )}
                    <h3 className="font-heading text-2xl font-extrabold leading-snug text-gray-900 group-hover:text-primary">
                      {featured.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-gray-600">{featured.excerpt}</p>
                    <div className="mt-5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-gray-400">
                        <CalendarBlank size={14} /> {fmtDate(featured.created_at)}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                        Read <ArrowRight size={15} weight="bold" />
                      </span>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* LATEST GRID */}
            {rest.length > 0 && (
              <>
                <h2 className="mb-4 font-heading text-xl font-extrabold text-gray-900">Latest articles</h2>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((p) => (
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
                        {Array.isArray(p.tags) && p.tags[0] && (
                          <span className="pill mb-3 self-start bg-violet-50 capitalize text-primary">{p.tags[0]}</span>
                        )}
                        <h3 className="font-heading text-lg font-bold leading-snug text-gray-900 group-hover:text-primary">
                          {p.title}
                        </h3>
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
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}