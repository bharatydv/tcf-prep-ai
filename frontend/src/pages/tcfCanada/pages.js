/* The /tcf-canada landing family.
 *
 * Fifteen search-intent pages rendered by one template (../TcfCanada.jsx).
 * This module is the only place their structure is declared: paths, the visual
 * block each one gets, the numbers in its fact strip, where its buttons go and
 * which siblings it links to.
 *
 * Copy is NOT here. Every string lives under `tcfCanada.<k>.*` in i18n/en.json
 * and i18n/fr.json, keyed off the `k` below, so these pages translate like
 * the rest of the app instead of hard-coding English into the bundle.
 *
 * The numbers in `facts` are the official TCF Canada constraints and must
 * agree with lib/tcf.js (WRITING_TASKS / SPEAKING_TASKS), which mirrors the
 * grader in backend/server.py. If a duration or word range changes, it changes
 * in all three.
 *
 * Adding a page here is not enough to publish it. Three lists outside this
 * file must gain the same path:
 *   - tcfCanada/slugs.js            (so the router serves it — checked below)
 *   - scripts/generate-sitemap.js   (so it is submitted for indexing)
 *   - package.json -> reactSnap.include  (so it is prerendered to static HTML)
 */
import {
  Microphone, PenNib, Headphones, BookOpen, GraduationCap, Target,
  ClockCountdown, Compass, ChatCircleText, Question, Scales,
  EnvelopeSimple, Article, Notebook,
} from '@phosphor-icons/react';
import { TCF_CANADA_SLUGS } from './slugs';

/* Tone drives the hero glow, the fact strip and the visual block, so fifteen
   pages under one template do not read as one page fifteen times.

   Class names are written out rather than composed (`bg-${tone}-100`) because
   Tailwind scans source text for them: an interpolated name is never emitted
   into the stylesheet and the element ends up unstyled. */
const TONES = {
  violet: {
    grad: 'from-violet-100 via-fuchsia-50 to-violet-200',
    blobA: 'bg-fuchsia-300/30', blobB: 'bg-violet-400/25',
    chip: 'bg-violet-100 text-primary', ring: 'border-violet-100',
    soft: 'bg-violet-50/60', icon: 'from-primary to-fuchsia-600',
    text: 'text-primary', bar: 'from-primary to-fuchsia-500', hex: '#7C3AED',
  },
  fuchsia: {
    grad: 'from-fuchsia-100 via-violet-50 to-pink-200',
    blobA: 'bg-pink-300/30', blobB: 'bg-fuchsia-400/25',
    chip: 'bg-fuchsia-100 text-fuchsia-700', ring: 'border-fuchsia-100',
    soft: 'bg-fuchsia-50/60', icon: 'from-fuchsia-600 to-pink-500',
    text: 'text-fuchsia-700', bar: 'from-fuchsia-600 to-pink-500', hex: '#C026D3',
  },
  cyan: {
    grad: 'from-cyan-100 via-violet-50 to-sky-200',
    blobA: 'bg-sky-300/30', blobB: 'bg-cyan-400/25',
    chip: 'bg-cyan-100 text-cyan-700', ring: 'border-cyan-100',
    soft: 'bg-cyan-50/60', icon: 'from-cyan-600 to-violet-600',
    text: 'text-cyan-700', bar: 'from-cyan-500 to-violet-500', hex: '#0891B2',
  },
  emerald: {
    grad: 'from-emerald-100 via-violet-50 to-teal-200',
    blobA: 'bg-teal-300/30', blobB: 'bg-emerald-400/25',
    chip: 'bg-emerald-100 text-emerald-700', ring: 'border-emerald-100',
    soft: 'bg-emerald-50/60', icon: 'from-emerald-600 to-violet-600',
    text: 'text-emerald-700', bar: 'from-emerald-500 to-violet-500', hex: '#059669',
  },
  amber: {
    grad: 'from-amber-100 via-violet-50 to-orange-200',
    blobA: 'bg-orange-300/30', blobB: 'bg-amber-400/25',
    chip: 'bg-amber-100 text-amber-800', ring: 'border-amber-100',
    soft: 'bg-amber-50/60', icon: 'from-amber-500 to-fuchsia-600',
    text: 'text-amber-700', bar: 'from-amber-500 to-fuchsia-500', hex: '#D97706',
  },
};

