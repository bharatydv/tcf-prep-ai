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
  ['/recent-topics', 0.9, 'weekly'],
  ['/practice', 0.8, 'monthly'],
  ['/practice/tasks', 0.7, 'monthly'],
  ['/practice/themes', 0.7, 'monthly'],
  ['/speaking', 0.8, 'monthly'],
  ['/speaking/tasks', 0.7, 'monthly'],
  ['/speaking/themes', 0.7, 'monthly'],
  ['/reading', 0.7, 'monthly'],
  ['/reading/practice', 0.6, 'monthly'],
  ['/listening', 0.7, 'monthly'],
  ['/resources', 0.7, 'monthly'],
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

  ['/register', 0.6, 'yearly'],
  ['/login', 0.4, 'yearly'],
  ['/privacy', 0.3, 'yearly'],
  ['/terms', 0.3, 'yearly'],
  ['/contact', 0.5, 'yearly'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function dynamicRoutes() {
  if (!API) return [];
  const out = [];
  try {
    const { posts = [] } = await fetchJson(`${API}/api/blog`);
    posts.forEach((p) => p.slug && out.push(urlEntry(`/blog/${p.slug}`, 0.8, 'monthly', p.updated_at || p.created_at)));
  } catch (e) { console.warn('[sitemap] blog posts skipped:', e.message); }
  /* Topic DETAIL pages are deliberately not listed.
   *
   * They used to be, at priority 0.7 each. /api/recent-topics/{id} requires a
   * session, so the page answers a signed-out visitor — and every crawler —
   * with "please log in": a soft 404 submitted for indexing. The listing page
   * /recent-topics is public and is in STATIC above, which is the right thing
   * to point a crawler at. If these pages are ever made to render their
   * consigne to a signed-out visitor, put them back. */
  return out;
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const entries = STATIC.map(([loc, p, f]) => urlEntry(loc, p, f, today))
    .concat(await dynamicRoutes());
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
  fs.writeFileSync(OUT, xml, 'utf8');
  console.log(`[sitemap] ${entries.length} urls -> public/sitemap.xml`);
})();
