/* One template, fifteen TCF Canada landing pages.
 *
 * App.js mounts this once per entry in tcfCanada/pages.js and passes the slug.
 * Everything that differs between the pages — headline, fact strip, which
 * visual block sits beside the explainer, which siblings it links to — comes
 * from that config plus the `tcfCanada.*` dictionary. Nothing is hard-coded here.
 *
 * Why one template rather than fifteen files: the pages share a funnel (read,
 * understand the constraint, start the matching drill) and the differences are
 * data, not layout. Fifteen copies would mean fifteen places to fix the next
 * accessibility or metadata bug.
 *
 * What makes each page worth indexing separately is the copy and the visual
 * block, not the shell: a crawler that finds fifteen pages with one paragraph
 * changed treats them as one page. Each `tcfCanada.<k>` section is written to stand
 * on its own.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle, ArrowRight, CaretRight, House, Timer, Microphone,
  PenNib, RocketLaunch, Sparkle, ArrowUpRight,
  Gauge, MagnifyingGlass, ArrowsClockwise, Ruler, Article, Waveform,
  ChatCircleText, SealCheck, Lightbulb, ClockCountdown,
} from '@phosphor-icons/react';
import { Reveal, ScoreRing, Faq, useInView } from '../components/landing';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { Seo, SITE_URL, breadcrumbSchema } from '../lib/seo';
import { track } from '../lib/api';
import { WRITING_TASKS, SPEAKING_TASKS, fmtClock } from '../lib/tcf';
import NotFound from './NotFound';
import { BY_SLUG, EXAM_SECTIONS, NCLC_ROWS, NCLC7_TARGETS, tone as toneOf } from './tcfCanada/pages';

/* Little helper so a page's own namespace reads as `p('h1')` rather than
   `t(\`tcfCanada.${k}.h1\`)` forty times over. */
const scoped = (t, k) => (key, vars) => t(`tcfCanada.${k}.${key}`, vars);

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

/* One icon per "what you get" card, per family. Three identical check marks in
   a row said nothing; these at least name what each card is about. Keyed to
   the same families as tcfCanada.fam.* in the dictionary. */
const FEATURE_ICONS = {
  all: [Gauge, MagnifyingGlass, ArrowsClockwise],
  write: [Ruler, MagnifyingGlass, Article],
  speak: [Timer, Waveform, ChatCircleText],
  mcq: [SealCheck, Lightbulb, ClockCountdown],
};

/* ========================================================= visual blocks == */

/* The four papers, on the pages that talk about the exam as a whole. Each card
   is a link, which is also how the pillar page passes authority to the four
   skill pages. */
