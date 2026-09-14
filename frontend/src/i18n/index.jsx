/* Minimal interface dictionary.
 *
 * The site is English-only. This used to carry a second French dictionary and
 * a locale-routed shell; both are gone. The audience is learning French, not
 * reading French, so a translated interface bought nothing and cost a second
 * copy of every string to keep in step — and a second set of URLs for search
 * engines to treat as duplicates of the first.
 *
 * Why a dictionary at all, rather than literals in the components: the copy is
 * long-form marketing prose, it is edited far more often than the components
 * around it, and keeping it in one file is what lets that happen without
 * touching JSX. {{var}} interpolation is the only feature it needs.
 *
 * Usage:
 *   const t = useT();
 *   t('write.analyse')                     -> "Analyse my text"
 *   t('words.count', { n: 12 })            -> "12 words"
 *
 * Rules:
 *  - Interface text goes through t() and is written in English.
 *  - French stays where it carries meaning the English does not: the exam's
 *    own vocabulary (tâche, consigne, expression écrite/orale), and all exam
 *    material — consignes, model answers, the learner's own French, and the
 *    corrections themselves. That is the exam; translating it would change
 *    what is being practised.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.json';

/* The active dictionary. Module-level rather than state: it is written once at
   import and then only ever extended with a namespace, and the `loaded`
   counter below is what re-renders consumers when that happens. */
const DICTS = { en };

/* Namespaces kept OUT of en.json and fetched with the page that uses them.
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
  tcfCanada: () => import(/* webpackChunkName: "ns-tcf-en" */ './en.tcfCanada.json'),
};

/* "a{{n}}b" -> "a12b". Missing vars are left visible rather than blanked, so a
   broken string is obvious in review instead of silently losing information. */
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    (vars[key] === undefined || vars[key] === null ? match : String(vars[key])));
}

/* Long-form date. Kept here rather than in each page so every screen agrees on
   one format. */
export function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(value).slice(0, 10); }
}

/* Dotted lookup: 'write.analyse' -> dict.write.analyse */
function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  /* Bumped once a namespace lands, to re-render with the newly available
     strings. DICTS itself is a module-level cache, not state. */
  const [loaded, setLoaded] = useState('');

  /* Pull a split-out namespace into the dictionary.
   *
   * Idempotent and safe to call from several components at once: the check
   * against the already-merged dictionary is what stops a second fetch, and
   * webpack dedupes concurrent imports of the same chunk anyway.
   *
   * DICTS.en is replaced rather than mutated, so the `loaded` bump below is
   * what re-renders consumers — mutating in place would leave every t() call
   * returning the old answer until something else happened to re-render. */
  const loadNamespace = useCallback(async (name) => {
    const load = NAMESPACE_LOADERS[name];
    if (!load) return true;
    if (DICTS.en[name]) return true;
    try {
      const mod = await load();
      DICTS.en = { ...DICTS.en, [name]: mod.default || mod };
      setLoaded(`en.${name}`);
      return true;
    } catch {
      // A failed chunk must not wedge the page that asked for it. The strings
      // will be missing; the page still renders and can be retried by a
      // reload, which is better than a permanent spinner.
      return false;
    }
  }, []);

  const t = useCallback((key, vars) => {
    const hit = lookup(DICTS.en, key);
    if (typeof hit === 'string') return interpolate(hit, vars);
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
    // `loaded` is in the dependency list on purpose: it is how a namespace
    // arriving asynchronously re-renders every consumer of t().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const value = useMemo(() => ({ t, loadNamespace }), [t, loadNamespace]);

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
 * Returns false until the namespace is in the dictionary. A caller MUST honour
 * that — rendering anyway means every one of its t() calls returns a raw key on
 * the first paint, and on a prerendered page that key is what gets captured
 * into the static HTML.
 */
export function useNamespace(name) {
  const { loadNamespace } = useI18n();
  const [ready, setReady] = useState(() => Boolean(DICTS.en[name]));

  useEffect(() => {
    if (DICTS.en[name]) { setReady(true); return undefined; }
    let cancelled = false;
    setReady(false);
    loadNamespace(name).then((ok) => { if (!cancelled) setReady(ok); });
    return () => { cancelled = true; };
  }, [name, loadNamespace]);

  return ready;
}