export const tone = (name) => TONES[name] || TONES.violet;

/* The four sections of the paper, for the `sections` visual. Durations and
   question counts are the official ones; `to` is the landing page that covers
   that section in depth. */
export const EXAM_SECTIONS = [
  { k: 'listening', icon: Headphones, count: 39, minutes: 35, tone: 'cyan', to: '/tcf-canada-listening' },
  { k: 'reading', icon: BookOpen, count: 39, minutes: 60, tone: 'emerald', to: '/tcf-canada-reading' },
  { k: 'writing', icon: PenNib, count: 3, minutes: 60, tone: 'violet', to: '/tcf-canada-writing' },
  { k: 'speaking', icon: Microphone, count: 3, minutes: 12, tone: 'fuchsia', to: '/tcf-canada-speaking' },
];

/* NCLC <-> TCF Canada equivalence, as published by IRCC. Columns are
   [level, comprehension ecrite, expression ecrite, comprehension orale,
   expression orale] — the same order the landing page's table uses. */
export const NCLC_ROWS = [
  ['10+', '549 - 699', '16 - 20', '549 - 699', '16 - 20'],
  ['9', '524 - 548', '14 - 15', '524 - 548', '14 - 15'],
  ['8', '499 - 523', '12 - 13', '503 - 522', '12 - 13'],
  ['7', '453 - 498', '10 - 11', '458 - 502', '10 - 11'],
  ['6', '406 - 452', '7 - 9', '398 - 457', '7 - 9'],
  ['5', '375 - 405', '6 - 6', '369 - 397', '6 - 6'],
  ['4', '342 - 374', '4 - 5', '331 - 368', '4 - 5'],
];

/* Targets for the four rings on the NCLC 7 page: the minimum score for that
   level, drawn against the top of its scale. */
export const NCLC7_TARGETS = [
  { k: 'listening', icon: Headphones, value: 458, max: 699, unit: '/699', tone: 'cyan' },
  { k: 'reading', icon: BookOpen, value: 453, max: 699, unit: '/699', tone: 'emerald' },
  { k: 'writing', icon: PenNib, value: 10, max: 20, unit: '/20', tone: 'violet' },
  { k: 'speaking', icon: Microphone, value: 10, max: 20, unit: '/20', tone: 'fuchsia' },
];