function SectionsVisual({ t }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {EXAM_SECTIONS.map((s, i) => {
        const c = toneOf(s.tone);
        const Icon = s.icon;
        const isTask = s.k === 'writing' || s.k === 'speaking';
        return (
          <Reveal key={s.k} delay={i * 70}>
            <Link to={s.to}
              className={`tilt-card flex h-full flex-col rounded-2xl border ${c.ring} bg-white p-4 shadow-soft`}>
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.icon} text-white`}>
                <Icon size={19} weight="fill" />
              </span>
              <p className="mt-3 font-heading text-sm font-bold text-gray-900">{t(`tcfCanada.sec.${s.k}`)}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{t(`tcfCanada.sec.${s.k}Fmt`)}</p>
              {/* Number over label, in its own tinted cell. Side by side with
                  the labels on top they ran straight into each other at card
                  width — "QUESTIONSDURATION". `order` needs a flex parent to
                  do anything, hence flex-col on each cell. */}
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div className="flex flex-col rounded-lg bg-gray-50 px-2.5 py-2">
                  <dt className="order-2 mt-0.5 text-[9px] uppercase tracking-wider text-gray-400">
                    {t(isTask ? 'tcfCanada.ui.tasks' : 'tcfCanada.ui.questions')}
                  </dt>
                  <dd className={`order-1 font-heading text-lg font-extrabold leading-none ${c.text}`}>{s.count}</dd>
                </div>
                <div className="flex flex-col rounded-lg bg-gray-50 px-2.5 py-2">
                  <dt className="order-2 mt-0.5 text-[9px] uppercase tracking-wider text-gray-400">{t('tcfCanada.ui.duration')}</dt>
                  <dd className="order-1 font-heading text-lg font-extrabold leading-none text-gray-900">{s.minutes}<span className="text-xs font-bold text-gray-400"> min</span></dd>
                </div>
              </dl>
            </Link>
          </Reveal>
        );
      })}
    </div>
  );
}

/* Speaking or writing, tache by tache, each row linking to the page that
   covers it. The numbers come from lib/tcf.js so they cannot disagree with the
   timers and word counters the learner meets in the app. */
function TaskListVisual({ t, kind, c }) {
  const rows = kind === 'speaking'
    ? [1, 2, 3].map((n) => ({
      n,
      to: `/tcf-canada-speaking-task-${n}`,
      meta: SPEAKING_TASKS[n].prepSeconds
        ? `${fmtClock(SPEAKING_TASKS[n].prepSeconds)} + ${fmtClock(SPEAKING_TASKS[n].speakSeconds)}`
        : fmtClock(SPEAKING_TASKS[n].speakSeconds),
      metaLabel: SPEAKING_TASKS[n].prepSeconds ? t('tcfCanada.ui.prepThenSpeak') : t('tcfCanada.ui.speakOnly'),
    }))
    : [1, 2, 3].map((n) => ({
      n,
      to: `/tcf-canada-writing-task-${n}`,
      meta: `${WRITING_TASKS[n].minWords} - ${WRITING_TASKS[n].maxWords}`,
      metaLabel: t('tcfCanada.ui.wordsIn', { n: WRITING_TASKS[n].minutes }),
    }));
  const pre = kind === 'speaking' ? 's' : 'w';

  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <Reveal key={r.n} delay={i * 80} as="li">
          <Link to={r.to}
            className={`group flex items-center gap-3 rounded-2xl border ${c.ring} bg-white p-4 shadow-soft transition hover:shadow-lift sm:gap-4`}>
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${c.icon} font-heading text-base font-extrabold text-white`}>
              {r.n}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-heading text-sm font-bold text-gray-900">{t(`tcfCanada.tk.${pre}${r.n}n`)}</p>
              <p className="mt-0.5 text-xs leading-snug text-gray-500">{t(`tcfCanada.tk.${pre}${r.n}d`)}</p>
              {/* Narrow screens put the timing under the name. Kept beside it,
                  the shrink-0 meta column plus the badge and the caret pushed
                  the row ~190px past a 360px viewport and scrolled the page
                  sideways — the one layout in the family that did. */}
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 sm:hidden">
                <span className={`font-heading text-xs font-extrabold ${c.text}`}>{r.meta}</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400">{r.metaLabel}</span>
              </p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <p className={`font-heading text-sm font-extrabold ${c.text}`}>{r.meta}</p>
              <p className="text-[9px] uppercase tracking-wider text-gray-400">{r.metaLabel}</p>
            </div>
            <CaretRight size={16} weight="bold" className="shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        </Reveal>
      ))}
    </ol>
  );
}

/* Preparation and speaking time drawn to scale against the longest tache, so
   "2 minutes, no preparation" is something you see rather than read. */
