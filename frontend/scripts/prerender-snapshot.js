/* Static copies of the public API, written for the prerender pass only.
 *
 * react-snap builds the site by serving `build/` from its own localhost server
 * and driving it with a headless browser. Nothing is behind that server, so
 * every page whose content arrives over the API rendered empty and was
 * snapshotted empty: /blog said "No articles yet" with a post sitting in the
 * database, no post page was ever linked and therefore never discovered by the
 * crawl, and /recent-topics shipped a body with nothing in it.
 *
 * The obvious fix — point the bundle at https://prepfrancais.com during the
 * pass — does not work. The API sets `access-control-allow-origin` to the site
 * itself, so a browser on react-snap's localhost origin has every response
 * blocked by CORS. Relaxing that to admit a build host would mean loosening
 * production CORS for the convenience of a build, which is the wrong trade.
 *
 * So the fetching happens here instead, in Node, where CORS does not apply.
 * Each public endpoint is written to `public/prerender/<path>.json`, and during
 * the pass the api client rewrites its requests to those files — same origin,
 * no network, no third-party request for react-snap to block. `clean` deletes
 * them again afterwards so they never reach the published image.
 *
 *   node scripts/prerender-snapshot.js          (before craco build)
 *   node scripts/prerender-snapshot.js clean    (after react-snap)
 *
 * Only endpoints listed here are mirrored. Anything else 404s during the pass
 * and the component shows the same empty state it shows today, so a missing
 * snapshot degrades exactly as far as the current behaviour and no further.
 *
 * A failed fetch is never fatal. The API being unreachable at build time is
 * the normal case on a first deploy, and it must cost a stale prerender, not
 * the whole image.
 */
const fs = require('fs');
const path = require('path');

const API = (process.env.SITEMAP_API || '').replace(/\/+$/, '');
const OUT = path.join(__dirname, '..', 'public', 'prerender');
/* craco copies public/ into build/, so the snapshots exist in both places by
   the time react-snap has finished with them. `clean` has to take both or the
   published image would serve a frozen copy of the API at /prerender. */
const BUILT = path.join(__dirname, '..', 'build', 'prerender');

/* Matches the api client's own timeout posture: a build must not hang on a
   backend that accepts the connection and then says nothing. */
const TIMEOUT_MS = 20000;

async function getJson(endpoint) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${endpoint}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${endpoint}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function write(relative, data) {
  const file = path.join(OUT, `${relative}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function clean() {
  for (const dir of [OUT, BUILT]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('[snapshot] removed public/prerender and build/prerender');
}

async function snapshot() {
  if (!API) {
    console.warn('[snapshot] SITEMAP_API is not set — API-backed pages will '
      + 'prerender empty, exactly as they did before this script existed.');
    return;
  }
  clean();
  let written = 0;

  /* The blog index, and then every post it names. The index has to come first:
     its slugs are the only list of post URLs, and they are also what react-snap
     follows to discover the post pages at all. */
  try {
    const index = await getJson('/api/blog');
    write('blog', index);
    written += 1;
    const posts = index.posts || [];
    for (const post of posts) {
      if (!post.slug) continue;
      try {
        write(`blog/${post.slug}`, await getJson(`/api/blog/${post.slug}`));
        written += 1;
      } catch (e) {
        console.warn(`[snapshot] post ${post.slug} skipped: ${e.message}`);
      }
    }
    console.log(`[snapshot] blog: index + ${posts.length} post(s)`);
  } catch (e) {
    console.warn(`[snapshot] blog skipped: ${e.message}`);
  }

  /* The recent-topics listing only. A topic DETAIL needs a session and answers
     a signed-out visitor with "please log in", so there is nothing worth
     freezing — see the matching note in generate-sitemap.js. */
  try {
    write('recent-topics', await getJson('/api/recent-topics'));
    written += 1;
    console.log('[snapshot] recent-topics: listing');
  } catch (e) {
    console.warn(`[snapshot] recent-topics skipped: ${e.message}`);
  }

  console.log(`[snapshot] ${written} file(s) -> public/prerender`);
}

if (process.argv[2] === 'clean') {
  clean();
} else {
  snapshot().catch((e) => {
    // Deliberately not a non-zero exit: see the header.
    console.warn(`[snapshot] failed, continuing: ${e.message}`);
  });
}
