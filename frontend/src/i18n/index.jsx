/* Minimal two-language i18n.
 *
 * Why not i18next: this project is pinned to TypeScript 4.9.5 by CRA 5, and
 * current i18next requires a TS 5+ peer. Forcing it with --legacy-peer-deps
 * would leave a broken resolution in the tree for whoever installs next. Two
 * locales with {{var}} interpolation do not need 40 kB of library.
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
import fr from './fr.json';

const DICTS = { en, fr };
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
    if (saved && DICTS[saved]) return saved;
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

  const setLang = useCallback((next) => {
    if (!DICTS[next]) return;
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
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/* Shorthand for the common case of only needing the translator. */
export const useT = () => useI18n().t;
