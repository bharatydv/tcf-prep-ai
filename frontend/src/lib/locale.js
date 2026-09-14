/* What to do with the /fr URLs that used to exist.
 *
 * The site had a French interface under /fr for one release. It is gone: the
 * audience is learning French rather than reading it, so the second locale
 * doubled the copy to maintain and handed search engines a second address for
 * every page. See i18n/index.jsx for what stayed French — the exam material,
 * which is the exam.
 *
 * What survives here is the clean-up. Those addresses were linked, shared and
 * submitted in a sitemap, so answering them with a 404 would throw away
 * whatever reached them. frontend/nginx.conf issues a real 301 where it is the
 * server in front of the app; this is the client-side twin, for a deploy where
 * some other proxy hands every path to index.html untouched.
 *
 * No dependencies on purpose: this runs before React mounts.
 */

/* The English address for a legacy French one, or null if the path is already
 * English.
 *
 * Matches "/fr" and "/fr/..." and nothing else — "/french-guide" and
 * "/fr-tcf" are English pages whose slug happens to start the same way, and
 * redirecting either would break a live URL.
 */
export function legacyLocalePath(pathname = '/') {
  if (pathname !== '/fr' && !pathname.startsWith('/fr/')) return null;
  return pathname.slice(3) || '/';
}

/* Send a visitor on a legacy /fr URL to the English page, replacing the entry
   in history so Back does not land them straight back on the redirect. Returns
   true if it redirected, so a caller can skip mounting the app. */
export function redirectLegacyLocale() {
  if (typeof window === 'undefined') return false;
  const target = legacyLocalePath(window.location.pathname);
  if (target === null) return false;
  window.location.replace(target + window.location.search + window.location.hash);
  return true;
}

export default legacyLocalePath;
