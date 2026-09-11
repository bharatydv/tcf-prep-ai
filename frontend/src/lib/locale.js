/* Which language a URL is in, and how to get to the other one.
 *
 * English is unprefixed and French lives under /fr. That asymmetry is
 * deliberate: every URL this site has ever had indexed is unprefixed, and
 * moving them all to /en would trade a known ranking for a redirect chain and
 * a recovery period. Adding /fr costs nothing that already exists.
 *
 * Routing is done with <BrowserRouter basename>, not with a prefix on each of
 * the sixty route declarations. The consequence worth knowing: inside the
 * router, every path is ALREADY relative to the locale. useLocation() on
 * /fr/pricing returns "/pricing", and <Link to="/pricing"> from a French page
 * goes to /fr/pricing on its own. So internal links stay inside their locale
 * without a single call site changing, and the only code that has to think
 * about the prefix is this file, the <Seo> tags, and the language toggle.
 *
 * No dependencies on purpose: App.js needs the locale before <I18nProvider>
 * mounts, so this cannot reach into the i18n module.
 */

export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en', 'fr'];

/* The path segment a locale lives under. English is the bare root. */
export function localePrefix(lang) {
  return lang === 'fr' ? '/fr' : '';
}

/* The locale a full pathname belongs to.
 *
 * Matches "/fr" and "/fr/..." and nothing else — "/french-guide" and
 * "/fr-something" are English pages whose slug happens to start the same way,
 * and treating either as French would serve a translated shell over English
 * content at a URL that has no French version.
 */
export function localeFromPath(pathname = '/') {
  return (pathname === '/fr' || pathname.startsWith('/fr/')) ? 'fr' : 'en';
}

/* The path with its locale prefix taken off, always starting with "/".
 * "/fr/pricing" -> "/pricing", "/fr" -> "/", "/pricing" -> "/pricing". */
export function stripLocale(pathname = '/') {
  if (localeFromPath(pathname) !== 'fr') return pathname || '/';
  return pathname.slice(3) || '/';
}

/* The same page in another language. Takes a path WITHOUT a prefix — which is
   what useLocation() hands you inside the router — and returns an absolute
   one. */
export function pathForLocale(lang, routePath = '/') {
  const clean = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const prefixed = `${localePrefix(lang)}${clean}`;
  // "/fr/" would be a second URL for "/fr" — one page, two addresses.
  return prefixed.length > 1 && prefixed.endsWith('/')
    ? prefixed.slice(0, -1)
    : prefixed;
}

/* What <BrowserRouter basename> should be for the URL currently open.
 * undefined rather than "" — an empty basename makes react-router warn. */
export function basenameFor(pathname) {
  return localeFromPath(pathname) === 'fr' ? '/fr' : undefined;
}

export default localeFromPath;
