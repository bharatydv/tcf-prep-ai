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
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';

export const SITE_URL = (process.env.REACT_APP_SITE_URL || 'https://prepfrancais.com')
  .replace(/\/$/, '');

const DEFAULTS = {
  title: 'TEF & TCF Canada practice with AI correction | prepfrancais',
  description:
    'AI preparation for the TEF and TCF Canada: your written and spoken French '
    + 'corrected, your CEFR level explained, mock exams, and review built from '
    + 'your own mistakes.',
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

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/* The site was briefly served in two languages and every page named its
   translation. One locale means one address per page, so any alternate left in
   the shell or by a previous route would advertise a URL that now redirects. */
function clearHreflang() {
  document.head
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .forEach((el) => el.remove());
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
  const { t } = useI18n();
  const { pathname } = useLocation();

  const resolvedTitle = titleKey ? t(titleKey) : title;
  const resolvedDesc = descKey ? t(descKey) : description;

  useEffect(() => {
    const fullTitle = resolvedTitle
      ? (resolvedTitle.includes('prepfrancais') ? resolvedTitle : `${resolvedTitle} | prepfrancais`)
      : DEFAULTS.title;
    const desc = resolvedDesc || DEFAULTS.description;
    /* One language, one address per page. */
    const url = SITE_URL + (path || pathname);
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
    setMeta('property', 'og:locale', 'en_CA');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', desc);
    setMeta('name', 'twitter:image', img);

    clearHreflang();

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
  }, [resolvedTitle, resolvedDesc, path, pathname, image, type, jsonLd, noindex]);
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
