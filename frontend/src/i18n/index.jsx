/* Minimal two-language i18n.
 *
 * Why not i18next: this project is pinned to TypeScript 4.9.5 by CRA 5, and
 * current i18next requires a TS 5+ peer. Forcing it with --legacy-peer-deps
 * would leave a broken resolution in the tree for whoever installs next. Two
 * locales with {{var}} interpolation do not need 40 kB of library.
 *
 * Loading: English is bundled statically because it is also the fallback for
 * any key missing from another dictionary. French is fetched with a dynamic
 * import, so an English-speaking visitor never downloads it — the two files
 * are ~117 kB of raw JSON between them and both used to sit in the entry
 * chunk. The provider holds its children back until the active dictionary has
 * arrived, so a French visitor never sees a frame of English first.
 *
 * Usage:
 *   const { t, lang, setLang } = useI18n();
 *   t('write.analyse')                     -> "Analyse my text"
 *   t('words.count', { n: 12 })            -> "12 words"
 *
 * Rules:
 *  - Interface text goes through t().
 *  - Exam material (consignes, model answers, the learner's own French, and
 *    the corrections themselves) is NEVER translated — it is the exam.
 *  - AI explanations stay English by product decision; the French examples
 *    inside them stay French.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.json';
import { pathForLocale, stripLocale } from '../lib/locale';

/* Loaded dictionaries. English is always present; others arrive on demand and
   are cached here so switching back and forth costs one fetch each, not one
   per toggle. */
const DICTS = { en };

const LOADERS = {
  en: () => Promise.resolve(en),
  fr: () => import(/* webpackChunkName: "locale-fr" */ './fr.json').then((m) => m.default || m),
};

/* Namespaces kept OUT of the dictionaries above and fetched with the page that
 * uses them.
 *
 * A JSON import is all-or-nothing: webpack does not tree-shake object keys, so
 * every string in en.json ships in the entry chunk whether or not anything on
 * the landing page reads it. `tcfCanada` alone was 58 kB of a 156 kB
 * dictionary — fifteen marketing pages' copy, downloaded before anyone saw the
 * first screen. It is the only namespace big enough to be worth the machinery;
 * the next largest is 7 kB, which is not worth a loading state.
 *
 * Adding one here means the page that uses it MUST call useNamespace() and
 * hold its render until that resolves, or its strings render blank.
 */
const NAMESPACE_LOADERS = {
  tcfCanada: {
    en: () => import(/* webpackChunkName: "ns-tcf-en" */ './en.tcfCanada.json'),
    fr: () => import(/* webpackChunkName: "ns-tcf-fr" */ './fr.tcfCanada.json'),
  },
};

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fr', label: 'FR', name: 'Français' },
];

const STORAGE_KEY = 'prepfrancais.lang';

/* Browser French of any region (fr, fr-CA, fr-FR) starts in French; everyone
   else starts in English, which is the safer default for an audience that is
   learning French rather than already speaking it.

   Only consulted when the URL does not say. Since locale routing landed, the
   address is the authority: /fr/pricing is French and /pricing is English, for
   everybody, including a returning visitor whose last choice was the other
   one. Two reasons it has to work that way — a shared link must open in the
   language it was shared in, and a page whose content does not match its own
   canonical URL is the exact duplicate-content problem hreflang exists to
   solve. The toggle is one click away, and it remembers. */
export function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOADERS[saved]) return saved;
  } catch { /* storage blocked (private mode) — fall through to detection */ }
  const navLangs = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  return navLangs.some((l) => l.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

/* "a{{n}}b" -> "a12b". Missing vars are left visible rather than blanked, so a
   broken string is obvious in review instead of silently losing information. */
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    (vars[key] === undefined || vars[key] === null ? match : String(vars[key])));
}

/* Long-form date in the active language. Kept here rather than in each page so
   a French UI never renders "August 9, 2026". fr-CA over fr-FR to match the
   Canadian audience the product targets. */
export function formatDate(value, lang) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(value).slice(0, 10); }
}

/* Dotted lookup: 'write.analyse' -> dict.write.analyse */
function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

const I18nContext = createContext(null);

