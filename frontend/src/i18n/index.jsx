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

/* Loaded dictionaries. English is always present; others arrive on demand and
   are cached here so switching back and forth costs one fetch each, not one
   per toggle. */
const DICTS = { en };

const LOADERS = {
  en: () => Promise.resolve(en),
  fr: () => import(/* webpackChunkName: "locale-fr" */ './fr.json').then((m) => m.default || m),
};

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fr', label: 'FR', name: 'Français' },
];

const STORAGE_KEY = 'monfrancais.lang';

/* Browser French of any region (fr, fr-CA, fr-FR) starts in French; everyone
   else starts in English, which is the safer default for an audience that is
   learning French rather than already speaking it. */
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

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage);
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

  const setLang = useCallback((next) => {
    if (!LOADERS[next]) return;
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* non-fatal */ }
  }, []);

  // Screen readers and browser translation prompts both key off this.
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

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

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

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
