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
  ['/listening/practice', 0.6, 'monthly'],
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

  ['/privacy', 0.3, 'yearly'],
  ['/terms', 0.3, 'yearly'],
  ['/contact', 0.5, 'yearly'],
  ['/refund', 0.3, 'yearly'],
  ['/shipping', 0.3, 'yearly'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* English is unprefixed, French lives under /fr — the same rule as
   src/lib/locale.js, repeated because this script is CommonJS and cannot
   import an ES module. If that rule changes, it changes in both. */
const LOCALES = ['en', 'fr'];
const localePath = (lang, route) => {
  const full = (lang === 'fr' ? '/fr' : '') + route;
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full;
};

/* hreflang, in the sitemap as well as on the page.
 *
 * The on-page tags are written by JavaScript, so they only exist for a crawler
 * once something has rendered the page. These do not depend on that, and they
 * are the signal Google documents as the most reliable of the three.
 *
 * Every entry names every version INCLUDING ITSELF. A non-reciprocal set is
 * the usual reason an hreflang cluster is ignored wholesale. */
function alternates(route) {
  return LOCALES.map((lang) =>
    `    <xhtml:link rel="alternate" hreflang="${lang}" `
    + `href="${esc(SITE + localePath(lang, route))}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" `
      + `href="${esc(SITE + localePath('en', route))}"/>`);
}

function urlEntry(loc, priority, changefreq, lastmod, xhtml = []) {
  return [
    '  <url>',
    `    <loc>${esc(SITE + loc)}</loc>`,
    ...xhtml,
    lastmod ? `    <lastmod>${String(lastmod).slice(0, 10)}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}

/* One route, both languages, each pointing at the other. */
function localisedEntries(route, priority, changefreq) {
  const xhtml = alternates(route);
  return LOCALES.map((lang) =>
    urlEntry(localePath(lang, route), priority, changefreq, null, xhtml));
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
  /* Posts are listed once, unprefixed, with no alternates: an article is
     written in one language and only the shell around it is translated, so a
     /fr/blog/... entry would submit the same English text at a second address.
     src/pages/BlogPost.jsx passes localized={false} for the same reason.

     lastmod IS emitted here, because here it is true — it is the post's own
     updated_at, not the time the build ran. */
  merged.forEach((p) => p.slug && out.push(urlEntry(`/blog/${p.slug}`, 0.8, 'monthly', p.updated_at || p.created_at)));
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
  /* No lastmod on the static routes.
   *
   * It used to be the build date, stamped on all of them, so a deploy that
   * touched one component told Google that forty pages had changed. Google
   * discounts lastmod wholesale once it catches a site being unreliable about
   * it — and that would take the blog posts down with it, where the date is
   * the post's own and is worth having. Saying nothing is better than saying
   * something false: an absent lastmod is simply not a signal.
   */
  const entries = STATIC.flatMap(([loc, p, f]) => localisedEntries(loc, p, f))
    .concat(await dynamicRoutes());
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
  fs.writeFileSync(OUT, xml, 'utf8');
  console.log(`[sitemap] ${entries.length} urls -> public/sitemap.xml`);
})();