export function I18nProvider({ children, initialLang }) {
  // The URL wins. detectLanguage() is the fallback for a path that carries no
  // locale of its own, which today means every English page.
  const [lang, setLangState] = useState(
    () => (LOADERS[initialLang] ? initialLang : detectLanguage()));
  // Bumped once a dictionary lands, to re-render with the newly available
  // strings. DICTS itself is a module-level cache, not state.
  const [loaded, setLoaded] = useState(() => Object.keys(DICTS).join(','));

  const ready = Boolean(DICTS[lang]);

  useEffect(() => {
    if (DICTS[lang]) return;
    let cancelled = false;
    (LOADERS[lang] || LOADERS.en)()
      .then((dict) => {
        if (cancelled) return;
        DICTS[lang] = dict;
        setLoaded(Object.keys(DICTS).join(','));
      })
      .catch(() => {
        // A failed chunk must not strand the app on a blank screen: fall back
        // to English rather than never becoming ready.
        if (!cancelled) setLangState('en');
      });
    return () => { cancelled = true; };
  }, [lang]);

  /* Switching language is a NAVIGATION, not a state change.
   *
   * The locale lives in the URL and <BrowserRouter basename> reads it once, at
   * mount, so flipping `lang` in place would leave a French page sitting at an
   * English address — every link on it wrong, its canonical lying, and the
   * address bar unshareable. A full load to the other locale's URL is the
   * honest move, and on a prerendered page it is a cheap one.
   *
   * The choice is still stored: it is what a later visit to a locale-less
   * entry point reads.
   */
  const setLang = useCallback((next) => {
    if (!LOADERS[next]) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* non-fatal */ }
    if (next === lang) return;
    const route = stripLocale(window.location.pathname);
    window.location.assign(
      pathForLocale(next, route) + window.location.search + window.location.hash);
  }, [lang]);

  // Screen readers and browser translation prompts both key off this.
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  /* Pull a split-out namespace into the active dictionary.
   *
   * Idempotent and safe to call from several components at once: the check
   * against the already-merged dictionary is what stops a second fetch, and
   * webpack dedupes concurrent imports of the same chunk anyway.
   *
   * DICTS is replaced rather than mutated for the language being extended, so
   * the `loaded` bump below is what re-renders consumers — mutating in place
   * would leave every t() call returning the old answer until something else
   * happened to re-render. */
  const loadNamespace = useCallback(async (name) => {
    const loaders = NAMESPACE_LOADERS[name];
    if (!loaders) return true;
    if (DICTS[lang] && DICTS[lang][name]) return true;
    const load = loaders[lang] || loaders.en;
    try {
      const mod = await load();
      DICTS[lang] = { ...DICTS[lang], [name]: mod.default || mod };
      setLoaded(`${Object.keys(DICTS).join(',')}:${lang}.${name}`);
      return true;
    } catch {
      // A failed chunk must not wedge the page that asked for it. The strings
      // will be missing; the page still renders and can be retried by a
      // reload, which is better than a permanent spinner.
      return false;
    }
  }, [lang]);

  const t = useCallback((key, vars) => {
    const hit = lookup(DICTS[lang], key);
    if (typeof hit === 'string') return interpolate(hit, vars);
    // Fall back to English before giving up, so a gap in fr.json degrades to
    // readable English rather than a raw key.
    const fallback = lookup(DICTS.en, key);
    if (typeof fallback === 'string') return interpolate(fallback, vars);
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
    // `loaded` is in the dependency list on purpose: it is how a dictionary
    // arriving asynchronously re-renders every consumer of t().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, loaded]);

  const value = useMemo(() => ({ lang, setLang, t, loadNamespace }),
    [lang, setLang, t, loadNamespace]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white" role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
      </div>
    );
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/* Shorthand for the common case of only needing the translator. */
export const useT = () => useI18n().t;

/* Wait for a split-out namespace before rendering strings from it.
 *
 * Returns false until the namespace is in the active dictionary. A caller MUST
 * honour that — rendering anyway means every one of its t() calls returns a
 * raw key on the first paint, and on a prerendered page that key is what gets
 * captured into the static HTML.
 *
 * Re-runs on a language change, because the dictionary that just became
 * active has not got the namespace yet.
 */
export function useNamespace(name) {
  const { lang, loadNamespace } = useI18n();
  const [ready, setReady] = useState(
    () => Boolean(DICTS[lang] && DICTS[lang][name]));

  useEffect(() => {
    if (DICTS[lang] && DICTS[lang][name]) { setReady(true); return undefined; }
    let cancelled = false;
    setReady(false);
    loadNamespace(name).then((ok) => { if (!cancelled) setReady(ok); });
    return () => { cancelled = true; };
  }, [lang, name, loadNamespace]);

  return ready;
}
