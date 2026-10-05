/* The articles that ship in the repo, read from disk.
 *
 * Both build scripts asked the running API for the blog and took whatever came
 * back, including nothing. That made two separate failures look identical and
 * both silent: a build that cannot reach the API, and a build that reaches an
 * API which has not seeded its posts yet. The second one is routine — the
 * backend seeds `backend/content/blog` on boot, so a frontend built alongside a
 * fresh backend asks before the posts exist. Either way the sitemap shipped
 * without a single post URL and /blog was frozen as "No articles yet".
 *
 * These files are in the image already. Reading them needs no network and no
 * ordering between containers, so the articles the repo ships can always reach
 * the sitemap and always be prerendered. The API is still asked first and still
 * wins where it answers: it is the only source for posts written in /admin/blog,
 * and the only source of real timestamps. This is a floor under it, not a
 * replacement for it.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'backend', 'content', 'blog');

/* Metadata lives in <slug>.json beside a <slug>.html body, which is the layout
   publish_blog.py and the backend seeder both read. */
function readRepoPosts() {
  let names;
  try {
    names = fs.readdirSync(DIR).filter((n) => n.endsWith('.json'));
  } catch {
    // No such directory is a legitimate state, not an error: a checkout that
    // ships no articles should build exactly as it does today.
    return [];
  }

  const posts = [];
  for (const name of names.sort()) {
    const metaPath = path.join(DIR, name);
    const bodyPath = metaPath.replace(/\.json$/, '.html');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const content = fs.readFileSync(bodyPath, 'utf8');
      const slug = meta.slug || name.replace(/\.json$/, '');
      // An unpublished article is not a build error, it is just not published.
      if (meta.is_published === false) continue;
      if (!slug || !meta.title || !content.trim()) {
        console.warn(`[repo-blog] ${name}: needs a slug, a title and a body`);
        continue;
      }
      /* The files carry no timestamps, so mtime stands in. It is what a
         sitemap's lastmod is actually claiming — when this article last
         changed — and it moves when someone edits the file. */
      const mtime = fs.statSync(bodyPath).mtime.toISOString();
      posts.push({
        post_id: `repo_${slug}`,
        slug,
        title: meta.title,
        excerpt: meta.excerpt || '',
        content,
        cover_image: meta.cover_image || '',
        meta_description: meta.meta_description || '',
        author: meta.author || 'prepfrancais',
        tags: meta.tags || [],
        is_published: true,
        created_at: mtime,
        updated_at: mtime,
      });
    } catch (e) {
      console.warn(`[repo-blog] ${name} skipped: ${e.message}`);
    }
  }
  return posts;
}

/* API posts first, then any repo article the API did not mention. Ordering
   matters: a post the API returned is the live one, with its real id, its real
   timestamps and any edit made in /admin/blog since it was seeded. */
function mergeBySlug(apiPosts, repoPosts) {
  const bySlug = new Map();
  for (const p of apiPosts) if (p && p.slug) bySlug.set(p.slug, p);
  for (const p of repoPosts) if (!bySlug.has(p.slug)) bySlug.set(p.slug, p);
  return [...bySlug.values()];
}

module.exports = { readRepoPosts, mergeBySlug };