function SpeakSpecVisual({ t, task, c }) {
  const [ref, inView] = useInView(0.4);
  const spec = SPEAKING_TASKS[task];
  const longest = Math.max(...Object.values(SPEAKING_TASKS).map((s) => s.prepSeconds + s.speakSeconds));
  const total = spec.prepSeconds + spec.speakSeconds;
  const bar = (seconds) => (inView ? `${(seconds / longest) * 100}%` : '0%');

  return (
    <div ref={ref} className={`rounded-3xl border ${c.ring} bg-white p-6 shadow-xl shadow-violet-200/40`}>
      <div className="flex items-baseline justify-between">
        <p className="font-heading text-sm font-bold text-gray-900">{t('tcfCanada.ui.onTheClock')}</p>
        <p className={`font-heading text-2xl font-extrabold ${c.text}`}>{fmtClock(total)}</p>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500">
            <span>{t('tcfCanada.ui.prep')}</span>
            <span className={spec.prepSeconds ? 'text-gray-800' : 'text-rose-500'}>
              {spec.prepSeconds ? fmtClock(spec.prepSeconds) : t('tcfCanada.ui.none')}
            </span>
          </div>
          <div className="mt-1.5 h-3 rounded-full bg-gray-100">
            <div className="grow-bar h-3 rounded-full bg-gradient-to-r from-gray-300 to-gray-400"
              style={{ width: bar(spec.prepSeconds) }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500">
            <span>{t('tcfCanada.ui.speaking')}</span>
            <span className="text-gray-800">{fmtClock(spec.speakSeconds)}</span>
          </div>
          <div className="mt-1.5 h-3 rounded-full bg-gray-100">
            <div className={`grow-bar h-3 rounded-full bg-gradient-to-r ${c.bar}`} style={{ width: bar(spec.speakSeconds) }} />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-3">
        <Microphone size={16} weight="fill" className={c.text} />
        <p className="text-[11px] leading-snug text-gray-600">{t('tcfCanada.ui.speakNote')}</p>
      </div>

      {/* The other two taches, to scale, so the tache in focus has a size. */}
      <p className="mt-5 text-[9px] uppercase tracking-wider text-gray-400">{t('tcfCanada.ui.against')}</p>
      <div className="mt-2 space-y-1.5">
        {[1, 2, 3].map((n) => {
          const s = SPEAKING_TASKS[n];
          const w = ((s.prepSeconds + s.speakSeconds) / longest) * 100;
          return (
            <div key={n} className="flex items-center gap-2">
              <span className={`w-8 shrink-0 text-[10px] font-bold ${n === task ? c.text : 'text-gray-400'}`}>T{n}</span>
              <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                <div className={`h-1.5 rounded-full ${n === task ? `bg-gradient-to-r ${c.bar}` : 'bg-gray-300'}`}
                  style={{ width: `${w}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-gray-400">
                {fmtClock(s.prepSeconds + s.speakSeconds)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* The word range as a band rather than two numbers: under it the grader caps
   the level, over it the mark suffers, and the shape says so at a glance. */
function WriteSpecVisual({ t, task, c }) {
  const [ref, inView] = useInView(0.4);
  const spec = WRITING_TASKS[task];
  const ceiling = 200; // a little past tache 3's 180, so the band is not flush right
  const left = (spec.minWords / ceiling) * 100;
  const width = ((spec.maxWords - spec.minWords) / ceiling) * 100;

  return (
    <div ref={ref} className={`rounded-3xl border ${c.ring} bg-white p-6 shadow-xl shadow-violet-200/40`}>
      <div className="flex items-baseline justify-between">
        <p className="font-heading text-sm font-bold text-gray-900">{t('tcfCanada.ui.wordRange')}</p>
        <p className={`font-heading text-2xl font-extrabold ${c.text}`}>{spec.minWords} - {spec.maxWords}</p>
      </div>

      <div className="mt-6">
        <div className="relative h-9 rounded-xl bg-gray-100">
          <div className="grow-bar absolute inset-y-0 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500"
            style={{ left: `${left}%`, width: inView ? `${width}%` : '0%' }} />
          <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-[10px] font-bold text-gray-400">0</span>
          <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-[10px] font-bold text-gray-400">{ceiling}</span>
        </div>
        <div className="mt-2 flex justify-between text-[10px] font-semibold">
          <span className="text-rose-500">{t('tcfCanada.ui.tooShort')}</span>
          <span className="text-emerald-600">{t('tcfCanada.ui.onTarget')}</span>
          <span className="text-amber-600">{t('tcfCanada.ui.tooLong')}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gray-50 p-4">
          <p className="text-[9px] uppercase tracking-wider text-gray-400">{t('tcfCanada.ui.suggested')}</p>
          <p className="mt-1 flex items-center gap-1.5 font-heading text-xl font-extrabold text-gray-900">
            <Timer size={18} weight="fill" className={c.text} /> {spec.minutes} min
          </p>
        </div>
        <div className="rounded-2xl bg-gray-50 p-4">
          <p className="text-[9px] uppercase tracking-wider text-gray-400">{t('tcfCanada.ui.ofTheHour')}</p>
          <p className="mt-1 font-heading text-xl font-extrabold text-gray-900">
            {Math.round((spec.minutes / 60) * 100)}<span className="text-xs font-bold text-gray-400"> %</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-2xl bg-gray-50 px-4 py-3">
        <PenNib size={16} weight="fill" className={`mt-0.5 shrink-0 ${c.text}`} />
        <p className="text-[11px] leading-snug text-gray-600">{t('tcfCanada.ui.writeNote')}</p>
      </div>
    </div>
  );
}

/* NCLC 7 as four targets rather than a row in a table: the number you need,
   drawn against the top of its own scale. */
function TargetsVisual({ t }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {NCLC7_TARGETS.map((s, i) => {
        const c = toneOf(s.tone);
        const Icon = s.icon;
        return (
          <Reveal key={s.k} delay={i * 80}>
            <div className={`flex h-full flex-col items-center rounded-3xl border ${c.ring} bg-white p-5 text-center shadow-soft`}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${c.icon} text-white`}>
                <Icon size={17} weight="fill" />
              </span>
              <p className="mt-3 font-heading text-xs font-bold text-gray-900">{t(`tcfCanada.sec.${s.k}`)}</p>
              <div className="mt-2">
                <ScoreRing value={s.value} max={s.max} size={84} label={s.unit}
                  caption={t('tcfCanada.ui.minimum')} to={c.hex} />
              </div>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

/* Where a page is about one paper rather than the whole exam: the pace it
   demands, plus three things the app does about it. */
function SkillVisual({ p, c, facts }) {
  return (
    <div className={`rounded-3xl border ${c.ring} bg-white p-6 shadow-xl shadow-violet-200/40`}>
      <p className="font-heading text-sm font-bold text-gray-900">{p('vTitle')}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">{p('vSub')}</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {facts.slice(0, 2).map(([value, key]) => (
          <div key={key} className={`rounded-2xl ${c.soft} p-4`}>
            <p className={`font-heading text-2xl font-extrabold ${c.text}`}>{value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{p(key)}</p>
          </div>
        ))}
      </div>
      <ul className="mt-5 space-y-3">
        {range(3).map((n) => (
          <li key={n} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-gray-600">
            <CheckCircle size={17} weight="fill" className={`mt-0.5 shrink-0 ${c.text}`} /> {p(`v${n}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* The simulator page: the two sittings side by side, with what is switched off
   during each. */
function TimersVisual({ t, p, c }) {
  const sittings = [
    { icon: PenNib, label: t('tcfCanada.sec.writing'), clock: '60:00', sub: t('tcfCanada.ui.sharedTimer') },
    { icon: Microphone, label: t('tcfCanada.sec.speaking'), clock: '12:00', sub: t('tcfCanada.ui.perTaskTimer') },
  ];
  return (
    <div className={`rounded-3xl border ${c.ring} bg-white p-6 shadow-xl shadow-violet-200/40`}>
      <p className="font-heading text-sm font-bold text-gray-900">{p('vTitle')}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">{p('vSub')}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {sittings.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-2xl bg-ink px-4 py-5 text-center"
              style={{ background: 'radial-gradient(320px 160px at 50% -20%, #2a1352 0%, #120822 60%)' }}>
              <Icon size={18} weight="fill" className="mx-auto text-fuchsia-400" />
              <p className="mt-2 font-heading text-3xl font-extrabold tabular-nums text-white">{s.clock}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-violet-300/70">{s.label}</p>
              <p className="mt-1 text-[10px] text-violet-300/50">{s.sub}</p>
            </div>
          );
        })}
      </div>
      <ul className="mt-5 space-y-3">
        {range(3).map((n) => (
          <li key={n} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-gray-600">
            <CheckCircle size={17} weight="fill" className={`mt-0.5 shrink-0 ${c.text}`} /> {p(`v${n}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Shared with the landing page in substance, not in code: this one highlights
   the NCLC row the page is about, which the landing table has no notion of. */
function NclcTable({ t, highlight }) {
  const cols = ['tcfCanada.ui.colLevel', 'tcfCanada.ui.colCompW', 'tcfCanada.ui.colExpW', 'tcfCanada.ui.colCompO', 'tcfCanada.ui.colExpO'];
  return (
    <div className="overflow-hidden rounded-3xl border border-violet-100 shadow-soft">
      <div className="overflow-x-auto bg-white" tabIndex={0} role="region" aria-label={t('tcfCanada.ui.nclcTable')}>
        <table className="w-full min-w-[560px] text-center text-sm">
          <caption className="sr-only">{t('tcfCanada.ui.nclcTable')}</caption>
          <thead>
            <tr className="bg-violet-50/70 text-xs font-bold text-gray-700">
              {cols.map((h) => <th key={h} scope="col" className="px-4 py-4">{t(h)}</th>)}
            </tr>
          </thead>
          <tbody>
            {NCLC_ROWS.map((row, i) => {
              const on = row[0] === highlight;
              return (
                <tr key={row[0]}
                  className={on ? 'bg-amber-50 font-semibold text-gray-900 ring-2 ring-inset ring-amber-300' : `text-gray-600 ${i % 2 ? 'bg-white' : 'bg-violet-50/40'}`}>
                  <th scope="row" className="px-4 py-3">
                    <span className={`inline-block min-w-[44px] rounded-lg border px-2 py-1 font-heading font-bold ${on ? 'border-amber-400 bg-amber-200 text-amber-900' : 'border-primary/40 bg-violet-100 text-primary'}`}>
                      {row[0]}
                    </span>
                  </th>
                  {row.slice(1).map((cell, k) => <td key={k} className="px-4 py-3 tabular-nums">{cell}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Visual({ page, p, t, c }) {
  switch (page.visual) {
    case 'sections': return <SectionsVisual t={t} />;
    case 'taskList': return <TaskListVisual t={t} kind={page.taskKind} c={c} />;
    case 'speakSpec': return <SpeakSpecVisual t={t} task={page.task} c={c} />;
    case 'writeSpec': return <WriteSpecVisual t={t} task={page.task} c={c} />;
    case 'targets': return <TargetsVisual t={t} />;
    case 'timers': return <TimersVisual t={t} p={p} c={c} />;
    case 'skill': return <SkillVisual p={p} c={c} facts={page.facts} />;
    default: return null;
  }
}

/* ================================================================ chrome == */

/* Appears once the hero's buttons have scrolled away. Landing pages lose the
   call to action exactly when someone has read enough to act on it. */
function StickyCta({ title, note, label, to }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 620);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div aria-hidden={!show}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-violet-100 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(124,58,237,0.35)] backdrop-blur transition-transform duration-300 sm:hidden ${show ? 'translate-y-0' : 'translate-y-full'}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-xs font-bold text-gray-900">{title}</p>
          <p className="truncate text-[10px] text-gray-500">{note}</p>
        </div>
        <Link to={to} tabIndex={show ? 0 : -1}
          className="btn-primary shrink-0 !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-4 !py-2 text-xs">
          {label} <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
    </div>
  );
}

function Crumbs({ trail }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
        {trail.map(([label, to], i) => (
          <li key={to} className="flex items-center gap-1.5">
            {i > 0 && <CaretRight size={11} weight="bold" className="text-gray-300" />}
            {i === trail.length - 1
              ? <span aria-current="page" className="font-semibold text-gray-700">{label}</span>
              : (
                <Link to={to} className="inline-flex items-center gap-1 transition hover:text-primary">
                  {i === 0 && <House size={11} weight="fill" />}{label}
                </Link>
              )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ================================================================== page == */

export default function TcfCanada({ slug }) {
  const page = BY_SLUG[slug];
  /* Routes come from slugs.js and the copy from pages.js; if the two ever
     disagree in a shipped build, a real 404 beats a half-rendered page that
     search engines would index as a soft one. */
  if (!page) return <NotFound />;
  return <TcfCanadaPage page={page} slug={slug} />;
}

function TcfCanadaPage({ page, slug }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const p = useMemo(() => scoped(t, page.k), [t, page.k]);
  const c = toneOf(page.tone);
  const Icon = page.icon;
  const path = `/${page.slug}`;
  const [primaryTo, secondaryTo] = page.cta;

  /* Which landing page brought someone in is the whole point of having
     fifteen of them, so the view is reported with its slug. */
  useEffect(() => { track('tcf_canada_view', { slug }); }, [slug]);

  /* Memoised for the same reason the landing page memoises its FAQ schema: the
     object is a dependency of useSeo's effect, and a fresh literal every render
     tears the ld+json out of <head> and rebuilds every meta tag with it. */
  const jsonLd = useMemo(() => {
    const trail = page.k === 'hub'
      ? [[t('tcfCanada.ui.home'), '/'], [p('crumb'), path]]
      : [[t('tcfCanada.ui.home'), '/'], [t('tcfCanada.hub.crumb'), '/tcf-canada'], [p('crumb'), path]];
    return [
      breadcrumbSchema(trail),
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        inLanguage: lang === 'fr' ? 'fr-CA' : 'en',
        url: SITE_URL + path,
        mainEntity: range(page.faqs).map((n) => ({
          '@type': 'Question',
          name: p(`q${n}`),
          acceptedAnswer: { '@type': 'Answer', text: p(`a${n}`) },
        })),
      },
    ];
  }, [t, p, lang, page.k, page.faqs, path]);

  const crumbs = page.k === 'hub'
    ? [[t('tcfCanada.ui.home'), '/'], [p('crumb'), path]]
    : [[t('tcfCanada.ui.home'), '/'], [t('tcfCanada.hub.crumb'), '/tcf-canada'], [p('crumb'), path]];

  return (
    <main className="overflow-x-clip bg-white pb-16 sm:pb-0">
      <Seo title={p('title')} description={p('desc')} path={path} jsonLd={jsonLd} />
      <Crumbs trail={crumbs} />

      {/* ============================================================= HERO */}
      <section className={`relative mt-3 bg-gradient-to-br ${c.grad}`}>
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className={`blob absolute -left-24 top-6 h-72 w-72 rounded-full ${c.blobA} blur-3xl`} />
          <div className={`blob absolute right-0 top-1/3 h-80 w-80 rounded-full ${c.blobB} blur-3xl`} style={{ animationDelay: '-5s' }} />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 lg:pb-16 lg:pt-14">
          <span className="hero-rise inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-700 shadow-sm backdrop-blur">
            <Icon size={14} weight="fill" className={c.text} /> {p('eyebrow')}
          </span>
          <h1 className="hero-rise mt-5 max-w-3xl font-heading text-[2rem] font-extrabold leading-[1.1] tracking-tight text-gray-900 sm:text-5xl"
            style={{ animationDelay: '0.1s' }}>
            {p('h1')}{' '}
            {/* The accent follows the page's tone, but the CTA buttons below stay
                brand violet on all fifteen: the accent says which page you are
                on, the action colour says which product you are in, and varying
                both stops the button reading as the button. */}
            <span className={`bg-gradient-to-r ${c.bar} bg-clip-text text-transparent`}>{p('h1b')}</span>
          </h1>
          <p className="hero-rise mt-5 max-w-2xl text-[15px] leading-relaxed text-gray-700" style={{ animationDelay: '0.2s' }}>
            {p('sub')}
          </p>
          <div className="hero-rise mt-7 flex flex-wrap items-center gap-3" style={{ animationDelay: '0.3s' }}>
            <Link to={primaryTo} data-testid="tcf-canada-primary-cta"
              className="btn-primary !bg-gradient-to-r !from-primary !to-fuchsia-600 !px-6 !py-3 shadow-lg shadow-violet-300/60 hover:!brightness-110">
              {p('cta1')} <ArrowRight size={16} weight="bold" />
            </Link>
            <Link to={secondaryTo} data-testid="tcf-canada-secondary-cta"
              className="btn-outline !border-white bg-white/80 !px-6 !py-3 backdrop-blur">
              {p('cta2')}
            </Link>
            {!user && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <Sparkle size={14} weight="fill" className={c.text} /> {t('tcfCanada.ui.freeChip')}
              </span>
            )}
          </div>
        </div>

        {/* fact strip — straddles the hero and the body */}
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <dl className="grid translate-y-6 grid-cols-2 gap-px overflow-hidden rounded-2xl bg-violet-100 shadow-lift lg:grid-cols-4">
            {page.facts.map(([value, key], i) => (
              <div key={key} className="flex flex-col bg-white px-4 py-4 text-center sm:px-5 sm:py-5">
                <dt className="order-2 mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{p(key)}</dt>
                <dd className={`order-1 font-heading text-xl font-extrabold sm:text-2xl ${i % 2 ? 'text-gray-900' : c.text}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="h-6" />
      </section>

      {/* ==================================================== WHAT IT IS + VISUAL */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        {/* min-w-0 on both children: a grid item's default min-width is auto,
            so a wide descendant raises the whole track above the container
            instead of being clamped by it. Without it the single mobile column
            grew to 438px inside a 328px content box and scrolled the page
            sideways — on the two pages whose visual is the tâche list. */}
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal className="min-w-0">
            <h2 className="font-heading text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl">{p('aboutTitle')}</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-gray-600">{p('about1')}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-gray-600">{p('about2')}</p>
            <ul className="mt-6 space-y-3">
              {range(3).map((n, i) => (
                <Reveal key={n} delay={i * 80} as="li" className="flex items-start gap-3 text-sm leading-relaxed text-gray-700">
                  <CheckCircle size={19} weight="fill" className={`mt-0.5 shrink-0 ${c.text}`} /> {p(`b${n}`)}
                </Reveal>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120} className="min-w-0"><Visual page={page} p={p} t={t} c={c} /></Reveal>
        </div>
      </section>

      {/* ============================================================ NCLC TABLE */}
      {page.extra === 'nclc' && (
        <section className="mx-auto max-w-5xl px-4 pt-16 sm:px-6">
          <Reveal>
            <h2 className="font-heading text-2xl font-extrabold text-gray-900 sm:text-3xl">{t('tcfCanada.ui.nclcTable')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">{t('tcfCanada.ui.nclcSub')}</p>
          </Reveal>
          <Reveal delay={100} className="mt-6">
            <NclcTable t={t} highlight={page.k === 'nclc7' ? '7' : null} />
          </Reveal>
          <p className="mt-3 text-xs text-gray-500">{t('tcfCanada.ui.nclcNote')}</p>
        </section>
      )}

      {/* =============================================================== WHAT YOU GET */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <Reveal>
          <h2 className="font-heading text-2xl font-extrabold text-gray-900 sm:text-3xl">{t(`tcfCanada.fam.${page.family}.title`)}</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">{t(`tcfCanada.fam.${page.family}.sub`)}</p>
        </Reveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {range(3).map((n, i) => {
            const FIcon = (FEATURE_ICONS[page.family] || FEATURE_ICONS.all)[n - 1];
            return (
            <Reveal key={n} delay={i * 90}>
              <div className={`tilt-card flex h-full flex-col rounded-3xl border ${c.ring} bg-white p-6 shadow-soft`}>
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${c.icon} text-white`}>
                  <FIcon size={20} weight="fill" />
                </span>
                <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t(`tcfCanada.fam.${page.family}.t${n}`)}</h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-gray-600">{t(`tcfCanada.fam.${page.family}.b${n}`)}</p>
              </div>
            </Reveal>
            );
          })}
        </div>
      </section>

      {/* ================================================================== STEPS */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className={`rounded-[2rem] ${c.soft} px-5 py-12 sm:px-10`}>
          <Reveal>
            <h2 className="text-center font-heading text-2xl font-extrabold text-gray-900 sm:text-3xl">{t('tcfCanada.ui.howTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-gray-600">{t(`tcfCanada.step.${page.family}.sub`)}</p>
          </Reveal>
          <ol className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {range(4).map((n, i) => (
              <Reveal key={n} delay={i * 90} as="li">
                <div className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-soft">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${c.icon} font-heading text-sm font-bold text-white`}>
                    {n}
                  </span>
                  <h3 className="mt-4 font-heading text-base font-bold text-gray-900">{t(`tcfCanada.step.${page.family}.t${n}`)}</h3>
                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-gray-600">{t(`tcfCanada.step.${page.family}.b${n}`)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* =================================================================== TIPS */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
          <Reveal>
            <h2 className="font-heading text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl">{p('tipsTitle')}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-gray-600">{p('tipsSub')}</p>
            <Link to={primaryTo} className="btn-primary mt-6 !bg-gradient-to-r !from-primary !to-fuchsia-600">
              {p('cta1')} <ArrowRight size={16} weight="bold" />
            </Link>
          </Reveal>
          <ul className="space-y-3">
            {range(page.tips).map((n, i) => (
              <Reveal key={n} delay={i * 70} as="li">
                <div className={`flex items-start gap-3.5 rounded-2xl border ${c.ring} bg-white p-4 shadow-soft`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${c.chip} font-heading text-xs font-extrabold`}>
                    {n}
                  </span>
                  <p className="text-sm leading-relaxed text-gray-700">{p(`tip${n}`)}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ==================================================================== FAQ */}
      <section className="mx-auto max-w-4xl px-4 pt-16 sm:px-6">
        <Reveal><h2 className="font-heading text-2xl font-extrabold text-gray-900 sm:text-3xl">{t('tcfCanada.ui.faqTitle')}</h2></Reveal>
        <div className="mt-7 space-y-3.5">
          {range(page.faqs).map((n, i) => (
            <Reveal key={n} delay={i * 70}><Faq q={p(`q${n}`)} a={p(`a${n}`)} /></Reveal>
          ))}
        </div>
      </section>

      {/* ================================================================ RELATED */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <Reveal>
          <h2 className="font-heading text-2xl font-extrabold text-gray-900 sm:text-3xl">{t('tcfCanada.ui.relatedTitle')}</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">{t('tcfCanada.ui.relatedSub')}</p>
        </Reveal>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {page.related.map((rel, i) => {
            const r = BY_SLUG[rel];
            if (!r) return null;
            const rc = toneOf(r.tone);
            const RIcon = r.icon;
            return (
              <Reveal key={rel} delay={i * 60}>
                <Link to={`/${rel}`}
                  className={`group flex h-full flex-col rounded-2xl border ${rc.ring} bg-white p-5 shadow-soft transition hover:shadow-lift hover:-translate-y-0.5`}>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${rc.icon} text-white`}>
                    <RIcon size={17} weight="fill" />
                  </span>
                  <p className="mt-3 font-heading text-sm font-bold text-gray-900">{t(`tcfCanada.${r.k}.crumb`)}</p>
                  <p className="mt-1.5 flex-1 text-xs leading-relaxed text-gray-500">{t(`tcfCanada.${r.k}.card`)}</p>
                  <span className={`mt-3 inline-flex items-center gap-1 text-[11px] font-bold ${rc.text}`}>
                    {t('tcfCanada.ui.readMore')}
                    <ArrowUpRight size={12} weight="bold" className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ================================================================ CTA BAND */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary via-purple-600 to-fuchsia-600 px-6 py-12 sm:px-12">
            <RocketLaunch size={90} weight="duotone" aria-hidden className="absolute -left-3 top-1/2 hidden -translate-y-1/2 rotate-12 text-white/25 sm:block" />
            <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6 text-center lg:flex-row lg:text-left">
              <div className="flex-1">
                <h2 className="font-heading text-2xl font-extrabold text-white sm:text-3xl">{p('ctaTitle')}</h2>
                <p className="mt-2 max-w-lg text-sm text-violet-100/90">{p('ctaBody')}</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-wrap justify-center gap-3">
                  <Link to={user ? '/dashboard' : '/register'} data-testid="tcf-canada-cta-trial"
                    className="rounded-xl bg-white px-6 py-3 font-heading text-sm font-bold text-primary shadow-lg transition hover:scale-105">
                    {user ? t('tcfCanada.ui.toDashboard') : t('tcfCanada.ui.startFree')}
                  </Link>
                  <Link to="/pricing"
                    className="rounded-xl border-2 border-white/70 px-6 py-3 font-heading text-sm font-bold text-white transition hover:bg-white/10">
                    {t('tcfCanada.ui.seePlans')}
                  </Link>
                </div>
                <p className="text-[11px] text-violet-100/70">{t('tcfCanada.ui.noCard')}</p>
              </div>
            </div>
          </div>
        </Reveal>
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-gray-500">
          {t('common.disclaimerLevels')}
        </p>
      </section>

      <StickyCta title={p('crumb')} note={t('tcfCanada.ui.freeChip')} label={p('cta1')} to={primaryTo} />
    </main>
  );
}
