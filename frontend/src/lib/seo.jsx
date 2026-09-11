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
import { LOCALES, pathForLocale } from './locale';

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
  /* Does this page exist in both languages?
   *
   * True for anything whose copy comes out of the i18n dictionaries — the
   * marketing pages, the guides, the legal set. False for content that exists
   * in one language only, chiefly blog posts and exam material: those render
   * the same body whichever shell wraps them, so claiming a French version
   * would point hreflang at a translation that does not exist. A page like
   * that canonicalises to its unprefixed URL from either locale, which
   * collapses the duplicate instead of advertising it.
   */
  localized = true,
} = {}) {
  const { t, lang } = useI18n();
  /* Inside the router this is ALREADY the path without its locale prefix —
     basename strips it — so /fr/pricing arrives here as "/pricing". That is
     what makes one path build both locales' URLs below. */
  const { pathname } = useLocation();

  const resolvedTitle = titleKey ? t(titleKey) : title;
  const resolvedDesc = descKey ? t(descKey) : description;

  useEffect(() => {
    const fullTitle = resolvedTitle
      ? (resolvedTitle.includes('prepfrancais') ? resolvedTitle : `${resolvedTitle} | prepfrancais`)
      : DEFAULTS.title;
    const desc = resolvedDesc || DEFAULTS.description;
    const routePath = path || pathname;
    /* A single-language page has one address, and it is the unprefixed one.
       A translated page's canonical is its own locale's URL. */
    const url = SITE_URL + (localized ? pathForLocale(lang, routePath) : routePath);
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

    /* hreflang. Every translated page names every version of itself,
       including itself — a reciprocal set is what makes search engines trust
       it, and a page that omits its own entry is a common reason the whole
       cluster is ignored.

       x-default points at English: it is what a visitor with no matching
       language preference should land on, and it is the URL that already
       ranks.

       Cleared first rather than updated in place, so navigating from a
       translated page to a single-language one cannot leave the previous
       page's alternates behind — which would tell a crawler that a blog post
       has a French translation at a URL serving the same English text. */
    clearHreflang();
    if (localized) {
      LOCALES.forEach((code) => {
        setLink('alternate', SITE_URL + pathForLocale(code, routePath),
                { hreflang: code });
      });
      setLink('alternate', SITE_URL + pathForLocale('en', routePath),
              { hreflang: 'x-default' });
    }

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
  }, [resolvedTitle, resolvedDesc, path, pathname, image, type, jsonLd,
      noindex, lang, localized]);
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
export function breadcrumbSchema(trail, lang = 'en') {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, p], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      // Locale-aware: a French breadcrumb naming the English URLs would send
      // a crawler out of the locale it is reading.
      item: SITE_URL + pathForLocale(lang, p),
    })),
  };
}

export default Seo;
