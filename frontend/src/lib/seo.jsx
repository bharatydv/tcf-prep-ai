/* Per-route document metadata.
 *
 * Why not react-helmet-async: it is one more dependency and one more provider
 * for a job that is four DOM writes. This component owns every tag it sets and
 * restores the shell's defaults on unmount, so navigating between routes never
 * leaves the previous page's description behind.
 *
 * The shell in public/index.html already carries the site-wide defaults and the
 * Organization/WebSite/SoftwareApplication graph, so a route that says nothing
 * still has valid metadata. What this adds is the per-page layer.
 *
 * Usage:
 *   <Seo titleKey="pricing.docTitle" descKey="pricing.docDesc" path="/pricing" />
 *   <Seo title={post.title} description={post.excerpt} path={`/blog/${slug}`}
 *        type="article" image={post.cover_image} jsonLd={articleSchema} />
 */
import { useEffect } from 'react';
import { useI18n } from '../i18n';

export const SITE_URL = (process.env.REACT_APP_SITE_URL || 'https://prepfrancais.com')
  .replace(/\/$/, '');

const DEFAULTS = {
  title: 'TEF & TCF Canada practice with AI correction | prepfrancais',
  description:
    "Préparation IA au TEF et au TCF Canada : correction de l'expression écrite et orale, "
    + 'niveau CEFR expliqué, examens blancs et révision de vos propres erreurs.',
  image: `${SITE_URL}/og-image.png`,
};

/* One helper for both <meta name> and <meta property>, because Open Graph uses
   `property` and Twitter uses `name` and getting them crossed silently drops
   the tag from every scraper that checks. */
function setMeta(attr, key, content) {
  if (content == null) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', String(content));
}

function setLink(rel, href, extra = {}) {
  const sel = extra.hreflang
    ? `link[rel="${rel}"][hreflang="${extra.hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({
  title, titleKey,
  description, descKey,
  path,
  image,
  type = 'website',
  jsonLd,
  noindex = false,
} = {}) {
  const { t, lang } = useI18n();

  const resolvedTitle = titleKey ? t(titleKey) : title;
  const resolvedDesc = descKey ? t(descKey) : description;

  useEffect(() => {
    const fullTitle = resolvedTitle
      ? (resolvedTitle.includes('prepfrancais') ? resolvedTitle : `${resolvedTitle} | prepfrancais`)
      : DEFAULTS.title;
    const desc = resolvedDesc || DEFAULTS.description;
    const url = SITE_URL + (path || window.location.pathname);
    const img = image
      ? (image.startsWith('http') ? image : SITE_URL + image)
      : DEFAULTS.image;

    document.title = fullTitle;
    setMeta('name', 'description', desc);
    setLink('canonical', url);

    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', img);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:locale', lang === 'fr' ? 'fr_CA' : 'en_CA');
    /* The shell ships a static alternate, so whichever locale rendered, the
       page claimed en_CA as both its locale and its only other one. */
    setMeta('property', 'og:locale:alternate', lang === 'fr' ? 'en_CA' : 'fr_CA');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', desc);
    setMeta('name', 'twitter:image', img);

    // Both locales still live at one address, so every page points its
    // alternates at itself. When locale routing lands, only this block changes.
    setLink('alternate', url, { hreflang: 'fr-CA' });
    setLink('alternate', url, { hreflang: 'en' });
    setLink('alternate', url, { hreflang: 'x-default' });

    // Signed-in and utility pages should never enter an index.
    let robots = document.head.querySelector('meta[name="robots"]');
    if (noindex) {
      if (!robots) {
        robots = document.createElement('meta');
        robots.setAttribute('name', 'robots');
        document.head.appendChild(robots);
      }
      robots.setAttribute('content', 'noindex, nofollow');
    } else if (robots) {
      robots.remove();
    }

    let script = null;
    if (jsonLd) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.seo = 'route';
      script.text = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      if (script) script.remove();
      const stale = document.head.querySelector('meta[name="robots"]');
      if (noindex && stale) stale.remove();
    };
  }, [resolvedTitle, resolvedDesc, path, image, type, jsonLd, noindex, lang]);
}

/* Element form, for pages that read better with it in the tree. Identical
   behaviour — but it must sit in a branch that always renders. Prefer useSeo()
   in any component with a loading, empty or "coming soon" early return. */
export function Seo(props) {
  useSeo(props);
  return null;
}

/* Breadcrumbs help both search results and answer engines place a deep page in
   the site. `trail` is [[label, path], ...] ending at the current page. */
export function breadcrumbSchema(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, p], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: SITE_URL + p,
    })),
  };
}

export default Seo;