export const PAGES = [
  /* -------------------------------------------------------------- pillar -- */
  {
    slug: 'tcf-canada', k: 'hub', icon: Compass, tone: 'violet',
    cta: ['/register', '/tcf-canada-practice'],
    facts: [['4', 'f1'], ['2 h 47', 'f2'], ['39 + 39', 'f3'], ['4 - 20', 'f4']],
    visual: 'sections', extra: 'nclc', family: 'all', tips: 4, faqs: 5,
    related: ['tcf-canada-practice', 'tcf-canada-mock-test', 'tcf-canada-nclc-7',
      'tcf-canada-speaking', 'tcf-canada-writing', 'tcf-canada-listening',
      'tcf-canada-reading', 'tcf-canada-exam-simulator'],
  },
  /* ---------------------------------------------------------- broad terms -- */
  {
    slug: 'tcf-canada-practice', k: 'practice', icon: Target, tone: 'violet',
    cta: ['/practice', '/speaking'],
    facts: [['4', 'f1'], ['6', 'f2'], ['3 + 3', 'f3'], ['0 $', 'f4']],
    visual: 'sections', family: 'all', tips: 4, faqs: 4,
    related: ['tcf-canada', 'tcf-canada-writing', 'tcf-canada-speaking',
      'tcf-canada-reading', 'tcf-canada-listening', 'tcf-canada-mock-test'],
  },
  {
    slug: 'tcf-canada-mock-test', k: 'mock', icon: GraduationCap, tone: 'emerald',
    cta: ['/reading/test', '/listening/test'],
    facts: [['39', 'f1'], ['60 min', 'f2'], ['39', 'f3'], ['35 min', 'f4']],
    visual: 'sections', family: 'mcq', tips: 4, faqs: 4,
    related: ['tcf-canada', 'tcf-canada-exam-simulator', 'tcf-canada-reading',
      'tcf-canada-listening', 'tcf-canada-practice', 'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-exam-simulator', k: 'sim', icon: ClockCountdown, tone: 'fuchsia',
    cta: ['/exam-simulator', '/practice/tasks'],
    facts: [['60 min', 'f1'], ['12 min', 'f2'], ['3', 'f3'], ['0', 'f4']],
    visual: 'timers', family: 'all', tips: 4, faqs: 4,
    related: ['tcf-canada', 'tcf-canada-mock-test', 'tcf-canada-speaking',
      'tcf-canada-writing', 'tcf-canada-practice', 'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-nclc-7', k: 'nclc7', icon: Scales, tone: 'amber',
    cta: ['/register', '/combinations'],
    facts: [['458 - 502', 'f1'], ['453 - 498', 'f2'], ['10 - 11', 'f3'], ['10 - 11', 'f4']],
    visual: 'targets', extra: 'nclc', family: 'all', tips: 4, faqs: 5,
    related: ['tcf-canada', 'tcf-canada-practice', 'tcf-canada-mock-test',
      'tcf-canada-writing', 'tcf-canada-speaking', 'tcf-canada-exam-simulator'],
  },
  /* --------------------------------------------------------------- skills -- */
  {
    slug: 'tcf-canada-speaking', k: 'speak', icon: Microphone, tone: 'fuchsia',
    cta: ['/speaking', '/speaking/test'],
    facts: [['12 min', 'f1'], ['3', 'f2'], ['4 min', 'f3'], ['4 - 20', 'f4']],
    visual: 'taskList', taskKind: 'speaking', family: 'speak', tips: 4, faqs: 4,
    related: ['tcf-canada-speaking-task-1', 'tcf-canada-speaking-task-2',
      'tcf-canada-speaking-task-3', 'tcf-canada', 'tcf-canada-exam-simulator',
      'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-writing', k: 'write', icon: PenNib, tone: 'violet',
    cta: ['/practice', '/practice/tasks'],
    facts: [['60 min', 'f1'], ['3', 'f2'], ['60 - 180', 'f3'], ['4 - 20', 'f4']],
    visual: 'taskList', taskKind: 'writing', family: 'write', tips: 4, faqs: 4,
    related: ['tcf-canada-writing-task-1', 'tcf-canada-writing-task-2',
      'tcf-canada-writing-task-3', 'tcf-canada', 'tcf-canada-exam-simulator',
      'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-listening', k: 'listen', icon: Headphones, tone: 'cyan',
    cta: ['/listening', '/listening/test'],
    facts: [['39', 'f1'], ['35 min', 'f2'], ['1', 'f3'], ['331 - 699', 'f4']],
    visual: 'skill', family: 'mcq', tips: 4, faqs: 4,
    related: ['tcf-canada', 'tcf-canada-reading', 'tcf-canada-mock-test',
      'tcf-canada-practice', 'tcf-canada-nclc-7', 'tcf-canada-speaking'],
  },
  {
    slug: 'tcf-canada-reading', k: 'read', icon: BookOpen, tone: 'emerald',
    cta: ['/reading', '/reading/practice'],
    facts: [['39', 'f1'], ['60 min', 'f2'], ['92 s', 'f3'], ['342 - 699', 'f4']],
    visual: 'skill', family: 'mcq', tips: 4, faqs: 4,
    related: ['tcf-canada', 'tcf-canada-listening', 'tcf-canada-mock-test',
      'tcf-canada-practice', 'tcf-canada-nclc-7', 'tcf-canada-writing'],
  },
  /* --------------------------------------------- speaking, tache by tache -- */
  {
    slug: 'tcf-canada-speaking-task-1', k: 'speak1', icon: ChatCircleText, tone: 'fuchsia',
    cta: ['/speaking/tasks', '/speaking/themes'],
    facts: [['2 min', 'f1'], ['0 s', 'f2'], ['1 / 3', 'f3'], ['0', 'f4']],
    visual: 'speakSpec', task: 1, family: 'speak', tips: 4, faqs: 4,
    related: ['tcf-canada-speaking', 'tcf-canada-speaking-task-2',
      'tcf-canada-speaking-task-3', 'tcf-canada-exam-simulator', 'tcf-canada',
      'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-speaking-task-2', k: 'speak2', icon: Question, tone: 'fuchsia',
    cta: ['/speaking/tasks', '/speaking/themes'],
    facts: [['3 min 30', 'f1'], ['2 min', 'f2'], ['2 / 3', 'f3'], ['5 - 8', 'f4']],
    visual: 'speakSpec', task: 2, family: 'speak', tips: 4, faqs: 4,
    related: ['tcf-canada-speaking', 'tcf-canada-speaking-task-1',
      'tcf-canada-speaking-task-3', 'tcf-canada-exam-simulator', 'tcf-canada',
      'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-speaking-task-3', k: 'speak3', icon: Scales, tone: 'fuchsia',
    cta: ['/speaking/tasks', '/speaking/themes'],
    facts: [['2 min 30', 'f1'], ['2 min', 'f2'], ['3 / 3', 'f3'], ['1', 'f4']],
    visual: 'speakSpec', task: 3, family: 'speak', tips: 4, faqs: 4,
    related: ['tcf-canada-speaking', 'tcf-canada-speaking-task-1',
      'tcf-canada-speaking-task-2', 'tcf-canada-exam-simulator', 'tcf-canada',
      'tcf-canada-nclc-7'],
  },
  /* ---------------------------------------------- writing, tache by tache -- */
  {
    slug: 'tcf-canada-writing-task-1', k: 'write1', icon: EnvelopeSimple, tone: 'violet',
    cta: ['/practice/tasks', '/practice/themes'],
    facts: [['60 - 120', 'f1'], ['15 min', 'f2'], ['1 / 3', 'f3'], ['4 - 20', 'f4']],
    visual: 'writeSpec', task: 1, family: 'write', tips: 4, faqs: 4,
    related: ['tcf-canada-writing', 'tcf-canada-writing-task-2',
      'tcf-canada-writing-task-3', 'tcf-canada-exam-simulator', 'tcf-canada',
      'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-writing-task-2', k: 'write2', icon: Article, tone: 'violet',
    cta: ['/practice/tasks', '/practice/themes'],
    facts: [['120 - 150', 'f1'], ['20 min', 'f2'], ['2 / 3', 'f3'], ['4 - 20', 'f4']],
    visual: 'writeSpec', task: 2, family: 'write', tips: 4, faqs: 4,
    related: ['tcf-canada-writing', 'tcf-canada-writing-task-1',
      'tcf-canada-writing-task-3', 'tcf-canada-exam-simulator', 'tcf-canada',
      'tcf-canada-nclc-7'],
  },
  {
    slug: 'tcf-canada-writing-task-3', k: 'write3', icon: Notebook, tone: 'violet',
    cta: ['/practice/tasks', '/practice/themes'],
    facts: [['120 - 180', 'f1'], ['25 min', 'f2'], ['3 / 3', 'f3'], ['4 - 20', 'f4']],
    visual: 'writeSpec', task: 3, family: 'write', tips: 4, faqs: 4,
    related: ['tcf-canada-writing', 'tcf-canada-writing-task-1',
      'tcf-canada-writing-task-2', 'tcf-canada-exam-simulator', 'tcf-canada',
      'tcf-canada-nclc-7'],
  },
];

export const BY_SLUG = PAGES.reduce((acc, p) => { acc[p.slug] = p; return acc; }, {});

/* The routes are declared from slugs.js, which cannot import this file (see
   the note at the top of it). Nothing else keeps the two in step, so say so
   loudly the first time a developer renders the app after adding one and not
   the other. Stripped from the production build with the rest of the dev-only
   branches. */
if (process.env.NODE_ENV === 'development') {
  const routed = new Set(TCF_CANADA_SLUGS);
  const configured = new Set(PAGES.map((p) => p.slug));
  const missingRoute = PAGES.filter((p) => !routed.has(p.slug)).map((p) => p.slug);
  const missingConfig = TCF_CANADA_SLUGS.filter((s) => !configured.has(s));
  if (missingRoute.length) console.error('[tcf-canada] configured but not routed — add to slugs.js:', missingRoute);
  if (missingConfig.length) console.error('[tcf-canada] routed but not configured — add to pages.js:', missingConfig);
}

export { TCF_CANADA_SLUGS };
export default PAGES;
