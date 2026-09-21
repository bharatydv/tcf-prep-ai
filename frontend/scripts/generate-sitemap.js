/* Build-time sitemap.
 *
 * Static routes come from the list below; blog slugs and topic ids are pulled
 * from the API when SITEMAP_API is set, so content added after a deploy still
 * reaches the sitemap on the next build. A failed fetch is not fatal — a
 * sitemap with the static routes beats no sitemap at all.
 *
 *   node scripts/generate-sitemap.js
 */
const fs = require('fs');
const path = require('path');

const SITE = (process.env.REACT_APP_SITE_URL || 'https://prepfrancais.com').replace(/\/$/, '');
const API = process.env.SITEMAP_API || '';
const OUT = path.join(__dirname, '..', 'public', 'sitemap.xml');

// Public routes only. Anything behind ProtectedRoute is disallowed in robots.txt
// and has nothing to show a crawler anyway.
const STATIC = [
  ['/', 1.0, 'weekly'],
  ['/tef-tcf-writing-guide', 0.9, 'monthly'],
  ['/blog', 0.9, 'weekly'],
  ['/practice', 0.8, 'monthly'],
  ['/practice/tasks', 0.7, 'monthly'],
  ['/practice/themes', 0.7, 'monthly'],
  ['/speaking', 0.8, 'monthly'],
  ['/speaking/tasks', 0.7, 'monthly'],
  ['/speaking/themes', 0.7, 'monthly'],
  /* /reading/practice and /listening/practice are deliberately absent: both
     redirect a signed-out visitor to /login, so submitting them for indexing
     offered search engines a login form. The hubs below are the public pages
     a crawler should be pointed at. */
  ['/reading', 0.7, 'monthly'],
  ['/listening', 0.7, 'monthly'],
  ['/resources', 0.7, 'monthly'],
  ['/tcf-canada-vocabulary', 0.8, 'monthly'],
  ['/combinations', 0.6, 'monthly'],
  ['/pricing', 0.8, 'monthly'],
  /* The TCF Canada landing family. Source of truth for the routes is
     src/pages/tcfCanada/slugs.js — this script is CommonJS and cannot
     import it, so the list is repeated here and in reactSnap.include. */
  ['/tcf-canada', 0.9, 'monthly'],
  ['/tcf-canada-practice', 0.8, 'monthly'],
  ['/tcf-canada-mock-test', 0.8, 'monthly'],
  ['/tcf-canada-exam-simulator', 0.8, 'monthly'],
  ['/tcf-canada-nclc-7', 0.8, 'monthly'],
  ['/tcf-canada-speaking', 0.8, 'monthly'],
  ['/tcf-canada-writing', 0.8, 'monthly'],
  ['/tcf-canada-listening', 0.7, 'monthly'],
  ['/tcf-canada-reading', 0.7, 'monthly'],
  ['/tcf-canada-speaking-task-1', 0.7, 'monthly'],
  ['/tcf-canada-speaking-task-2', 0.7, 'monthly'],
  ['/tcf-canada-speaking-task-3', 0.7, 'monthly'],
  ['/tcf-canada-writing-task-1', 0.7, 'monthly'],
  ['/tcf-canada-writing-task-2', 0.7, 'monthly'],
  ['/tcf-canada-writing-task-3', 0.7, 'monthly'],

  ['/privacy', 0.3, 'yearly'],
  ['/terms', 0.3, 'yearly'],
  ['/contact', 0.5, 'yearly'],
  ['/refund', 0.3, 'yearly'],
  ['/shipping', 0.3, 'yearly'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* One language, so one URL per page and no hreflang. The site shipped a French
   interface under /fr for a release; those URLs are 301'd to their English
   page (frontend/nginx.conf, src/lib/locale.js) and are deliberately absent
   here — a sitemap should only ever list the address a page settles on. */
function urlEntry(loc, priority, changefreq, lastmod) {
  return [
    '  <url>',
    `    <loc>${esc(SITE + loc)}</loc>`,
    lastmod ? `    <lastmod>${String(lastmod).slice(0, 10)}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}

const { readRepoPosts, mergeBySlug } = require('./repo-blog');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function dynamicRoutes() {
  const out = [];
  /* The articles in the repo are the floor. Asking the API and taking whatever
     came back meant a build that could not reach it -- or reached a backend
     that had not seeded its posts yet -- shipped a sitemap with no post URL at
     all, silently. */
  let posts = [];
  if (API) {
    try {
      ({ posts = [] } = await fetchJson(`${API}/api/blog`));
    } catch (e) { console.warn('[sitemap] blog API unreachable:', e.message); }
  }
  const merged = mergeBySlug(posts, readRepoPosts());
  if (merged.length > posts.length) {
    console.warn(`[sitemap] blog: ${posts.length} from the API, `
      + `${merged.length - posts.length} more from the repo`);
  }
  /* lastmod IS emitted here, because here it is true — it is the post's own
     updated_at, not the time the build ran. */
  merged.forEach((p) => p.slug && out.push(urlEntry(`/blog/${p.slug}`, 0.8, 'monthly', p.updated_at || p.created_at)));
  /* Topic DETAIL pages, back in.
   *
   * They were removed when /api/recent-topics/{id} required a session: the
   * page answered a signed-out visitor — and every crawler — with "please log
   * in", which is a soft 404 submitted for indexing. That endpoint is public
   * now and returns the consigne without the model answer, so each topic is a
   * real page with content nobody else has.
   *
   */
  /* The LISTING is conditional, which is why it lives here and not in STATIC.
   *
   * /api/recent-topics answers `{"topics": []}` in production today, so the
   * page prerendered to a heading and nothing else - and was submitted for
   * indexing anyway. An empty page in a sitemap is worse
   * than an absent one: it spends crawl budget to prove there is nothing worth
   * coming back for, on a site whose problem is already that Google will not
   * spend crawl budget here. The moment a topic exists the listing has content
   * and returns, with its detail pages beside it.
   *
   * Same reasoning as the /reading/practice exclusion in STATIC above: never
   * submit a URL that has nothing to show a crawler. */
  if (API) {
    try {
      const { topics = [] } = await fetchJson(`${API}/api/recent-topics`);
      if (topics.length) {
        out.push(urlEntry('/recent-topics', 0.9, 'weekly'));
        topics.forEach((topic) => topic.topic_id && out.push(
          urlEntry(`/recent-topics/${topic.topic_id}`, 0.7, 'monthly',
            topic.updated_at || topic.created_at)));
        console.warn(`[sitemap] recent topics: ${topics.length}`);
      } else {
        console.warn('[sitemap] recent topics: none - listing left out of the sitemap');
      }
    } catch (e) {
      console.warn('[sitemap] recent-topics unreachable:', e.message);
    }
  }
  return out;
}

(async () => {
  /* No lastmod on the static routes.
   *
   * It used to be the build date, stamped on all of them, so a deploy that
   * touched one component told Google that forty pages had changed. Google
   * discounts lastmod wholesale once it catches a site being unreliable about
   * it — and that would take the blog posts down with it, where the date is
   * the post's own and is worth having. Saying nothing is better than saying
   * something false: an absent lastmod is simply not a signal.
   */
  const entries = STATIC.map(([loc, p, f]) => urlEntry(loc, p, f))
    .concat(await dynamicRoutes());
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
  fs.writeFileSync(OUT, xml, 'utf8');
  console.log(`[sitemap] ${entries.length} urls -> public/sitemap.xml`);
})();
